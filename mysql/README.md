# MySQL 完整学习路线：数据库设计 × 索引设计 × InnoDB 内核 × 事务与扩展

> 目标不是“会写 SQL”，而是：
>
> **拿到一个真实业务需求，能自己从 0 推导出数据库边界、实体关系、表、字段、主键、唯一约束、索引、事务、并发策略、失败恢复与扩展方案。**

这套内容默认以 MySQL 8.4 + InnoDB 为讨论基线。

---

# 0. 这套课现在的核心已经改变

不是：

~~~text
SELECT
INSERT
索引
事务
MVCC
redo
binlog
~~~

从概念往业务里硬套。

而是：

~~~text
产品需求
↓
Use Case / Command
↓
Query
↓
业务不变量
↓
领域对象与关系
↓
数据库边界
↓
表设计
↓
主键 / UNIQUE / 字段
↓
索引
↓
事务边界
↓
并发
↓
失败与恢复
↓
数据生命周期
↓
容量与扩展
↓
最后反推 InnoDB 为什么这样工作
~~~

所以这套路线不会把“数据库设计”和“MySQL 本身”二选一：前 3 章先建立真实业务问题，03 开始系统学习索引，04～06 再深入 InnoDB、事务、MVCC、锁与日志，让设计决策能够落到底层机制。

---

# 0.1 你最终要同时具备三层能力

~~~text
第一层：Schema / 数据库设计
业务对象怎么拆？
表为什么存在？
约束怎么表达？

第二层：Query / Index 设计
一条 SQL 应该走哪棵索引？
联合索引字段顺序怎么排？
如何用 EXPLAIN / EXPLAIN ANALYZE 验证？

第三层：InnoDB 内核
B+Tree / Page / Buffer Pool 怎么工作？
MVCC 为什么能做到读写并发？
Record / Gap / Next-Key Lock 锁在哪里？
Redo / Undo / Binlog / Doublewrite 分别解决什么？
~~~

三层不能缺一层：

~~~text
只会 Schema
→ 会画表，但不知道 SQL 为什么慢

只会索引口诀
→ 会背最左前缀，但不会从业务 Query 推导

只会 InnoDB 八股
→ 会背 Buffer Pool / Redo，却不会把机制用于真实系统

三层串起来
→ 才能从需求一直推导到物理执行
~~~

---

# 1. 第一张总图：数据库设计到底在设计什么

~~~mermaid
flowchart LR
    R["业务需求"] --> U["Use Cases"]
    U --> Q["Query Matrix"]
    U --> I["Invariant Matrix"]
    Q --> D["Domain Model"]
    I --> D
    D --> B["Database Boundary"]
    B --> T["Tables"]
    T --> K["Keys / Constraints"]
    Q --> X["Indexes"]
    I --> TX["Transactions / Locks"]
    T --> L["Lifecycle"]
    L --> C["Capacity"]
    C --> S["Scaling"]
~~~

真正优秀的 DDL 应该能解释：

> 每张表为什么存在？每个字段属于哪个生命周期？每个索引对应哪条查询？每个 UNIQUE 保护哪个业务规则？

---

# 2. 课程的四张核心设计表

以后设计任何数据库，都先写这四张表。

## Query Matrix

~~~text
谁查？
WHERE 是什么？
ORDER BY 是什么？
返回多少？
调用频率多少？
~~~

用于反推索引和读模型。

## Invariant Matrix

~~~text
哪些规则任何时候都不能被破坏？
~~~

用于反推：

- PRIMARY KEY；
- UNIQUE；
- NOT NULL；
- CHECK；
- 条件 UPDATE；
- Lock；
- Transaction。

## Mutation Matrix

~~~text
一次写操作改哪些表？
哪些修改必须一起成功？
哪些步骤是远程副作用？
~~~

用于反推事务边界和状态机。

## Failure Matrix

~~~text
如果任何一步宕机，数据库是什么状态？
外部世界是什么状态？
如何重试、对账、补偿？
~~~

用于反推：

- 幂等；
- Outbox；
- Lease；
- Checkpoint；
- Reconciliation。

---

# 3. 两条真实业务母线

## 短视频

不是只讲点赞。

会完整覆盖：

~~~text
视频上传
↓
分片上传
↓
对象存储
↓
转码
↓
草稿
↓
版本
↓
机器/人工审核
↓
定时发布
↓
Feed 元数据
↓
点赞
↓
收藏夹
↓
评论/回复
↓
关注
↓
举报
↓
热点计数
↓
曝光/播放行为
↓
CDC / 推荐 / 搜索 / OLAP
~~~

重点是看这些场景为什么不能共用一张万能 video 表。

## Agent

也不是只讲 Session 和 Run。

会覆盖：

~~~text
Agent Definition / Version
↓
多人 Session
↓
Turn / Retry
↓
Run / Step
↓
Task / Lease
↓
Tool Call
↓
高风险 Tool Approval
↓
UNKNOWN 外部状态
↓
Checkpoint / Resume
↓
定时 Agent
↓
Agent 创建配额
↓
Run 并发配额
↓
月度 Token 配额
↓
Usage Ledger
↓
Billing / Audit
~~~

