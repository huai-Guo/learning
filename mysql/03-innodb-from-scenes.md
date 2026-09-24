# 03｜从场景反推 InnoDB：索引、MVCC、锁与事务

> 前两章我们已经大量使用了索引、UNIQUE、FOR UPDATE、SKIP LOCKED、事务。
>
> 这一章不重新背定义，而是追问：**MySQL 为什么能做到这些？**

---

# 0. 先建立一张总图

一次典型查询可以粗略理解为：

~~~mermaid
flowchart LR
    SQL["SQL"] --> OPT["Optimizer"]
    OPT --> ACCESS["选择访问路径"]
    ACCESS --> IDX["B+Tree Index"]
    IDX --> PAGE["InnoDB Page"]
    PAGE --> BP["Buffer Pool"]
    BP --> ROW["Record"]
    ROW --> MVCC["MVCC / Undo"]
    ROW --> LOCK["Record / Gap / Next-Key Lock"]
~~~

你写：

~~~sql
SELECT ...
FROM video_like
WHERE user_id = ?
  AND active = 1
ORDER BY created_at DESC
LIMIT 20;
~~~

数据库真正关心的是：

~~~text
我从哪棵索引树进入？
能不能只扫很小一段？
是否已经按目标顺序排列？
需要回聚簇索引取整行吗？
扫描过程中需要加哪些锁？
读到哪个版本？
~~~

---

# 1. InnoDB 的“表”首先是一棵聚簇索引

以：

~~~sql
CREATE TABLE video_like (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id BIGINT UNSIGNED NOT NULL,
    video_id BIGINT UNSIGNED NOT NULL,
    active TINYINT NOT NULL,
    created_at DATETIME(3) NOT NULL,

    PRIMARY KEY (id),
    UNIQUE KEY uk_user_video (user_id, video_id)
);
~~~

为例。

可以先形成这个心智模型：

~~~text
PRIMARY KEY B+Tree

          [root]
         /      \
      [page]   [page]
       /          \
  [leaf]        [leaf]

叶子：
id + user_id + video_id + active + created_at + ...
~~~

InnoDB 的聚簇索引叶子节点保存的是：

> **整行数据。**

因此：

~~~sql
SELECT *
FROM video_like
WHERE id = 123;
~~~

如果走主键：

~~~text
主键 B+Tree
↓
叶子
↓
整行
~~~

不需要再去另一份“heap file”找数据。

---

# 2. 二级索引叶子里为什么还要带主键

例如：

~~~sql
UNIQUE KEY uk_user_video (user_id, video_id)
~~~

可以简化理解为：

~~~text
Secondary Index B+Tree

key:
(user_id, video_id)

leaf entry:
(user_id, video_id, primary_key=id)
~~~

如果查询：

~~~sql
SELECT active, created_at
FROM video_like
WHERE user_id = 10086
  AND video_id = 9001;
~~~

执行可能是：

~~~text
uk_user_video
↓
找到 id = 778899
↓
拿 id 再去 PRIMARY KEY
↓
取 active / created_at
~~~

第二次找主键的过程通常就叫：

> **回表。**

---

# 3. 为什么主键不能随便设计得很宽

因为二级索引通常需要携带主键值。

假设主键是：

~~~text
BIGINT = 8 bytes
~~~

和：

~~~text
VARCHAR(200)
~~~

对每一棵二级索引，空间代价完全不是一个量级。

所以主键设计会影响：

- 二级索引大小；
- buffer pool 命中；
- B+Tree 层级；
- IO；
- 页分裂与写入成本。

这就是为什么生产系统常偏好较短的主键。

---

# 4. 为什么 B+Tree 很适合数据库

不要只背：

> MySQL 索引使用 B+Tree。

要理解它解决的是：

~~~text
磁盘 / SSD 上的数据
↓
不能每查一行都做大量随机 IO
↓
希望一次读取一个 Page
↓
一个 Page 放大量 key
↓
树高尽量低
~~~

InnoDB 常见默认页大小是 16 KiB。

一个非叶子页能放很多索引项。

所以即使数据量很大，B+Tree 高度通常也不会夸张。

数据库真正追求的是：

> **用很少的页访问定位很大的数据集。**

---

# 5. 为什么联合索引顺序这么重要

我们有：

~~~sql
KEY idx_user_active_created
    (user_id, active, created_at DESC, video_id)
~~~

查询：

~~~sql
SELECT video_id, created_at
FROM video_like
WHERE user_id = ?
  AND active = 1
