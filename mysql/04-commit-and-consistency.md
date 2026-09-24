# 04｜从一次 COMMIT 到宕机恢复：redo、undo、binlog 与 Outbox

> 业务代码里一句 COMMIT 很简单。
>
> 真正的问题是：**MySQL 为什么敢在 COMMIT 返回后告诉你“成功了”？**

---

# 0. 从一个最危险的问题开始

Agent 配额事务：

~~~sql
START TRANSACTION;

UPDATE user_agent_quota
SET used = used + 1
WHERE tenant_id = 1
  AND user_id = 10086
  AND used < quota;

INSERT INTO agent_definition (...);

COMMIT;
~~~

假设 COMMIT 返回成功的下一毫秒：

~~~text
机房断电
~~~

重启以后：

> Agent 和 quota 到底应该存在，还是不应该存在？

如果数据库连这个都回答不了，就不能承载订单、支付、配额、点赞关系这些核心状态。

---

# 1. 真正的数据页首先通常在内存里改

InnoDB 有 Buffer Pool。

可以先这样理解：

~~~text
磁盘上的 Page
   ↓
读入 Buffer Pool
   ↓
事务修改内存 Page
   ↓
Page 变成 dirty page
~~~

如果每一次 UPDATE 都立刻：

~~~text
随机写完整数据页
↓
fsync
~~~

吞吐会非常差。

所以数据库需要日志先行。

---

# 2. WAL：Write-Ahead Logging

核心思想：

> **先把“如何恢复这次修改”的日志可靠记录下来，再允许脏页以后慢慢刷盘。**

于是：

~~~text
修改 Buffer Pool Page
        ↓
生成 redo
        ↓
redo 先持久化
        ↓
COMMIT 可以完成
        ↓
dirty page 以后再刷磁盘
~~~

这就是 WAL 的核心价值。

---

# 3. redo log 解决什么

假设：

~~~text
内存里的数据页已经变了
磁盘数据页还没刷
↓
突然掉电
~~~

重启以后：

~~~text
磁盘页仍是旧的
~~~

但如果 redo 已经持久化：

~~~text
InnoDB Recovery
↓
重放需要的 redo
↓
恢复已提交修改
~~~

所以 redo 主要解决：

> **Crash Recovery：已提交但数据页还没落盘怎么办？**

---

# 4. redo 不是“再存一份整张表”

不要把 redo 想成：

~~~text
video_like 表备份
~~~

它是面向恢复的日志结构。

真实内部格式很复杂。

学习时先抓住：

~~~text
Data Page
= 最终数据状态

Redo Log
= 崩溃后把页面推进到正确状态所需的恢复信息
~~~

两者职责不同。

---

# 5. undo 又解决什么

redo 和 undo 名字像一对，但职责不同。

undo 主要服务：

~~~text
① 事务 ROLLBACK
② MVCC 历史版本
~~~

例如：

~~~text
balance: 100 -> 80
~~~

如果事务回滚：

~~~text
undo 帮助恢复旧逻辑状态
~~~

如果另一个 Read View 仍需要看到旧版本：

~~~text
undo 帮助构造 balance = 100
~~~

所以：

~~~text
redo
→ 向前恢复

undo
→ 回滚 / 历史版本
~~~

这是最重要的区分。

---

# 6. Binlog 为什么又来了一份日志

redo 是 InnoDB 存储引擎层的恢复日志。

Binlog 属于 MySQL Server 层。

它常用于：

- replication；
- CDC；
- point-in-time recovery；
- 审计/订阅变更链路。

可以先画成：

~~~text
            MySQL Server
        ┌─────────────────┐
        │     Binlog      │
        └────────┬────────┘
                 │
        ┌────────▼────────┐
        │     InnoDB      │
        │ redo / undo     │
        │ buffer pool     │
        └─────────────────┘
~~~

---

# 7. 为什么 redo 和 binlog 不能各写各的

假设：

~~~text
redo 里说事务成功
binlog 没有
~~~

那么：

~~~text
主库恢复后有这条数据
但副本永远收不到
~~~

反过来：

~~~text
binlog 有
redo 最终认为事务没提交
~~~

也会造成：

~~~text
复制世界和主库世界不一致
~~~

因此 InnoDB 与 Binlog 提交需要协调。

---

# 8. 两阶段提交的直觉模型

学习时可以先使用这个简化模型：

~~~mermaid
sequenceDiagram
    participant S as MySQL Server
    participant I as InnoDB
    participant B as Binlog

    S->>I: 执行业务修改
    I->>I: redo + undo + dirty page
    S->>I: prepare
    I-->>S: prepared
    S->>B: write binlog
    B-->>S: binlog durable
    S->>I: commit
    I-->>S: committed
~~~

关键目标：

> **让存储引擎恢复结果和 binlog 世界对同一事务形成一致判断。**

