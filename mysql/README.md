# MySQL 情景化学习：从短视频到 Agent

> 目标不是学会 `SELECT / INSERT / UPDATE`，而是建立一种能力：
>
> **看到一个真实业务需求时，知道哪些状态应该放 MySQL、表应该怎么拆、索引为什么这样建、事务边界在哪里、并发时会发生什么、系统规模扩大后应该怎么演化。**

这套内容默认使用 **MySQL 8.4 + InnoDB** 作为讨论基线。

---

# 0. 为什么不从“语法大全”开始

MySQL 的基础语法并不难。

真正难的是这些问题：

~~~text
用户点了一次赞
    ↓
到底写哪张表？
    ↓
为什么不是直接 UPDATE video SET like_count = like_count + 1？
    ↓
重复请求怎么办？
    ↓
Redis 和 MySQL 谁是真相？
    ↓
两个请求同时到达会不会重复点赞？
    ↓
事务该包多大？
    ↓
为什么一个索引顺序写反，锁范围和性能都会变？
~~~

或者 Agent：

~~~text
用户发出一条 Prompt
    ↓
Session / Turn / Message / Run / Step 到底怎么存？
    ↓
Tool Call 已经调用外部系统，但数据库提交失败怎么办？
    ↓
Agent 崩溃后如何 resume？
    ↓
多个 Worker 抢任务怎样避免重复执行？
    ↓
Token Usage 是 UPDATE 一个总数，还是记录一笔笔事实？
~~~

这些才是工程里真正使用 MySQL 的地方。

---

# 1. 整个课程的两条母线

## 母线 A：短视频系统

从用户打开 App 开始：

~~~mermaid
flowchart LR
    A["用户打开首页"] --> B["推荐系统返回 video_id 列表"]
    B --> C["内容服务批量取视频元数据"]
    C --> D["前端展示 20 个视频"]
    D --> E["点赞 / 收藏 / 评论 / 关注"]
    E --> F["MySQL 持久化关系与事实"]
    E --> G["Redis 承担热点状态 / 计数"]
    F --> H["Binlog / Outbox / MQ"]
    H --> I["异步统计、推荐特征、数据仓库"]
~~~

你会看到 MySQL 在不同位置承担完全不同的职责：

| 场景 | MySQL 更适合保存什么 | 不应该硬让 MySQL 做什么 |
|---|---|---|
| 视频基础信息 | 标题、作者、审核状态、发布时间 | 每次推荐都全表排序 |
| 点赞关系 | “用户 X 是否赞过视频 Y”的持久事实 | 热门视频每次点赞都争抢同一 count 行 |
| 评论 | 评论正文、父子关系、审核状态 | 用 OFFSET 100000 做深翻页 |
| 收藏 | 用户与视频的关系事实 | 把所有用户收藏塞进一个 JSON |
| 发布状态 | 草稿→审核→发布→下架的状态机 | 让多个服务无条件覆盖状态 |
| 统计 | 可恢复的事实或聚合结果 | 把高 QPS 实时计数全部压在单行 UPDATE |

---

## 母线 B：Agent 系统

从用户发出 Prompt 开始：

~~~mermaid
flowchart LR
    U["User Prompt"] --> S["Session / Turn"]
    S --> R["Run"]
    R --> P["Planner / Agent Loop"]
    P --> T["Tool Call"]
    T --> X["External System"]
    T --> DB["MySQL: tool_call / run_step"]
    P --> C["Checkpoint"]
    C --> DB
    R --> Q["Usage / Billing Ledger"]
    Q --> DB
    DB --> O["Outbox / CDC"]
    O --> W["Async Workers / Analytics"]
~~~

Agent 场景里 MySQL 常见职责是：

- 保存 **Agent 定义与版本**；
- 保存 **Session / Turn / Message 元数据**；
- 保存 **Run / Step / Tool Call 执行状态**；
- 保存 **Checkpoint 与 resume 指针**；
- 保存 **幂等键、配额、状态机版本号**；
- 保存 **Token / Cost 使用流水**；
- 保存 **Outbox Event**，把事务内事实可靠地交给异步系统。

但大段模型上下文、附件、超大 Tool Result 往往更适合对象存储，MySQL 保存索引、摘要、状态和引用。

---

# 2. 阅读顺序

| 顺序 | 章节 | 真实问题 |
|---|---|---|
| 1 | [短视频：点赞、评论、发布与热点数据](./01-short-video-scenes.md) | MySQL 在高并发内容业务里到底放什么、怎么查、怎么写 |
| 2 | [Agent：Session、Run、Tool Call、Resume 与配额](./02-agent-scenes.md) | Agent 为什么需要关系数据库，执行状态怎么持久化 |
| 3 | [从场景反推 InnoDB：索引、MVCC、锁与事务](./03-innodb-from-scenes.md) | 为什么这些 SQL 会快、会阻塞、会死锁 |
| 4 | [从一次 COMMIT 到宕机恢复：redo、undo、binlog 与 Outbox](./04-commit-and-consistency.md) | 数据究竟什么时候算“写成功” |
| 5 | [规模上来以后：慢查询、热点、读写分离、分库分表](./05-scaling-and-operations.md) | 单机 MySQL 什么时候不够，应该先优化什么 |
| - | [参考资料](./SOURCES.md) | MySQL 官方文档与进一步阅读 |

