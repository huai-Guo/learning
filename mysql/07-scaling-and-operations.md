# 07｜规模上来以后：慢查询、热点、读写分离、分库分表

> 扩展 MySQL 最常见的错误，是：
>
> 数据还没大，就先设计 128 个分库、4096 张分表。
>
> 正确顺序通常是：**先找到真正瓶颈，再增加系统复杂度。**

---

# 0. 一条更靠谱的演化路线

~~~mermaid
flowchart LR
    A["正确数据模型"] --> B["正确 SQL"]
    B --> C["正确索引"]
    C --> D["缩短事务"]
    D --> E["批量 / 缓存"]
    E --> F["连接池 / 参数 / 容量"]
    F --> G["Replica"]
    G --> H["归档 / 分区"]
    H --> I["分库分表"]
    I --> J["专用存储系统"]
~~~

原则：

> **能在一台简单系统里解决的问题，不要提前变成分布式问题。**

---

# 1. 慢查询第一步不是“加机器”

假设：

~~~sql
SELECT *
FROM video_comment
WHERE video_id = ?
ORDER BY created_at DESC
LIMIT 20;
~~~

没有索引：

~~~text
全表/大范围扫描
↓
排序
↓
返回 20 条
~~~

就算加一台更大的数据库：

> 你只是让错误方案跑得稍微快一点。

先应该建立：

~~~sql
KEY idx_video_created (video_id, created_at DESC, id DESC)
~~~

然后用执行计划验证。

---

# 2. EXPLAIN / EXPLAIN ANALYZE 是什么角色

不要“凭感觉认为用了索引”。

需要让 MySQL 告诉你：

~~~text
选择了哪张表
选择了哪棵索引
估算扫描多少行
实际扫描多少
是否排序
是否临时处理
每一步耗时多少
~~~

工作流应该是：

~~~text
业务慢
↓
找到具体 SQL
↓
EXPLAIN / EXPLAIN ANALYZE
↓
看真实访问路径
↓
改 SQL / 索引
↓
重新测
~~~

而不是：

~~~text
慢
↓
再加三个索引
↓
祈祷
~~~

---

# 3. 为什么线上要开 Slow Query 观测

开发环境：

~~~text
video_like = 1000 行
~~~

什么 SQL 都快。

线上：

~~~text
video_like = 20 亿行
~~~

访问模式完全不同。

所以要从生产工作负载里回答：

- 哪些 SQL 总耗时最高？
- 哪些 SQL p99 最差？
- 哪些扫描行数异常？
- 哪些 SQL 被调用次数极高？
- 哪些锁等待多？
- 哪些事务很长？

优化数据库首先是：

> **测量。**

---

# 4. 短视频：最大的压力未必是“大表”，而可能是“热点”

两个极端：

## 大而均匀

~~~text
10 亿用户
每人偶尔查自己的数据
~~~

压力可以比较分散。

## 小而热点

~~~text
一个爆款视频
100 万 QPS 都打 video_id = 9001
~~~

即使表不大，也可能因为：

~~~text
同一行
同一 key
同一缓存槽
同一分片
~~~

形成热点。

所以容量规划必须同时看：

~~~text
Data Volume
+
Access Distribution
~~~

---

# 5. Hot Row 比“大表”更早把你打趴

之前的：

~~~sql
UPDATE video
SET like_count = like_count + 1
WHERE id = 9001;
~~~

问题不是：

~~~text
video 表太大
~~~

而是：

~~~text
大家都写同一行
~~~

解决思路：

- Redis counter；
- bucket counter；
- async aggregation；
- append fact + projector；
- 降低强一致实时 count 要求。

这和加二级索引没有直接关系。

---

# 6. Agent：热点也可能出现在 quota / tenant 级别

如果一个大型企业 tenant：

~~~text
10000 个用户
共享一个 tenant_usage_total 行
~~~

每次模型调用都：

