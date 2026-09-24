# 05｜事务、MVCC 与锁：并发请求到底怎样保证正确

> 前面已经知道表怎么设计、索引怎么建、SQL 怎么走到 InnoDB。
>
> 这一章只回答一件事：
>
> **两个、两百个、两万个请求同时读写同一批数据时，MySQL 怎么决定谁能看什么、谁必须等、谁应该失败重试？**

---

# 0. 先区分三类问题

## 可见性

~~~text
别人已经 UPDATE 但没 COMMIT
我普通 SELECT 到底看旧值还是新值？
~~~

主要由 MVCC + Isolation Level 决定。

## 互斥修改

~~~text
两个请求都想修改 quota.used
谁先？
~~~

主要由 Lock + Transaction 决定。

## 业务不变量

~~~text
最多只能创建 9 个 Agent
同一用户不能重复点赞同一视频
~~~

最终还需要 UNIQUE / 条件 UPDATE / 事务 / 幂等。

数据库锁不是业务设计的替代品。

---

# 1. 事务是什么边界

~~~sql
START TRANSACTION;

UPDATE quota ...;
INSERT agent_definition ...;

COMMIT;
~~~

表达 quota 占用和 Agent 创建必须一起成功或一起回滚。

事务不是把整个 HTTP 请求所有代码包起来。远程 RPC、LLM、对象存储、人工审批不应该因为“业务上相关”就放进数据库长事务。

---

# 2. Autocommit 为什么要理解

MySQL 常见默认模式下 autocommit 开启。一条普通 DML 自身就是一个事务边界。

显式 START TRANSACTION ... COMMIT 才把多条语句放在同一事务中。

如果不了解框架如何管理 autocommit 和 transaction propagation，就很容易以为自己“加锁了”，实际上锁已经随上一条语句提交释放。

---

# 3. 普通 SELECT 通常不是“拿共享锁读”

InnoDB 普通一致性 SELECT 在常见隔离级别下使用 MVCC：

~~~text
SELECT
↓
Read View
↓
判断当前 record version 是否可见
↓
必要时沿 Undo Version Chain 找旧版本
~~~

这叫 consistent nonlocking read。

因此 Writer 正在修改一行，不代表所有 Reader 都要排队等它。

---

# 4. MVCC 的最小内部模型

一条 InnoDB 记录可以简化理解为带有：

~~~text
用户字段
DB_TRX_ID
DB_ROLL_PTR
~~~

更新后：

~~~text
当前版本
trx_id = 200
value = 80
   │
   └─ roll_ptr
         ↓
      Undo Version
      trx_id = 180
      value = 100
~~~

Read View 负责判断 trx_id=200 这个版本对当前事务是否可见；如果不可见，就继续找旧版本。

---

# 5. Read View 不要只背字段公式

面试经常把 Read View 背成几个字段判断公式。

更重要的直觉是：

> Read View 是一个“在这个一致性读视角里，哪些事务版本应该被认为已经可见”的判断依据。

它解决的是：当前数据库不断有事务 COMMIT，但当前一致性读应该看到哪个逻辑时间点的数据。

---

# 6. REPEATABLE READ：为什么同一事务可以重复读

InnoDB 默认隔离级别是 REPEATABLE READ。

典型语义：

~~~text
Transaction A
第一次普通一致性 SELECT
↓
建立 snapshot / read view 语义

Transaction B
UPDATE + COMMIT

Transaction A
再次普通 SELECT
↓
仍保持该事务的一致视图
~~~

“可重复读”不是复制整张表，而是依赖 MVCC 版本链和可见性判断。

---

# 7. READ COMMITTED 有什么不同

READ COMMITTED 下，每次 consistent read 都可以建立新的已提交快照语义。

~~~text
A SELECT -> 100
B UPDATE 100 -> 80 + COMMIT
A 再 SELECT -> 80
~~~

因此 RR 和 RC 是一致性语义与并发行为的工程取舍，不是“谁更高级”。

---

# 8. 普通 SELECT 和 Current Read 要分开