ORDER BY created_at DESC, video_id DESC
LIMIT 20;
~~~

索引可以想成：

~~~text
先按 user_id 排
  ↓
同 user_id 下按 active 排
  ↓
同 active 下按 created_at 排
  ↓
再按 video_id 排
~~~

所以：

~~~text
user_id = 10086
active = 1
~~~

可以快速缩到一小段连续范围。

然后这一小段本身已经按：

~~~text
created_at DESC
~~~

排列。

数据库不用再把这个用户所有点赞查出来以后重新排序。

---

# 6. 最左前缀不是口诀，而是“排序层级”

索引：

~~~text
(a, b, c)
~~~

物理排序逻辑近似：

~~~text
先 a
a 相同再 b
a,b 都相同再 c
~~~

所以天然容易利用：

~~~text
a
a,b
a,b,c
~~~

但如果直接问：

~~~text
WHERE b = ?
~~~

全局并不是按 b 排序。

因为：

~~~text
a=1 的 b
a=2 的 b
a=3 的 b
~~~

分散在不同区域。

这就是最左前缀真正的来源。

---

# 7. 覆盖索引：为什么有时“不回表”

如果查询只需要：

~~~sql
SELECT video_id, created_at
FROM video_like
WHERE user_id = ?
  AND active = 1
ORDER BY created_at DESC, video_id DESC
LIMIT 20;
~~~

而索引已经包含：

~~~text
user_id
active
created_at
video_id
~~~

那么需要的数据全部就在二级索引里。

执行可以变成：

~~~text
secondary index
↓
直接返回
~~~

不必：

~~~text
secondary index
↓
primary key
↓
整行
~~~

这就是覆盖索引。

但不要为了“覆盖”无限往索引后面塞字段。

索引越宽：

- 占用越大；
- 页能放的 entry 越少；
- 写入越贵。

---

# 8. 索引不只是查询性能，也会影响锁

这是非常重要但初学者容易忽略的一点。

InnoDB 的行级锁，本质上和：

> **索引记录**

强相关。

假设 quota 表主键：

~~~sql
PRIMARY KEY (tenant_id, user_id)
~~~

执行：

~~~sql
SELECT used, quota
FROM user_agent_quota
WHERE tenant_id = 1
  AND user_id = 10086
FOR UPDATE;
~~~

这是一个精确主键定位。

数据库能非常明确地找到：

~~~text
(1, 10086)
~~~

并锁住对应记录。

---

# 9. 如果没有合适索引会怎样

假设：

~~~sql
UPDATE agent_task
SET status = 1
WHERE external_name = 'abc';
~~~

但：

~~~text
external_name 没索引
~~~

InnoDB 可能必须扫描大量记录来判断谁匹配。

锁的代价就不再只是：

~~~text
“我要改的一行”
~~~

而是和：

> 扫描访问路径

紧密相关。

所以一句很重要的话：

> **坏索引不仅会让 SQL 慢，还可能让并发更差。**

---

# 10. 普通 SELECT 为什么经常不被 UPDATE 卡住

这是 MVCC 的价值。

假设：

~~~text
事务 A 正在修改 row X
事务 B 想普通 SELECT row X
~~~

如果所有读取都必须等写事务：

~~~text
读写互相阻塞
↓
并发能力很差
~~~

InnoDB 会保留旧版本相关信息，使普通一致性读在很多情况下可以看到：

> 某个历史可见版本。

这就是：

> **MVCC：Multi-Version Concurrency Control**

---

# 11. MVCC 可以先这样理解

一行：

~~~text
balance = 100
~~~

事务 A 改成：

~~~text
balance = 80
~~~

在事务 A 提交之前，另一个普通一致性读不一定直接读取“80”。

它可能根据：

- 当前事务的 Read View；
- 记录上的事务版本信息；
- undo log；

重建：

~~~text
balance = 100
~~~

于是：

~~~text
Writer
↓
改新版本

Reader
↓
读自己可见的旧版本
~~~

这让大量普通读和写能够并发。

---

# 12. undo log 在这里做了什么

undo 不只是“ROLLBACK 用”。

它还承担：

> **帮助构造旧版本。**

可以粗略想成：

~~~text
当前记录
balance = 80
   │
   └─ roll pointer
          ↓
      undo record
      old balance = 100
~~~

如果某个 Read View 判断：

~~~text
当前版本对我不可见
~~~

就沿版本链往前找。

---