重点是学习如何持久化一个长时间、会失败、有外部副作用的状态机。

---

# 4. 推荐阅读顺序

| 顺序 | 章节 | 核心问题 |
|---|---|---|
| 1 | [00｜从业务需求设计数据库与表](./00-database-table-design.md) | 一张表到底应该怎么从 0 设计出来 |
| 2 | [01｜短视频：从产品需求一步步设计数据库](./01-short-video-scenes.md) | 视频、版本、资产、审核、发布、点赞、收藏、评论、关注如何拆表 |
| 3 | [02｜Agent：从产品需求一步步设计数据库](./02-agent-scenes.md) | Agent、Session、Run、Tool、Checkpoint、Quota、Billing 如何持久化 |
| 4 | [03｜MySQL 索引怎么设计](./03-index-design.md) | 联合索引顺序、范围、排序、覆盖、ICP、EXPLAIN / ANALYZE |
| 5 | [04｜MySQL / InnoDB 内部](./04-innodb-internals.md) | Parser、Optimizer、Executor、Page、Buffer Pool、B+Tree、Redo/Undo |
| 6 | [05｜事务、MVCC 与锁](./05-transactions-mvcc-locks.md) | Read View、隔离级别、Record/Gap/Next-Key Lock、Deadlock |
| 7 | [06｜从 COMMIT 到宕机恢复](./06-commit-and-consistency.md) | redo、undo、binlog、WAL、Group Commit、Crash Recovery |
| 8 | [07｜规模上来以后](./07-scaling-and-operations.md) | 慢查询、热点、Replica、Partition、Shard、Online DDL |
| 9 | [08｜复杂设计案例库](./08-complex-design-casebook.md) | 评论、关注、上传、审批、定时任务、月度配额等综合案例 |
| - | [参考资料](./SOURCES.md) | MySQL 8.4 官方文档与工程模式说明 |

---

# 5. 00 章必须掌握什么

看完 00 章，你应该能回答：

~~~text
为什么 video 和 video_revision 应该拆开？
为什么审核记录不应该只是 video.review_status？
为什么业务 UNIQUE 和 surrogate primary key 可以同时存在？
什么时候多对多关系应该建中间表？
NULL、空串、0 有什么业务差异？
status 为什么会状态爆炸？
怎么从 Query Matrix 推导联合索引？
怎么从 Invariant Matrix 推导事务和锁？
什么时候 FK 合理，什么时候应该放在服务边界外？
什么时候 JSON 合理，什么时候应该升格成正式列？
软删除到底涉及哪些生命周期问题？
容量估算为什么也是表设计的一部分？
~~~

这些比背“最左前缀原则”更早、更核心。

---

# 6. 短视频章节现在重点看什么

先看这组拆分：

~~~text
video
= 长期身份

video_revision
= 内容版本

video_asset
= 文件与转码资产

moderation_task
= 每次审核尝试

publish_job
= 可失败、可重试的发布任务

video_like
= 点赞关系事实

video_favorite
= 收藏关系

favorite_folder
= 收藏容器

comment
= 评论事实

user_follow
= 社交边
~~~

然后再看索引、事务和热点。

核心不是“这些表名要照抄”。

而是理解：

> 为什么它们具有不同生命周期，所以值得拆成不同表。

---

# 7. Agent 章节现在重点看什么

先区分：

~~~text
Agent Definition
≠ Agent Version

Session
≠ Turn
≠ Run

Run Step
≠ Tool Call

Tool Call
≠ Tool Approval

Quota
≠ Usage Ledger

Schedule
≠ Scheduled Occurrence
≠ Run
~~~

例如：

~~~text
Turn T18
├─ Run R1 失败
├─ Run R2 用户 Retry
└─ Run R3 Resume
~~~

这就是为什么不能把“聊天消息 + 执行状态”都压进 message 表。

---

# 8. 为什么后面还要学 InnoDB

设计完成后，我们再追问：

~~~text
为什么 PRIMARY KEY 会影响整张表的物理组织？
为什么二级索引携带主键？
为什么联合索引顺序会影响过滤和排序？
为什么 FOR UPDATE 的锁范围和索引有关？
为什么普通 SELECT 可以读旧版本？
为什么长事务影响 undo purge？
为什么 COMMIT 返回后断电还能恢复？
~~~

这时 B+Tree、MVCC、Lock、Redo 就不再是八股，而是在解释前面真实设计为什么有效。

---

# 9. 最终目标：面对陌生业务也能自己设计

例如突然给你需求：

> 企业 Agent 平台支持多人协作、每天定时运行、高风险 Tool 人工审批、Run 可恢复、每租户每月 1 亿 Token、历史审计保留 180 天。

你应该能自己推导：

~~~text
先列 Use Case
↓
Query Matrix
↓
Invariant Matrix
↓
实体 / 生命周期
↓
Database Boundary
↓
Table Schema
↓
Unique Constraints
↓
Indexes
↓
Mutation Matrix
↓
Transaction
↓
Retry / Idempotency
↓
Failure Matrix
↓
Data Lifecycle
↓
Capacity / Sharding
~~~

到这一步，才算真正具备 MySQL / OLTP 数据库工程能力。