普通一致性读：

~~~sql
SELECT ...;
~~~

更偏 snapshot / historical visible version。

锁定读：

~~~sql
SELECT ... FOR UPDATE;
SELECT ... FOR SHARE;
~~~

以及 UPDATE / DELETE 等，需要基于当前可锁定状态进行并发控制。

同一个事务里的 snapshot read 与 locking/current read 不是简单的同一种读取。

---

# 9. FOR UPDATE 到底在表达什么

Agent 配额：

~~~sql
SELECT used, quota
FROM user_agent_quota
WHERE tenant_id = ?
  AND user_id = ?
FOR UPDATE;
~~~

不是为了“读得更快”。

它表达的是：

> 我接下来要基于这个最新状态修改它，请给我对冲突修改的排他控制。

其他事务如果需要冲突锁，就必须等待、NOWAIT 失败，或在 SKIP LOCKED 场景下跳过。

---

# 10. FOR SHARE 又是什么

~~~sql
SELECT ... FOR SHARE;
~~~

对读到的记录设置共享模式锁。其他事务仍可以读取，但不能进行与该共享锁冲突的修改，直到事务结束。

适用于：我要确保我依赖的这些记录在本事务后续逻辑里不会被别人以冲突方式修改。

---

# 11. InnoDB 的“行锁”与索引记录强相关

InnoDB 搜索和扫描索引时，会对访问路径上的相关 index records / ranges 设置相应锁。

所以：

~~~text
SQL WHERE
↓
Optimizer 选择访问路径
↓
实际扫描哪棵索引、哪些范围
↓
直接影响 Lock 范围
~~~

这就是为什么索引设计也是并发设计。

---

# 12. Record Lock

最简单直觉：

~~~text
锁住一个已有索引记录
~~~

例如完整唯一索引等值查询：

~~~sql
SELECT *
FROM user_agent_quota
WHERE tenant_id = 1
  AND user_id = 10086
FOR UPDATE;
~~~

如果条件完整匹配唯一索引，InnoDB 可以非常精确地锁命中的 index record，而不需要像范围扫描那样保护大范围 gap。

---

# 13. Gap Lock 为什么存在

索引值：

~~~text
10  20  30  40
~~~

事务 A：

~~~sql
SELECT *
FROM t
WHERE score > 20 AND score < 30
FOR UPDATE;
~~~

当前可能一行都没有。

如果事务 B 立即插入 score=25，A 所保护的范围就被改变。

Gap Lock 的核心是：

> 锁现有索引记录之间的空隙，限制其他事务向该范围插入新的 index record。

---

# 14. Next-Key Lock

可以把它理解为：

> Next-Key Lock = Record Lock + 该记录前面的 Gap Lock。

例如索引：

~~~text
10 11 13 20
~~~

可以形成类似：

~~~text
(-∞,10]
(10,11]
(11,13]
(13,20]
(20,+∞)
~~~

的 next-key 区间。

REPEATABLE READ 下，范围型 locking read / UPDATE / DELETE 的行为经常与 next-key locking 密切相关。

---

# 15. “不存在的记录”也可能让 INSERT 等待

索引只有：

~~~text
10
20
~~~

事务 A 做某个范围型 locking read，并保护 10～20 之间的 gap。

即使 id=15 这行当前不存在，事务 B 插入 15 仍可能被阻塞。

因为保护的是：

> 索引范围，而不仅仅是已有“行对象”。

---

# 16. READ COMMITTED 的 Gap 行为和 RR 不同

READ COMMITTED 下，locking reads、UPDATE、DELETE 通常只锁 index records，而 gap locking 主要保留给外键检查和 duplicate-key checking 等场景。

因此 RC 通常减少 gap 锁冲突，但会带来不同的 phantom / snapshot 语义。

隔离级别会真实改变并发模型。

---

# 17. 为什么没有合适索引的 UPDATE 很危险

~~~sql
UPDATE t
SET status = 2
WHERE external_name = 'abc';
~~~