---

# 3. 学习时永远先问这 7 个问题

以后看到一张表，不要先背字段。

先问：

~~~text
① 这张表保存的是“事实”、 “当前状态”还是“缓存”？
② 谁写它？谁读它？
③ 最常见的查询条件是什么？
④ 最常见的排序是什么？
⑤ 哪些字段需要唯一约束来兜底？
⑥ 两个请求同时修改时，谁赢？
⑦ 数据量增长 1000 倍后，哪一步最先坏？
~~~

这七个问题基本会自然推出：

~~~text
表结构
  ↓
主键
  ↓
唯一索引
  ↓
联合索引
  ↓
事务边界
  ↓
锁
  ↓
缓存 / MQ / 分片
~~~

---

# 4. 一个最重要的认知：MySQL 不是“整个系统”

以点赞为例。

错误心智模型：

~~~text
用户点赞
   ↓
MySQL
   ↓
结束
~~~

真实系统更像：

~~~mermaid
flowchart LR
    A["App"] --> B["Like API"]
    B --> C["幂等 / 权限校验"]
    C --> D["MySQL: 点赞关系事实"]
    C --> E["Redis: 热点状态 / 计数"]
    D --> F["Outbox / Binlog"]
    F --> G["MQ"]
    G --> H["统计 / 推荐 / 风控 / 数仓"]
~~~

MySQL 很重要，但它通常负责：

> **长期、可恢复、需要约束、需要事务的核心事实。**

而不是承担所有毫秒级高频读取、所有热点计数、所有全文检索、所有分析查询。

Agent 也是一样。

---

# 5. 为什么课程会反复出现“事实表”和“状态表”

例如点赞：

~~~text
video_like
(user_id, video_id, created_at)
~~~

这是一条关系事实：

> 用户 10086 点赞了视频 9001。

而：

~~~text
video.like_count = 18273645
~~~

是一个聚合状态。

它可以由大量事实推导得到。

同样 Agent：

~~~text
usage_ledger
(run_id, model, input_tokens, output_tokens, cost)
~~~

是使用事实。

~~~text
user_usage_daily.total_tokens
~~~

是聚合状态。

工程上常见原则：

> **事实尽量可追溯，聚合可以重建。**

这也是为什么很多复杂系统最终会自然引出：

- Binlog / CDC
- Outbox Pattern
- Event / Ledger
- 异步投影
- Redis / OLAP

---

# 6. 这套课程会重点深挖哪些 MySQL 核心

不是为了背八股，而是让它们和业务问题绑定：

### 索引

从：

> “我要查某用户最近点赞的 20 个视频”

推导：

~~~sql
KEY idx_user_created (user_id, created_at DESC, video_id)
~~~

再解释：

- 为什么 `user_id` 在前；
- 为什么 `created_at` 在后；
- 为什么还带 `video_id`；
- 什么是最左前缀；
- 什么是覆盖索引；
- 为什么二级索引里还隐含主键；
- 为什么索引越多写入越贵。

### 事务与锁

从：

> “用户只能创建最多 9 个 Agent”

推导：

- 为什么先查再插会超卖；
- `SELECT ... FOR UPDATE` 锁的是谁；
- 为什么没有合适索引时锁范围会变大；
- 为什么事务里不要做模型调用；
- 什么叫死锁；
- 为什么所有代码按相同顺序加锁能减少死锁。

### MVCC

从：

> “一个长事务为什么让线上库越来越胖？”

推导：

- Read View；
- undo log；
- 旧版本链；
- Purge；
- REPEATABLE READ 与 READ COMMITTED。

### redo / undo / binlog

从：

> “COMMIT 返回成功以后突然断电，数据为什么还能回来？”

推导：

- buffer pool；
- WAL；
- redo；
- undo；
- binlog；
- crash recovery；
- replication；
- Outbox。

---

# 7. 课程的最终目标

学完以后，你应该能够面对一个新需求，例如：

> “支持 Agent 定时任务，每个用户最多运行 5 个并发任务，Worker 可以水平扩容，任务失败后可恢复，外部 Tool 不能重复扣款。”

然后自己推导出：

~~~text
task 表怎么建
↓
状态机怎么定义
↓
唯一键 / 幂等键放哪里
↓
Worker 怎么抢任务
↓
哪里用 FOR UPDATE / SKIP LOCKED
↓
事务边界在哪里
↓
Tool 外部副作用如何与 DB 状态协调
↓
如何做 checkpoint
↓
如何做 usage ledger
↓
如何异步投影统计
~~~

到这一步，你学到的才不是“MySQL 语法”，而是 **数据库工程能力**。