~~~sql
UPDATE tenant_usage_total
SET tokens = tokens + ?
WHERE tenant_id = ?;
~~~

这个 tenant 就会形成热点行。

所以使用：

~~~text
usage_ledger
↓
异步聚合
↓
hourly / daily summary
~~~

往往比实时争抢一个总数更可扩展。

---

# 7. Connection Pool：数据库不是 HTTP 无连接服务

应用每个请求都：

~~~text
connect
authenticate
query
close
~~~

会造成很大开销。

所以后端通常维护连接池。

但：

> 连接池越大不等于越快。

如果：

~~~text
100 个应用实例
每个 200 连接
~~~

就是：

~~~text
20000 DB connections
~~~

数据库线程、内存、调度都会承压。

连接池应该和：

- DB 最大连接；
- 实例数量；
- 查询时延；
- 并发度；
- timeout；

一起规划。

---

# 8. 连接池耗尽通常说明什么

请求：

~~~text
拿不到 DB connection
~~~

不一定是：

> pool 太小。

可能是：

~~~text
SQL 变慢
↓
连接占用时间变长
↓
连接释放速度下降
↓
Pool Exhausted
~~~

如果你只把 pool：

~~~text
50 -> 500
~~~

可能把数据库直接压垮。

真正要先查：

- 慢查询；
- lock wait；
- 长事务；
- DB CPU / IO；
- 网络；
- 下游依赖；
- connection leak。

---

# 9. 批量查询：解决 N+1

Feed 一次 20 个 video_id。

错误：

~~~text
20 个视频
↓
20 次查 video
↓
20 次查 author
↓
20 次查 like
~~~

很快就变成几十次 RPC + SQL。

正确方向：

~~~text
video ids 批量查询
author ids 批量查询
like relation 批量查询
↓
应用层组装
~~~

数据库扩展能力很多时候来自：

> 少做无意义的 round trip。

---

# 10. Read Replica：什么时候出现

当主库写压力可以接受，但读很多：

~~~text
Primary
├─ write
├─ critical read
│
├─ Replica A
├─ Replica B
└─ Replica C
~~~

可以把：

- 历史列表；
- 非强一致查询；
- 报表类轻读；

分散到副本。

但必须记住：

> Replica 可能有延迟。

---

# 11. 哪些读不适合随便打 Replica

刚创建 Agent：

~~~text
POST /agents
↓
success
↓
GET /agents/{id}
~~~

如果 GET 立即读 lagging replica：

~~~text
404
~~~

刚点赞：

~~~text
success
↓
读 replica
↓
liked=false
~~~

这种体验非常差。

所以系统要显式区分：

~~~text
强 read-after-write
和
允许 stale 的 read
~~~

---

# 12. Partition 不等于 Sharding

MySQL Partition：

~~~text
同一个 MySQL 实例/逻辑表
↓
数据被分成多个 partition
~~~

Sharding：

~~~text
数据真正分散到多个独立数据库节点
~~~

不要把：

~~~text
PARTITION BY RANGE
~~~

理解成：

> “我已经分库分表了”。

两者运维、扩容、事务和故障模型完全不同。

---

# 13. Partition 什么时候有价值

例如超大时序/审计表：

~~~text
tool_call_audit
usage_ledger
event_log
~~~

按时间管理数据生命周期：

~~~text
2026-07
2026-08
2026-09
~~~

分区有时有利于：

- 生命周期管理；
- 批量删除旧分区；
- 某些分区裁剪场景。

但：

> 一个错误查询不会因为“分区”自动变正确。

索引设计仍然重要。

---

# 14. 为什么删除 10 亿历史日志不能随便 DELETE

~~~sql
DELETE FROM usage_ledger
WHERE created_at < '2025-01-01';
~~~

可能导致：

- 巨大事务；
- 大量 undo；
- redo；
- replication pressure；
- lock / IO；
- 长时间 purge。

更好的系统一开始就要设计：

