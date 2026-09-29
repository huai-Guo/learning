# MySQL 参考资料

> 本目录的底层机制以 MySQL 8.4 / InnoDB 官方文档为校对基线。
>
> 短视频与 Agent 章节使用的是**真实生产约束下常见的工程模式**，例如热点行、幂等、Outbox、任务租约、Checkpoint、Usage Ledger；它们用于教学推导，不宣称某一家具体公司的内部实现一定完全相同。

## 1. InnoDB 与索引

- [MySQL 8.4 Reference Manual](https://dev.mysql.com/doc/refman/8.4/en/)
- [InnoDB Introduction](https://dev.mysql.com/doc/refman/8.4/en/innodb-introduction.html)
- [Clustered and Secondary Indexes](https://dev.mysql.com/doc/refman/8.4/en/innodb-index-types.html)
- [Optimization and Indexes](https://dev.mysql.com/doc/refman/8.4/en/optimization-indexes.html)
- [Multiple-Column Indexes](https://dev.mysql.com/doc/refman/8.4/en/multiple-column-indexes.html)
- [Optimizing InnoDB Queries](https://dev.mysql.com/doc/refman/8.4/en/optimizing-innodb-queries.html)

学习重点：

~~~text
PRIMARY KEY
→ clustered index
→ secondary index 携带 primary key
→ 回表
→ covering index
→ composite index
→ query-driven index design
~~~

---

## 2. MVCC、事务与锁

- [InnoDB Multi-Versioning](https://dev.mysql.com/doc/refman/8.4/en/innodb-multi-versioning.html)
- [Undo Logs](https://dev.mysql.com/doc/refman/8.4/en/innodb-undo-logs.html)
- [Transaction Isolation Levels](https://dev.mysql.com/doc/refman/8.4/en/innodb-transaction-isolation-levels.html)
- [Locking Reads](https://dev.mysql.com/doc/refman/8.4/en/innodb-locking-reads.html)
- [InnoDB Locking](https://dev.mysql.com/doc/refman/8.4/en/innodb-locking.html)
- [How to Minimize and Handle Deadlocks](https://dev.mysql.com/doc/refman/8.4/en/innodb-deadlocks-handling.html)
- [InnoDB Lock and Lock-Wait Information](https://dev.mysql.com/doc/refman/8.4/en/innodb-information-schema-understanding-innodb-locking.html)

学习重点：

~~~text
普通一致性读
→ Read View / MVCC

locking read
→ FOR UPDATE / FOR SHARE

range locking
→ record / gap / next-key

并发冲突
→ lock wait / deadlock / retry
~~~

---

## 3. Redo、Binlog 与恢复

- [InnoDB Redo Log](https://dev.mysql.com/doc/refman/8.4/en/innodb-redo-log.html)
- [InnoDB Recovery](https://dev.mysql.com/doc/refman/8.4/en/innodb-recovery.html)
- [The Binary Log](https://dev.mysql.com/doc/refman/8.4/en/binary-log.html)
- [Binary Logging Options and Variables](https://dev.mysql.com/doc/refman/8.4/en/replication-options-binary-log.html)
- [InnoDB and the ACID Model](https://dev.mysql.com/doc/refman/8.4/en/mysql-acid.html)

学习重点：

~~~text
Buffer Pool
→ dirty page
→ WAL
→ redo
→ commit durability
→ crash recovery

Server Layer
→ binlog
→ replication / CDC / PITR
~~~

---

## 4. 优化与运维

- [Optimization](https://dev.mysql.com/doc/refman/8.4/en/optimization.html)
- [EXPLAIN Statement](https://dev.mysql.com/doc/refman/8.4/en/explain.html)
- [Online DDL Operations](https://dev.mysql.com/doc/refman/8.4/en/innodb-online-ddl-operations.html)
- [Performance Schema](https://dev.mysql.com/doc/refman/8.4/en/performance-schema.html)
- [Slow Query Log](https://dev.mysql.com/doc/refman/8.4/en/slow-query-log.html)

学习重点：

~~~text
先测量
→ 找到 SQL
→ EXPLAIN / EXPLAIN ANALYZE
→ 修访问路径
→ 再谈扩容
~~~

---

## 5. 本目录里几个“非 MySQL 专属”的工程模式

下面这些不是 MySQL 独有功能，而是围绕关系数据库常见的系统设计模式：

### Transactional Outbox

~~~text
business row
+
outbox row
同一本地事务提交
↓
dispatcher / CDC
↓
MQ
↓
consumer idempotency
~~~

### Idempotency Key

~~~text
同一个业务动作
↓
稳定 key
↓
重复请求可以识别为同一动作
~~~

Agent Tool Call、支付、发消息、创建远程资源都会用到。

### Lease

~~~text
worker_id
+
lease_until
~~~

用于表达：

> “某个 Worker 在一段时间内拥有执行权。”

超时后可以重新调度。

### Ledger

~~~text
append facts
↓
async aggregate
~~~

比反复 UPDATE 一个总数更容易：

- 审计；
- 重放；
- 对账；
- 修正聚合。

---

## 6. 如何判断一个案例是否“真实”

本目录尽量遵守以下标准：

1. **必须存在明确业务访问模式**，而不是凭空设计索引。
2. **必须考虑并发请求**，而不是假设所有请求串行。
3. **必须考虑失败与重试**，包括进程崩溃和外部调用不确定状态。
4. **必须考虑热点与数据量**，而不是只在 1000 行测试表里讨论性能。
5. **必须明确 MySQL 边界**，不强行用 MySQL 取代 Redis、对象存储、搜索引擎、OLAP。
6. **不冒充某家公司内部实现**；具体公司可能使用不同中间件、分片策略和基础设施。

换句话说：

> 追求的是“真实工程约束”，不是“编一个大厂故事”。


---

## 7. 表设计与 Schema 设计补充校对

### Foreign Key

MySQL 8.4 InnoDB 支持 FOREIGN KEY，用于检查相关表之间的引用完整性。引用侧的外键列需要可用索引；如果没有合适索引，MySQL 会为约束建立需要的索引。

官方：
- [FOREIGN KEY Constraints](https://dev.mysql.com/doc/refman/8.4/en/create-table-foreign-keys.html)

本课程不会把“必须使用 FK”或“高并发系统绝不用 FK”当成绝对规则，而是结合数据库所有权边界、迁移方式和团队完整性治理能力讨论。

### JSON 与可索引字段

MySQL 8.4 的 JSON 列不能直接作为普通 B-Tree 索引键。需要查询 JSON 内标量值时，可以通过生成列等机制建立索引访问路径。

官方：
- [The JSON Data Type](https://dev.mysql.com/doc/refman/8.4/en/json.html)
- [Secondary Indexes and Generated Columns](https://dev.mysql.com/doc/refman/8.4/en/create-table-secondary-indexes.html)
- [Optimizer Use of Generated Column Indexes](https://dev.mysql.com/doc/refman/8.4/en/generated-column-index-optimizations.html)

这也是为什么本课程强调：经常参与 WHERE / JOIN / ORDER BY / UNIQUE / shard routing 的核心字段，应该认真考虑建成正式列，而不是全部藏在 JSON。

### Primary Key 与二级索引

InnoDB 每张表有 clustered index；显式 PRIMARY KEY 通常就是 clustered index。Secondary index 记录会携带 primary key，因此主键宽度会影响二级索引空间。

官方：
- [Clustered and Secondary Indexes](https://dev.mysql.com/doc/refman/8.4/en/innodb-index-types.html)

这也是 00 章把主键设计放进 Schema Design，而不是把它仅仅当作“自增 ID 语法”的原因。


---

## 8. 索引设计与执行计划

- [Optimization and Indexes](https://dev.mysql.com/doc/refman/8.4/en/optimization-indexes.html)
- [Multiple-Column Indexes](https://dev.mysql.com/doc/refman/8.4/en/multiple-column-indexes.html)
- [Index Condition Pushdown](https://dev.mysql.com/doc/refman/8.4/en/index-condition-pushdown-optimization.html)
- [EXPLAIN Statement / EXPLAIN ANALYZE](https://dev.mysql.com/doc/refman/8.4/en/explain.html)
- [Optimizer Statistics / Histograms](https://dev.mysql.com/doc/refman/8.4/en/optimizer-statistics.html)
- [Hash Join Optimization](https://dev.mysql.com/doc/refman/8.4/en/hash-joins.html)

本课程因此不采用“选择性高的一定放最左”“范围后所有列彻底失效”“有索引就一定使用”等过度简化口诀，而要求用 Query Pattern + 数据分布 + EXPLAIN / EXPLAIN ANALYZE 验证。

---

## 9. InnoDB 内存与磁盘结构

- [InnoDB Storage Engine](https://dev.mysql.com/doc/refman/8.4/en/innodb-storage-engine.html)
- [Buffer Pool](https://dev.mysql.com/doc/refman/8.4/en/innodb-buffer-pool.html)
- [Change Buffer](https://dev.mysql.com/doc/refman/8.4/en/innodb-change-buffer.html)
- [Adaptive Hash Index](https://dev.mysql.com/doc/refman/8.4/en/innodb-adaptive-hash.html)
- [Doublewrite Buffer](https://dev.mysql.com/doc/refman/8.4/en/innodb-doublewrite-buffer.html)
- [InnoDB Disk I/O](https://dev.mysql.com/doc/refman/8.4/en/innodb-disk-io.html)

版本注意：MySQL 8.4 的 innodb_change_buffering 默认值为 none，Adaptive Hash Index 默认关闭。旧版本教程里的默认行为不能直接当成 MySQL 8.4 当前事实。