# 13. 为什么长事务会拖累系统

如果一个很老的事务一直不结束：

~~~text
它还可能需要看到很旧的数据版本
~~~

那么某些旧版本就不能马上被 purge 清理。

结果：

~~~text
长事务
↓
旧版本存活时间变长
↓
undo 压力
↓
purge 压力
↓
磁盘 / IO / 性能问题
~~~

所以：

> **长事务不仅“锁持有久”，还可能影响 MVCC 版本清理。**

这也是为什么后台任务不要随便开一个事务跑几十分钟。

---

# 14. REPEATABLE READ 与 READ COMMITTED 的直觉差别

InnoDB 默认隔离级别通常是：

> REPEATABLE READ。

可以先抓核心：

## REPEATABLE READ

同一个事务内普通一致性读通常基于同一个快照语义。

~~~text
第一次 SELECT
↓
形成可见性基准

后续普通 SELECT
↓
保持一致视图
~~~

## READ COMMITTED

每次普通一致性读都可以看到新的已提交快照。

~~~text
SELECT 1
↓
别人 COMMIT
↓
SELECT 2
↓
可能看到更新后的结果
~~~

不要把隔离级别理解成“越高越高级”。

它是在：

- 一致性语义；
- 锁冲突；
- 并发；

之间取舍。

---

# 15. FOR UPDATE 为什么和普通 SELECT 不一样

普通：

~~~sql
SELECT ...
~~~

很多时候是在做：

> consistent nonlocking read。

而：

~~~sql
SELECT ...
FOR UPDATE;
~~~

表达的是：

> “我要基于最新状态继续修改，所以把对应记录锁住。”

它属于 locking read。

因此 quota：

~~~sql
SELECT used, quota
FROM user_agent_quota
WHERE tenant_id = ?
  AND user_id = ?
FOR UPDATE;
~~~

不是为了“读得更快”。

而是：

> 我要先拿到修改这份 quota 状态的排他资格。

---

# 16. 为什么点赞关系可以按 user + video 锁

查询：

~~~sql
SELECT id, active
FROM video_like
WHERE user_id = ?
  AND video_id = ?
FOR UPDATE;
~~~

配合：

~~~sql
UNIQUE KEY uk_user_video (user_id, video_id)
~~~

可以精确定位一份关系。

这比：

~~~text
扫一大片 video_like
再找目标
~~~

并发语义清晰得多。

所以：

> **索引设计和锁设计实际上是同一件事的两面。**

---

# 17. Record Lock、Gap Lock、Next-Key Lock

先不要背几十种锁。

抓三层直觉。

## Record Lock

~~~text
锁一个已有索引记录
~~~

## Gap Lock

~~~text
锁两个索引记录之间的间隙
防止别人在这个范围插入
~~~

## Next-Key Lock

可以粗略理解为：

~~~text
Record + 前面的 Gap
~~~

为什么需要 Gap？

因为范围查询可能要求：

> 在我的事务语义里，不要突然插进新的“幻影记录”。

---

# 18. 一个范围锁例子

索引：

~~~text
score:

10
20
30
40
~~~

事务做：

~~~sql
SELECT *
FROM t
WHERE score BETWEEN 20 AND 30
FOR UPDATE;
~~~

在 REPEATABLE READ 下，InnoDB 对范围查询可能使用 next-key / gap locking。

它不是只关心：

~~~text
20 和 30 这两行
~~~

还可能关心：

~~~text
20～30 这个索引范围
~~~

防止另一个事务插入：

~~~text
score = 25
~~~

---

# 19. 为什么“唯一索引 + 唯一等值条件”很特殊

例如：

~~~sql
SELECT *
FROM user_agent_quota
WHERE tenant_id = 1
  AND user_id = 10086
FOR UPDATE;
~~~

如果这是完整唯一键精确查询：

~~~text
数据库已经知道最多只有一个记录
~~~

锁范围通常可以非常精确。

而：

~~~sql
WHERE user_id > 10000
FOR UPDATE
~~~

是范围条件。

语义和锁范围都不同。

---

# 20. Deadlock：不是“数据库坏了”

假设事务 A：

~~~text
锁 quota(user=1)
↓
再锁 agent(id=9)
~~~

事务 B：

~~~text
锁 agent(id=9)
↓
再锁 quota(user=1)
~~~

形成：

~~~text
A 等 B
B 等 A
~~~

这就是死锁。

InnoDB 会检测并回滚其中一个事务，让系统继续前进。