> **数据生命周期。**

例如：

- 热数据 90 天；
- 冷数据进入对象存储 / OLAP；
- 分区按时间 drop；
- 批量小事务归档。

---

# 15. 分库分表真正要先回答：按什么 key 分

点赞关系：

~~~text
(user_id, video_id)
~~~

如果按 user_id 分片：

优点：

~~~text
“我的点赞”
都在一个 shard
~~~

但：

~~~text
“某视频有哪些点赞用户”
跨很多 shard
~~~

如果按 video_id 分片：

正好反过来。

所以：

> **不存在一个神奇 shard key 同时优化所有查询。**

分片本质是在选择：

> 哪类访问成为本地查询，哪类访问愿意付出跨分片代价。

---

# 16. 短视频点赞常见的分片矛盾

业务同时想：

~~~text
A. 查 user 10086 最近点赞了什么
B. 查 video 9001 被哪些用户点赞
~~~

二维关系无法同时天然按两边局部化。

工程方案可能包括：

- 选择主访问方向分片；
- 另一方向建立异步 projection；
- 搜索/OLAP 系统承载反向分析；
- MQ/CDC 复制成另一份读模型。

这也是：

> CQRS / materialized view

在大规模系统里自然出现的原因之一。

---

# 17. Agent 数据怎么选 Shard Key

Agent SaaS 经常有：

~~~text
tenant_id
~~~

它是一个很自然的候选。

例如：

~~~text
tenant 1
  sessions
  agents
  runs
  usage

tenant 2
  ...
~~~

好处：

- 大部分事务在同 tenant；
- 权限边界清晰；
- 容易做 tenant 迁移。

但如果：

~~~text
某一个 tenant 超级大
~~~

它会变成超级热点 shard。

所以还要设计：

- virtual shard；
- tenant + hash；
- 大租户独立实例；
- rebalancing。

---

# 18. 分片以后你失去了什么简单性

单库：

~~~sql
BEGIN;
UPDATE A;
INSERT B;
COMMIT;
~~~

很自然。

跨 shard：

~~~text
Shard 17
Shard 93
~~~

事务突然变成分布式一致性问题。

同时还会出现：

- 全局唯一 ID；
- cross-shard join；
- pagination；
- aggregation；
- schema migration；
- resharding；
- distributed transaction；
- routing。

所以：

> **分片应该是性能和容量逼出来的，不是架构炫技。**

---

# 19. Online DDL：线上加索引为什么要小心

你发现：

~~~text
video_comment 缺索引
~~~

开发环境：

~~~sql
ALTER TABLE video_comment
ADD INDEX idx_video_created (...);
~~~

几秒结束。

线上：

~~~text
20 亿行
~~~

可能是完全不同的工程事件。

需要考虑：

- operation 是否支持 INSTANT / INPLACE / COPY；
- metadata lock；
- 长事务；
- IO；
- replication lag；
- 磁盘临时空间；
- 回滚计划。

MySQL 8.4 对大量 InnoDB DDL 支持 Online DDL，但具体操作能力不同，不能一句“online”就认为零影响。

---

# 20. 为什么长事务会卡 DDL

DDL 需要 metadata lock。

如果前面有一个长期不结束的事务持有相关 metadata 访问：

~~~text
ALTER
↓
等待
~~~

后续新请求又可能堆积。

所以线上 DDL 前经常要先检查：

- long transaction；
- metadata lock；
- replication；
- capacity。

这也是“事务尽量短”的另一个原因。

---

# 21. Backup 与 Replica 不是一回事

有人说：

> 我有三个 Replica，所以不用备份。

这是危险的。

如果：

~~~sql
DROP TABLE agent_run;
~~~

这个操作也可能复制到所有 Replica。

Replica 解决：

> 高可用 / 读扩展 / 故障切换。

Backup 解决：

> 历史恢复。

两者目标不同。

---

# 22. 真正需要的恢复体系

至少要考虑：