如果 external_name 没有合适索引，数据库可能需要扫描大量记录判断谁满足条件。

结果：

~~~text
扫描更多
↓
锁相关记录更多 / 更久
↓
其他事务等待更多
↓
Deadlock 窗口扩大
~~~

所以慢 SQL 和锁冲突经常是同一个根因的两个表现。

---

# 18. Agent Quota：为什么 SELECT COUNT 再 INSERT 会超卖

当前 used=8，quota=9。

请求 A、B 同时读到 8，然后都创建：

~~~text
最终 active Agent = 10
~~~

问题不是 MySQL 不支持事务，而是业务判断和写入之间没有形成原子约束。

---

# 19. Quota 方案一：锁状态行

~~~sql
START TRANSACTION;

SELECT used, quota
FROM user_agent_quota
WHERE tenant_id = ?
  AND user_id = ?
FOR UPDATE;

-- used < quota 才继续

INSERT INTO agent_definition (...);

UPDATE user_agent_quota
SET used = used + 1
WHERE tenant_id = ?
  AND user_id = ?;

COMMIT;
~~~

同一用户的并发创建请求会在 quota row 上串行化。

这是把高层业务不变量映射为数据库锁的典型例子。

---

# 20. Quota 方案二：原子条件 UPDATE

~~~sql
UPDATE user_agent_quota
SET used = used + 1
WHERE tenant_id = ?
  AND user_id = ?
  AND used < quota;
~~~

然后检查 affected_rows。

它把“检查 used < quota”和“used + 1”压成一个数据库原子修改条件。

很多配额、库存、计数场景都应该优先考虑这种模式，而不是先 SELECT 再决定。

---

# 21. 但热点状态行也会成为瓶颈

如果十万请求同时争同一个 tenant quota row：

~~~text
正确性没问题
但吞吐被一行串行化
~~~

这时问题已经从并发正确性变成 Hot Row Scalability。

可能需要分桶、额度预分配、专门 quota service、异步 ledger，或重新定义一致性需求。

正确不等于无限扩展。

---

# 22. SKIP LOCKED 为什么适合 Worker Queue

~~~sql
SELECT id
FROM agent_task
WHERE status = READY
  AND available_at <= NOW()
ORDER BY priority DESC, id
LIMIT 1
FOR UPDATE SKIP LOCKED;
~~~

Worker A 锁住 101；Worker B 跳过 101 继续找 102。

非常适合 job queue、batch worker、Agent dispatcher。

但它不适合要求完整一致结果集的普通报表，因为它本来就会跳过被锁记录。

---

# 23. NOWAIT 与 SKIP LOCKED 是两种策略

~~~text
普通 FOR UPDATE
= 冲突就等待

NOWAIT
= 冲突立即失败

SKIP LOCKED
= 跳过冲突记录继续找
~~~

业务语义不同，不能统一把“避免等待”理解为应该 SKIP LOCKED。

---

# 24. Deadlock 是怎样形成的

事务 A：

~~~text
锁 quota(user=1)
↓
等待 agent(id=9)
~~~

事务 B：

~~~text
锁 agent(id=9)
↓
等待 quota(user=1)
~~~

形成 A 等 B、B 等 A。

InnoDB 会检测 deadlock，并回滚其中一个事务，让另一个继续。

---

# 25. Deadlock 应该被应用重试

成熟应用应该把死锁当成一种短暂并发结果：

~~~text
deadlock
↓
rollback
↓
有限次数 retry
↓
必要时随机退避
~~~

而不是把它视作不可恢复的数据库故障。

---

# 26. 怎样减少 Deadlock

- 固定加锁顺序：例如始终先 quota，再 agent，再 child rows。
- 缩短事务：不要拿锁去调用 LLM、RPC、对象存储或等待人工审批。
- 建正确索引：减少扫描和锁定的记录。
- 批量资源按稳定顺序处理，例如按 id 递增加锁。

---

# 27. Lock Wait Timeout 和 Deadlock 不一样

Deadlock：

~~~text
形成等待环
↓
数据库检测
↓
主动回滚一个事务
~~~