真实 MySQL 内部还有 group commit、阶段协同等更多细节，但这个模型足以解释为什么不能简单理解成“先写 redo，再随便写个 binlog”。

---

# 9. 崩溃发生在不同阶段会怎样

## 情况 A：事务还没 prepare

~~~text
没有完成提交链路
↓
恢复时回滚
~~~

## 情况 B：InnoDB 已 prepare，但 binlog 没有完整事务

~~~text
恢复时不能把它当成成功提交事务
~~~

## 情况 C：binlog 已可靠存在，InnoDB 处于 prepared

恢复时可以根据协调信息判断事务应该完成提交。

最终目标就是：

> 崩溃前后不能出现“半个事务”。

---

# 10. 为什么 dirty page 可以很晚才刷

因为：

~~~text
COMMIT durability
并不要求
所有数据页都在 COMMIT 时同步写完
~~~

只要恢复链路所需日志足够可靠。

所以：

~~~text
事务提交速度
和
完整数据页刷盘速度
~~~

可以解耦。

这对数据库吞吐至关重要。

---

# 11. fsync 为什么昂贵

操作系统 write：

~~~text
应用
↓
OS Page Cache
~~~

并不一定意味着：

~~~text
稳定介质已经真正写完
~~~

数据库在需要强持久化时会依赖 fsync / flush 语义。

而强制持久化通常比普通内存写昂贵很多。

如果：

~~~text
每个事务单独一次 fsync
~~~

高并发下成本很高。

---

# 12. Group Commit

假设同时有：

~~~text
T1
T2
T3
T4
T5
~~~

与其：

~~~text
T1 fsync
T2 fsync
T3 fsync
...
~~~

可以尽量：

~~~text
一批事务
↓
共享一次或少量持久化动作
~~~

这就是 group commit 的核心收益：

> **把昂贵的持久化成本在并发事务之间摊薄。**

所以：

~~~text
并发
并不总是数据库的敌人
~~~

在日志持久化路径上，合理并发反而能形成批处理效率。

---

# 13. 两个最常见的 durability 配置

生产里经常讨论：

~~~text
innodb_flush_log_at_trx_commit
sync_binlog
~~~

在强调事务持久性与复制一致性的典型配置中，经常会看到：

~~~text
innodb_flush_log_at_trx_commit = 1
sync_binlog = 1
~~~

直觉上：

~~~text
redo commit path
和
binlog path
~~~

都尽量在事务提交时要求可靠持久化。

代价是：

> 更多持久化 IO。

所以 durability 和 throughput 之间始终存在工程权衡。

---

# 14. COMMIT 成功 ≠ 数据已经复制到所有副本

这是另一个常见误区。

主库：

~~~text
COMMIT SUCCESS
~~~

通常意味着：

> 主库本地事务提交语义已经满足。

但异步复制架构下：

~~~text
Primary
↓
Binlog
↓
Replica IO / Apply
~~~

副本可能落后几十毫秒、几秒，甚至更多。

于是：

~~~text
刚写主库
↓
立刻读 Replica
↓
可能读不到
~~~

这就是：

> replica lag / stale read。

---

# 15. 短视频里的 Read-After-Write

用户刚点赞：

~~~text
POST /like
↓
success
~~~

下一秒刷新。

如果：

~~~text
关系查询读 replica
而 replica 还没追上
~~~

用户可能看到：

~~~text
“我刚赞了，怎么又没赞？”
~~~

解决方向包括：

- 一段时间内读主库；
- session sticky read；
- 等复制位点；
- UI 本地乐观状态；
- Redis 持有最新热状态。

数据库架构必须和产品一致性体验一起设计。

---

# 16. Binlog 为什么是 CDC 的基础

点赞关系提交后：

~~~text
video_like
0 -> 1
~~~

Binlog 里会出现对应变更。

CDC 系统可以：

~~~text
读取 Binlog
↓
转换成 Change Event
↓
送到 MQ / Kafka
↓
统计、推荐、搜索、数仓消费
~~~

这使业务主事务不用同步调用十个下游。

---

# 17. CDC 和 Transactional Outbox 是什么关系

两者都在解决：

> “数据库事实提交以后，如何可靠地让外部系统知道？”

## CDC

~~~text
业务表
↓
Binlog
↓
CDC
↓
MQ
~~~

优点：

- 应用少写一张 outbox；
- 对数据库变更统一订阅。

难点：

- 事件语义往往更偏“数据库行变化”；
- 业务事件构造、schema、去重仍需治理。

## Outbox

~~~text
业务表 + outbox_event
同事务
↓
Dispatcher
↓
MQ
~~~

优点：

- 业务事件显式；
- payload / event_type 由业务定义。

难点：

- 多一张表；
- dispatcher 与清理需要治理。

---

# 18. 为什么 Outbox 不等于 Exactly Once

Dispatcher：

~~~text
读取 event 1001
↓
成功发 Kafka
↓
准备 UPDATE published=1
↓
机器断电
~~~

