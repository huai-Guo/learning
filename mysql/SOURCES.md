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