Lock Wait Timeout：

~~~text
一直等待别人持有的锁
但未必形成环
↓
超过超时时间
↓
失败
~~~

排障时必须区分。

---

# 28. 为什么事务越长，Deadlock 概率越高

10 ms 与 10 s 的事务，和其他事务重叠的时间窗口完全不同。

所以“事务做的事情越多越安全”是错的。

数据库事务应该尽量小，只保护必须原子的本地状态变化。

---

# 29. 长事务为什么还会拖累 MVCC Purge

一个很老的 Read View 还活着，就可能仍需要旧版本：

~~~text
旧版本不能及时清理
↓
Undo 历史保留
↓
Purge 压力增加
~~~

所以长事务不仅是锁问题，也是版本垃圾回收问题。

---

# 30. Phantom 到底是什么

事务 A：

~~~sql
SELECT * FROM task
WHERE priority BETWEEN 10 AND 20;
~~~

得到 5 行。

事务 B 插入 priority=15。

如果 A 再执行相同范围查询看到 6 行，就出现了范围结果中的幻影行。

RR 下 locking range operation 使用 next-key locking 限制这类范围插入。

注意区分：

- 普通 consistent read：主要靠 MVCC snapshot；
- locking read / DML：会进入索引锁与 next-key locking 世界。

---

# 31. 唯一索引完整等值查询为什么锁得更精确

在 RR 下，如果 locking statement 使用 unique index + 完整唯一等值条件精确找到记录，InnoDB 只需要锁找到的 index record，不需要像范围查询那样锁前面的 gap。

例如：

~~~sql
WHERE tenant_id = ?
  AND user_id = ?
~~~

完整匹配：

~~~sql
PRIMARY KEY(tenant_id, user_id)
~~~

这也是正确唯一键让并发语义更清晰的原因。

---

# 32. 通过 Secondary Index 修改时发生什么

UPDATE 通过二级索引定位时，不只是“锁住二级索引字符串”。

执行路径会涉及：

~~~text
Secondary Index
↓
定位 primary key
↓
Clustered Record
↓
修改 row
↓
维护受影响的 indexes
~~~

分析锁冲突时，要结合访问了哪棵索引、哪些 index records，以及修改了哪些索引列。

---

# 33. 点赞幂等：UNIQUE 比锁更基础

~~~sql
UNIQUE(user_id, video_id)
~~~

即使两个请求几乎同时 INSERT，数据库最终也不会允许两份相同业务关系都成功存在。

所以并发设计通常是：

~~~text
业务幂等语义
+
UNIQUE 最终约束
+
必要时 Transaction / Lock
~~~

而不是所有问题都手工 SELECT FOR UPDATE。

---

# 34. 隔离级别不是面试表格，而是工程选择

最终应该能回答：

~~~text
为什么这个服务用 RR？
为什么这个队列可能考虑 RC？
哪些 Query 是 snapshot read？
哪些必须 locking read？
业务是否允许 phantom？
Gap Lock 冲突是不是瓶颈？
~~~

只背 RU < RC < RR < Serializable 不够。

---

# 35. 并发控制 Checklist

~~~text
[ ] 业务不变量是什么？
[ ] 能否用 UNIQUE / 条件 UPDATE 直接表达？
[ ] 是否真的需要先读再写？
[ ] 如果需要，普通 SELECT 够吗，还是 FOR UPDATE？
[ ] 访问是否走精确索引？
[ ] 是点查还是范围锁？
[ ] RR 下会不会产生 Gap / Next-Key Lock？
[ ] 事务多久？
[ ] 有没有远程调用混进事务？
[ ] Deadlock 怎么 retry？
[ ] Lock Wait 怎么监控？
[ ] 是否存在 Hot Row？
[ ] 是否有长期 Read View 阻碍 Purge？
~~~

下一章继续回答：

> [06｜COMMIT 到底如何通过 redo、binlog、fsync 与 crash recovery 变成可靠事实](./06-commit-and-consistency.md)