重启：

~~~text
event 1001 仍显示未发送
↓
再发一次
~~~

因此消费者仍然需要：

~~~text
event_id = 1001
↓
幂等去重
~~~

真正工程思维不是追求一句口号：

> exactly once。

而是明确每条链路：

~~~text
可能重复吗？
重复后如何识别？
识别后如何不重复产生副作用？
~~~

---

# 19. Agent Tool Call 为什么比 Outbox 更难

Outbox 的外部动作通常是：

~~~text
publish message
~~~

而 Agent Tool 可能是：

~~~text
扣款
发邮件
创建工单
删除资源
创建 GitHub PR
~~~

这些副作用不是 MySQL 能 rollback 的。

所以：

~~~text
MySQL transaction
≠
External Tool transaction
~~~

Agent 必须建立：

- idempotency_key；
- external_request_id；
- status machine；
- retry policy；
- reconciliation；
- compensation（如果业务允许）。

---

# 20. 一个 Tool Call 崩溃矩阵

假设：

~~~text
DB 状态：PENDING
外部 API：SUCCESS
~~~

这是最危险的中间态之一。

恢复时不能：

~~~text
看到 PENDING
↓
直接当作没执行
~~~

必须：

~~~text
读取 idempotency_key
↓
查询或重试外部 API
↓
恢复第一次执行结果
↓
再把 DB 标记 SUCCESS
~~~

这就是为什么生产 Agent 的 resume 本质上是：

> **状态恢复 + 外部世界对账。**

---

# 21. 为什么“先更新 DB，再调用外部 API”也不是万能

方案：

~~~text
DB = SUCCESS
↓
COMMIT
↓
调用外部 API
~~~

如果 API 失败：

~~~text
数据库说成功
现实世界没成功
~~~

所以应该根据业务语义拆状态：

~~~text
PENDING
DISPATCHING
SUCCEEDED
FAILED
UNKNOWN
~~~

而不是只用：

~~~text
0 / 1
~~~

很多复杂系统真正难的是：

> **把“不确定”建模出来。**

---

# 22. 数据库里应该保存“可恢复事实”

一个很实用的判断：

~~~text
如果服务全挂掉 10 分钟
重新启动时
哪些信息必须还在
才能继续正确工作？
~~~

这些信息很适合持久化。

短视频：

~~~text
点赞关系
评论
发布状态
~~~

Agent：

~~~text
Run
Step
Tool Call
Checkpoint pointer
Usage Ledger
Quota
~~~

而：

~~~text
一个请求函数里的临时变量
某个 worker 的内存 queue
某次模型调用的 TCP socket
~~~

不是数据库要保存的业务事实。

---

# 23. Point-in-Time Recovery 的直觉

假设：

~~~text
凌晨 02:00 做完整备份
下午 15:23:08 误删数据
~~~

只有凌晨备份：

~~~text
最多恢复到 02:00
↓
损失 13 小时数据
~~~

如果保留之后的 Binlog：

~~~text
02:00 Full Backup
↓
重放 Binlog
↓
恢复到 15:23:07
~~~

这就是 Point-in-Time Recovery 的基本思路。

所以备份策略不是：

> “每天复制一下目录。”

而是：

- full / snapshot backup；
- binlog retention；
- restore procedure；
- recovery point objective；
- recovery time objective；
- 定期恢复演练。

---

# 24. 真正可靠的是“恢复演练”，不是“我有备份”

最危险的情况：

~~~text
监控里显示 backup success
↓
半年后第一次真正 restore
↓
发现备份不可用
~~~

所以数据库运维最终必须验证：

~~~text
我真的能从备份恢复吗？
需要多久？
能恢复到哪个时间点？
应用依赖的 schema / secret / object storage 是否也齐？
~~~

Agent 系统尤其还要考虑：

> MySQL 恢复了，但 checkpoint 引用的对象存储文件还在不在？

---

# 25. 本章把 COMMIT 重新定义一次

COMMIT 不是：

> “把表文件全部写完”。

更好的理解：

> **数据库已经建立了足够可靠、可恢复的一致事务事实，并按照配置完成必要的持久化协调。**

所以一次写入背后实际牵涉：

~~~text
Buffer Pool
Dirty Page
Undo
Redo
Binlog
Prepare
Commit
Fsync
Group Commit
Crash Recovery
Replication
CDC
~~~

这才是“写一行 MySQL”的真实底层重量。

---

# 26. 下一步：数据量变大以后怎么办

当你已经理解：

~~~text
表
索引
锁
事务
日志
恢复
~~~

才适合讨论：

- 慢查询；
- connection pool；
- read replica；
- hotspot；
- partition；
- shard；
- archive；
- online DDL；
- 专用存储系统。

继续：

> [05｜规模上来以后：慢查询、热点、读写分离、分库分表](./05-scaling-and-operations.md)