应用必须：

> 把 deadlock 当成可重试的并发结果之一。

---

# 21. 怎样减少死锁

最有效的思路通常不是“关闭死锁”。

而是：

### 统一加锁顺序

~~~text
所有代码都先 quota
再 agent
~~~

不要有的地方反过来。

### 缩小事务

~~~text
不要拿着锁去调用 LLM / RPC
~~~

### 建正确索引

减少：

~~~text
扫描记录数
↓
锁记录数
~~~

### 一次锁定批量资源时稳定排序

例如：

~~~text
按 id 从小到大加锁
~~~

降低不同事务形成环形等待的概率。

---

# 22. SKIP LOCKED 为什么适合任务队列

Worker A：

~~~text
锁 task 101
~~~

Worker B：

~~~sql
SELECT ...
FOR UPDATE SKIP LOCKED;
~~~

会：

~~~text
跳过 101
↓
找下一个可用任务
~~~

这很适合：

- job queue；
- batch worker；
- Agent task dispatcher。

但它的语义就是：

> “锁住的行先不要给我。”

因此不应该拿它做要求完整一致结果集的普通业务查询。

---

# 23. 事务真正保证什么

事务不是：

> “这段代码永远不会失败。”

它主要给你 ACID 语义。

以 Agent 配额为例：

~~~sql
START TRANSACTION;

UPDATE user_agent_quota
SET used = used + 1
WHERE tenant_id = ?
  AND user_id = ?
  AND used < quota;

INSERT INTO agent_definition (...);

COMMIT;
~~~

你希望的是：

~~~text
quota +1
和
agent 创建
~~~

必须：

~~~text
一起成功
或
一起回滚
~~~

这就是原子性最直观的价值。

---

# 24. 为什么事务不能跨越整个微服务世界

MySQL 的本地事务能原子控制：

~~~text
同一个数据库事务里的 InnoDB 修改
~~~

它不能自动控制：

~~~text
HTTP API
支付服务
GitHub
邮件服务
模型 Provider
对象存储
另一个独立数据库
~~~

所以 Agent Tool Call 才需要：

- idempotency；
- outbox；
- saga / compensation；
- reconciliation。

不要把数据库事务能力想象成“万能撤销键”。

---

# 25. 从点赞表重新看一遍

现在再看：

~~~sql
UNIQUE KEY uk_user_video (user_id, video_id),

KEY idx_user_active_created
    (user_id, active, created_at DESC, video_id)
~~~

你应该能同时看到：

~~~text
uk_user_video
├─ 业务唯一约束
├─ 点赞状态查询
├─ 并发 insert 最终兜底
└─ 精确 locking read 的访问路径

idx_user_active_created
├─ 用户点赞列表
├─ WHERE 前缀
├─ ORDER BY 顺序
├─ keyset pagination
└─ 可能的覆盖索引
~~~

这就不再是“背联合索引”。

---

# 26. 从 Agent quota 再看一遍

~~~sql
PRIMARY KEY (tenant_id, user_id)
~~~

它同时解决：

~~~text
唯一一份 quota 状态
↓
O(logN) 精确定位
↓
FOR UPDATE 精确锁定
↓
同一用户创建请求串行化
~~~

表结构、索引和并发控制根本不是三件孤立的事。

---

# 27. 你现在应该形成的核心模型

以后看到任何 SQL，脑子里同时出现四层：

~~~text
SQL 语义
  ↓
Optimizer 选哪棵索引
  ↓
实际扫描哪些索引记录
  ↓
这些访问会产生什么 MVCC / Lock 行为
~~~

例如：

~~~sql
UPDATE video_like
SET active = 1
WHERE user_id = ?
  AND video_id = ?;
~~~

不要只看：

> UPDATE 一行。

而要追问：

~~~text
是否有 uk_user_video？
↓
如果有，能精确定位
↓
访问很小
↓
锁也更精确

如果没有？
↓
可能扫描大量记录
↓
并发与性能都恶化
~~~

---

# 28. 下一步：COMMIT 为什么可信

现在还剩一个更底层的问题：

> UPDATE 已经改了 buffer pool，但机器突然断电，数据为什么不会凭空消失？

这会引出：

- redo log；
- undo log；
- binlog；
- WAL；
- fsync；
- group commit；
- crash recovery；
- replication；
- transactional outbox。

继续：

> [04｜从一次 COMMIT 到宕机恢复](./04-commit-and-consistency.md)