~~~text
Full / Snapshot Backup
        +
Binlog Retention
        +
Restore Procedure
        +
Regular Restore Test
~~~

然后明确：

~~~text
RPO：最多能丢多少数据？
RTO：多久必须恢复？
~~~

没有 RPO/RTO 的“高可用”往往只是模糊承诺。

---

# 23. 什么时候应该把数据移出 MySQL

MySQL 很强，但不是所有负载都适合。

## 大对象

~~~text
Agent artifact
20MB Tool Result
视频文件
模型 checkpoint
~~~

→ Object Storage。

## 全文搜索

~~~text
数亿文档复杂检索
~~~

→ Search Engine。

## 超大规模分析

~~~text
按月统计几十亿 usage/event
复杂聚合
~~~

→ OLAP / Data Warehouse。

## 高频缓存

~~~text
热门视频 count
session cache
rate limit
~~~

→ Redis / Cache。

核心思想：

> **MySQL 保存适合关系事务模型的核心事实，不要把它当成所有存储的唯一答案。**

---

# 24. 短视频架构最后会长成什么样

~~~mermaid
flowchart LR
    APP["App"] --> API["Backend"]
    API --> CACHE[("Redis")]
    API --> MYSQL[("MySQL Primary")]
    MYSQL --> REP[("Read Replica")]
    MYSQL --> CDC["Binlog / CDC"]
    CDC --> MQ["MQ"]
    MQ --> PROJ["Projectors"]
    PROJ --> CACHE
    MQ --> OLAP[("OLAP")]
    API --> OBJ[("Object Storage")]
~~~

MySQL 仍然是核心。

但它不再独自承担所有工作。

---

# 25. Agent 架构最后会长成什么样

~~~mermaid
flowchart LR
    API["Agent API"] --> MYSQL[("MySQL")]
    API --> OBJ[("Object Storage")]
    MYSQL --> WORKER["Worker"]
    WORKER --> LLM["Model Provider"]
    WORKER --> TOOL["Tools"]
    MYSQL --> OUTBOX["Outbox / CDC"]
    OUTBOX --> MQ["MQ"]
    MQ --> BILL["Usage / Billing"]
    MQ --> OBS["Observability / Analytics"]
    WORKER --> CACHE[("Redis / Lease Cache")]
~~~

这里 MySQL 更像：

> **Control Plane State Store**

保存：

- 谁；
- 在跑什么；
- 跑到哪里；
- 哪一步成功；
- 哪一步失败；
- 哪个版本；
- 使用了多少资源；
- 是否还能恢复。

---

# 26. 一个数据库设计评审 Checklist

以后你看到任何 MySQL 方案，都可以按这一组问题检查：

~~~text
数据语义
├─ 事实还是缓存？
├─ 当前状态还是历史流水？
└─ 能否重建？

查询
├─ 主查询路径是什么？
├─ 排序是什么？
├─ 深分页怎么做？
└─ 是否 N+1？

索引
├─ PRIMARY KEY 为什么这样选？
├─ UNIQUE 是业务约束吗？
├─ 联合索引顺序由哪个查询推出？
└─ 写放大能接受吗？

并发
├─ 两个请求同时写会怎样？
├─ 乐观锁还是 FOR UPDATE？
├─ 是否可能热点行？
└─ 死锁如何重试？

事务
├─ 本地原子边界是什么？
├─ 有没有远程 RPC 放在事务里？
└─ 外部副作用如何幂等？

可靠性
├─ crash 后怎么恢复？
├─ replica lag 怎么处理？
├─ outbox / CDC 怎么做？
└─ backup 真恢复过吗？

规模
├─ 先优化 SQL/索引了吗？
├─ 是否真的需要 replica？
├─ 是否真的需要 shard？
└─ 哪类数据应该移出 MySQL？
~~~

如果这一套能答完整，你已经不是“会写 SQL”，而是在做数据库工程设计。
