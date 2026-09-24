# 02｜Agent 场景：Session、Run、Tool Call、Resume 与配额

> 很多人第一次做 Agent，会觉得：
>
> “模型上下文都在内存里，为什么还需要 MySQL？”
>
> 真正进入生产系统以后，MySQL 往往不是拿来“存 Prompt”这么简单，而是用来保存 **可恢复执行状态、版本、幂等、配额、审计与使用事实**。

---

# 0. 先区分 6 个经常被混在一起的对象

假设用户打开一个 Coding Agent：

~~~text
用户：
“帮我修复支付接口里的并发问题”
~~~

至少可以拆成：

~~~mermaid
flowchart LR
    S["Session<br/>会话"] --> T["Turn<br/>一次用户交互"]
    T --> R["Run<br/>一次执行实例"]
    R --> ST["Run Step<br/>模型/工具步骤"]
    ST --> TC["Tool Call<br/>具体外部操作"]
    R --> CP["Checkpoint<br/>恢复点"]
~~~

先记最重要的关系：

~~~text
Session
  └─ Turn 1
      └─ Run A
          ├─ Step 1: Model
          ├─ Step 2: Tool
          ├─ Step 3: Model
          └─ Checkpoint
  └─ Turn 2
      └─ Run B
~~~

这几个概念绝对不要揉成一张 message 表。

---

# 1. Session：用户长期对话容器

~~~sql
CREATE TABLE agent_session (
    id           BIGINT UNSIGNED NOT NULL,
    tenant_id    BIGINT UNSIGNED NOT NULL,
    user_id      BIGINT UNSIGNED NOT NULL,
    agent_id     BIGINT UNSIGNED NOT NULL,
    title        VARCHAR(256) NULL,
    status       TINYINT NOT NULL,
    created_at   DATETIME(3) NOT NULL,
    updated_at   DATETIME(3) NOT NULL,

    PRIMARY KEY (id),
    KEY idx_user_updated (tenant_id, user_id, updated_at DESC, id DESC)
) ENGINE=InnoDB;
~~~

Session 解决的是：

> “用户正在和哪个 Agent 保持一段连续对话？”

它不是：

> “当前这个执行进程跑到第几步？”

执行状态应该交给 Run。

---

# 2. Turn：一次用户输入与它对应的回答周期

~~~sql
CREATE TABLE agent_turn (
    id              BIGINT UNSIGNED NOT NULL,
    session_id      BIGINT UNSIGNED NOT NULL,
    turn_no         INT UNSIGNED NOT NULL,
    user_message_id BIGINT UNSIGNED NOT NULL,
    status          TINYINT NOT NULL,
    created_at      DATETIME(3) NOT NULL,
    completed_at    DATETIME(3) NULL,

    PRIMARY KEY (id),
    UNIQUE KEY uk_session_turn (session_id, turn_no),
    KEY idx_session_created (session_id, created_at, id)
) ENGINE=InnoDB;
~~~

为什么需要 turn_no 唯一约束？

因为：

~~~text
同一个 session
第 18 轮
不能被并发请求创建两份
~~~

数据库唯一约束再次承担：

> 最后的并发正确性防线。

---

# 3. Message：对话内容，不等于执行状态

~~~sql
CREATE TABLE agent_message (
    id           BIGINT UNSIGNED NOT NULL,
    session_id   BIGINT UNSIGNED NOT NULL,
    turn_id      BIGINT UNSIGNED NOT NULL,
    seq_no       INT UNSIGNED NOT NULL,
    role         TINYINT NOT NULL,
    content_type TINYINT NOT NULL,
    content_json JSON NULL,
    content_ref  VARCHAR(1024) NULL,
    created_at   DATETIME(3) NOT NULL,

    PRIMARY KEY (id),
    UNIQUE KEY uk_turn_seq (turn_id, seq_no),
    KEY idx_session_id (session_id, id)
) ENGINE=InnoDB;
~~~

## 为什么同时有 content_json 和 content_ref？

真实 Agent 可能出现：

~~~text
Tool Result = 20 MB 日志
附件 = 100 MB
代码仓库快照 = 几百 MB
模型上下文压缩产物 = 大块文本
~~~

不要把所有东西都塞进 MySQL。

常见做法：

~~~text
MySQL
  ↓
保存：
状态
顺序
类型
摘要
对象存储 URI
hash
metadata

Object Storage
  ↓
保存：
大文本
附件
日志
artifact
checkpoint blob
~~~

这就是：

> **metadata in MySQL, blob in object storage**

---

# 4. Run：真正的一次执行实例

一个 Turn 可能不只对应一个 Run。

例如：

~~~text
Run A
  ↓
Worker 崩溃
  ↓
重新调度

Run B
  ↓
从 checkpoint 恢复
~~~

或者：

~~~text
用户点击 Retry
↓
同一 Turn 再执行一次
~~~

因此：

~~~sql
CREATE TABLE agent_run (
    id               BIGINT UNSIGNED NOT NULL,
    tenant_id        BIGINT UNSIGNED NOT NULL,
    session_id       BIGINT UNSIGNED NOT NULL,
    turn_id          BIGINT UNSIGNED NOT NULL,
    agent_version_id BIGINT UNSIGNED NOT NULL,
    attempt_no       INT UNSIGNED NOT NULL,
    status           TINYINT NOT NULL,
    worker_id        VARCHAR(128) NULL,
    lease_until      DATETIME(3) NULL,
    started_at       DATETIME(3) NULL,
    finished_at      DATETIME(3) NULL,
    created_at       DATETIME(3) NOT NULL,
    updated_at       DATETIME(3) NOT NULL,

    PRIMARY KEY (id),
    UNIQUE KEY uk_turn_attempt (turn_id, attempt_no),
    KEY idx_dispatch (status, lease_until, created_at, id),
    KEY idx_session_created (session_id, created_at DESC, id DESC)
) ENGINE=InnoDB;
~~~

---

# 5. 为什么 Run 必须记录 agent_version_id

假设 Agent 当前配置：

~~~text
System Prompt v7
Model = GPT-X
Tool Set = [git, shell, browser]
~~~

Run 跑到一半，管理员把 Agent 改成：

~~~text
System Prompt v8
Tool Set = [git, shell]
~~~

如果 Run 每一步都读取“当前最新版配置”：

~~~text
同一次执行
前半段使用 v7
后半段突然变成 v8
~~~

它就不可复现了。

所以：

> **Run 启动时应该绑定一个不可变版本。**

---

# 6. Agent Definition 与 Agent Version 分开

~~~sql
CREATE TABLE agent_definition (
    id                 BIGINT UNSIGNED NOT NULL,
    tenant_id          BIGINT UNSIGNED NOT NULL,
    owner_user_id      BIGINT UNSIGNED NOT NULL,
    name               VARCHAR(128) NOT NULL,
    current_version_id BIGINT UNSIGNED NULL,
    lifecycle_status   TINYINT NOT NULL,
    created_at         DATETIME(3) NOT NULL,
    updated_at         DATETIME(3) NOT NULL,

    PRIMARY KEY (id),
    KEY idx_owner_status
        (tenant_id, owner_user_id, lifecycle_status, updated_at DESC, id DESC)
) ENGINE=InnoDB;
~~~

~~~sql
CREATE TABLE agent_version (
    id          BIGINT UNSIGNED NOT NULL,
    agent_id    BIGINT UNSIGNED NOT NULL,
    version_no  INT UNSIGNED NOT NULL,
    model_config JSON NOT NULL,
    prompt_ref  VARCHAR(1024) NOT NULL,
    tool_config JSON NOT NULL,
    config_hash BINARY(32) NOT NULL,
    created_at  DATETIME(3) NOT NULL,

    PRIMARY KEY (id),
    UNIQUE KEY uk_agent_version (agent_id, version_no)
) ENGINE=InnoDB;
~~~

关系：

~~~text
Agent Definition
  ↓
“这是哪个 Agent”

Agent Version
  ↓
“这个 Agent 的某个不可变配置快照”
~~~

这个模式和 workflow version、prompt version、model deployment version、rule version 本质上是同一种工程思想。

---

# 7. Run Step：Agent Loop 的持久化骨架

~~~sql
CREATE TABLE agent_run_step (
    id           BIGINT UNSIGNED NOT NULL,
    run_id       BIGINT UNSIGNED NOT NULL,
    step_no      INT UNSIGNED NOT NULL,
    step_type    TINYINT NOT NULL,
    status       TINYINT NOT NULL,
    input_ref    VARCHAR(1024) NULL,
    output_ref   VARCHAR(1024) NULL,
    started_at   DATETIME(3) NULL,
    finished_at  DATETIME(3) NULL,
    created_at   DATETIME(3) NOT NULL,

    PRIMARY KEY (id),
    UNIQUE KEY uk_run_step (run_id, step_no),
    KEY idx_run_status (run_id, status, step_no)
) ENGINE=InnoDB;
~~~

例如：

~~~text
step 1  MODEL_CALL
step 2  TOOL_CALL
step 3  MODEL_CALL
step 4  TOOL_CALL
step 5  MODEL_CALL
~~~

持久化 Step 的价值：

- 运行轨迹可审计；
- 可以判断失败在哪一步；
- 可以统计模型/工具耗时；
- resume 时知道哪些步骤已经完成；
- 可以构造可视化 timeline。

---

# 8. Tool Call：真正棘手的是“外部副作用”

假设 Agent 调用：

~~~text
charge_credit_card()
send_email()
create_github_issue()
delete_cloud_resource()
~~~

这些操作一旦成功：

> 不是回滚 MySQL 就能撤回的。

所以必须独立记录。

~~~sql
CREATE TABLE agent_tool_call (
    id                  BIGINT UNSIGNED NOT NULL,
    run_id              BIGINT UNSIGNED NOT NULL,
    step_id             BIGINT UNSIGNED NOT NULL,
    tool_call_id        VARCHAR(128) NOT NULL,
    idempotency_key     VARCHAR(128) NOT NULL,
    tool_name           VARCHAR(128) NOT NULL,
    status              TINYINT NOT NULL,
    arguments_json      JSON NOT NULL,
    result_ref          VARCHAR(1024) NULL,
    external_request_id VARCHAR(256) NULL,
    started_at          DATETIME(3) NULL,
    finished_at         DATETIME(3) NULL,
    created_at          DATETIME(3) NOT NULL,
    updated_at          DATETIME(3) NOT NULL,

    PRIMARY KEY (id),
    UNIQUE KEY uk_tool_call (run_id, tool_call_id),
    UNIQUE KEY uk_idempotency (idempotency_key),
    KEY idx_run_status (run_id, status, id)
) ENGINE=InnoDB;
~~~

---

# 9. 为什么“数据库事务 + 外部 API”无法天然原子

你可能想：

~~~text
BEGIN
↓
调用支付 API
↓
UPDATE tool_call = SUCCESS
↓
COMMIT
~~~

问题：

~~~text
支付 API 已扣款
↓
MySQL COMMIT 前机器断电
~~~

数据库恢复后看到：

~~~text
tool_call 还是 RUNNING
~~~

但现实世界：

~~~text
钱已经扣了
~~~

MySQL 的 rollback 没法让银行卡自动退款。

---

# 10. Tool Call 的正确目标不是“魔法 exactly-once”

更现实的是：

> **at-least-once execution + idempotency + reconciliation**

流程：

~~~mermaid
sequenceDiagram
    participant W as Worker
    participant DB as MySQL
    participant X as External Tool

    W->>DB: INSERT tool_call(PENDING, idempotency_key)
    DB-->>W: committed

    W->>X: execute(idempotency_key)
    X-->>W: success + external_request_id

    W->>DB: UPDATE tool_call = SUCCESS
~~~

如果 Worker 在最后一步之前崩溃：

~~~text
DB = PENDING
External = 已成功
~~~

恢复时：

~~~text
用同一个 idempotency_key 重试
~~~

如果外部系统支持幂等，就不会重复扣款，而是返回第一次结果。

如果外部系统支持查询 request status，则先 reconcile，再决定是否重试。

---

# 11. Checkpoint：为什么不能只靠 Message 恢复

模型消息只能告诉你：

~~~text
“模型说了什么”
~~~

但不一定告诉你：

~~~text
当前工作目录是哪一个 commit
哪些文件已经修改
哪些 Tool Call 已完成
Planner 当前节点
哪些外部副作用已经发生
临时变量/预算还剩多少
~~~

所以生产 Agent 常需要 checkpoint。

~~~sql
CREATE TABLE agent_checkpoint (
    id            BIGINT UNSIGNED NOT NULL,
    run_id        BIGINT UNSIGNED NOT NULL,
    checkpoint_no INT UNSIGNED NOT NULL,
    step_no       INT UNSIGNED NOT NULL,
    state_ref     VARCHAR(1024) NOT NULL,
    state_hash    BINARY(32) NOT NULL,
    created_at    DATETIME(3) NOT NULL,

    PRIMARY KEY (id),
    UNIQUE KEY uk_run_checkpoint (run_id, checkpoint_no),
    KEY idx_run_latest (run_id, checkpoint_no DESC)
) ENGINE=InnoDB;
~~~

真正的大状态放 S3 / OSS / MinIO / Blob Storage。

MySQL 保存：

~~~text
run_id
checkpoint_no
step_no
state_ref
hash
time
~~~

---

# 12. Resume 到底根据什么恢复

可以把 resume 想成：

~~~text
run_id
  ↓
找到 Run
  ↓
找到绑定的 agent_version
  ↓
找到最新 checkpoint
  ↓
读取 checkpoint blob
  ↓
核对已完成 run_step
  ↓
核对 tool_call 外部副作用
  ↓
重新建立内存状态
  ↓
从下一安全步骤继续
~~~

所以：

> **run_id 是执行身份，不应该和 session_id 混淆。**

Session 解决：

~~~text
“这是哪段对话？”
~~~

Run 解决：

~~~text
“这一次执行实例是谁？”
~~~

Checkpoint 解决：

~~~text
“这次执行跑到哪里？”
~~~

---

# 13. 为什么 Resume 不能简单“从最后一条消息继续”

例如：

~~~text
Step 18:
Agent 调用 GitHub API 创建 Issue

GitHub:
Issue #381 创建成功

Worker:
还没写 SUCCESS
机器断电
~~~

最后一条 message 可能仍停在：

~~~text
“我准备创建 issue”
~~~

如果只重放消息：

~~~text
再次创建 Issue
↓
重复副作用
~~~

所以 resume 必须结合：

- tool_call 状态；
- idempotency_key；
- external_request_id；
- checkpoint；
- 必要时外部系统 reconcile。

---

# 14. 场景：多个 Worker 抢任务

假设有：

~~~text
10000 个 READY Agent Task
100 个 Worker
~~~

不能让所有 Worker：

~~~sql
SELECT id
FROM agent_task
WHERE status = 0
LIMIT 1;
~~~

因为它们可能拿到同一行。

---

# 15. 使用 FOR UPDATE SKIP LOCKED 做数据库任务队列

简化表：

~~~sql
CREATE TABLE agent_task (
    id           BIGINT UNSIGNED NOT NULL,
    tenant_id    BIGINT UNSIGNED NOT NULL,
    run_id       BIGINT UNSIGNED NOT NULL,
    priority     INT NOT NULL,
    status       TINYINT NOT NULL,
    available_at DATETIME(3) NOT NULL,
    lease_until  DATETIME(3) NULL,
    worker_id    VARCHAR(128) NULL,
    created_at   DATETIME(3) NOT NULL,
    updated_at   DATETIME(3) NOT NULL,

    PRIMARY KEY (id),
    KEY idx_ready (status, available_at, priority DESC, id)
) ENGINE=InnoDB;
~~~

Worker：

~~~sql
START TRANSACTION;

SELECT id
FROM agent_task
WHERE status = 0
  AND available_at <= NOW(3)
ORDER BY priority DESC, id
LIMIT 1
FOR UPDATE SKIP LOCKED;

UPDATE agent_task
SET status = 1,
    worker_id = ?,
    lease_until = DATE_ADD(NOW(3), INTERVAL 60 SECOND)
WHERE id = ?;

COMMIT;
~~~

多个 Worker 同时执行：

~~~text
Worker A 锁 task 101
Worker B 跳过 101，拿 102
Worker C 拿 103
~~~

这就是 SKIP LOCKED 很典型的生产用途。

---

# 16. 为什么抢到任务以后要立刻 COMMIT

错误：

~~~text
BEGIN
↓
FOR UPDATE 拿任务
↓
调用 LLM 30 秒
↓
调用 Tool 20 秒
↓
COMMIT
~~~

这意味着事务和锁持续几十秒。

正确方式：

~~~text
短事务：
抢任务 + 标记 RUNNING + lease
↓
COMMIT

事务外：
真正跑模型 / Tool
~~~

再用 lease 解决 Worker 死亡。

---

# 17. Lease：Worker 崩了怎么办

任务：

~~~text
status = RUNNING
worker_id = worker-17
lease_until = 14:31:00
~~~

如果 14:31:00 以后 worker-17 没续租，调度器可以认定：

> 这个任务可能失去执行者。

然后重新进入 READY，或者创建新的 attempt。

注意：

> lease 只能解决“谁有资格执行”，不能自动解决外部 Tool 是否已经成功。

所以还必须配合 Tool Call 幂等。

---

# 18. 场景：每个用户最多创建 9 个 Agent

这是非常经典的 quota / inventory / seat limit。

错误：

~~~text
SELECT COUNT(*)
↓
发现 = 8
↓
允许创建
~~~

两个并发请求：

~~~text
A 看到 8
B 看到 8
A 创建
B 创建
最终 = 10
~~~

超配额了。

---

# 19. 方案一：锁 quota 行

~~~sql
CREATE TABLE user_agent_quota (
    tenant_id BIGINT UNSIGNED NOT NULL,
    user_id   BIGINT UNSIGNED NOT NULL,
    used      INT UNSIGNED NOT NULL,
    quota     INT UNSIGNED NOT NULL,
    version   INT UNSIGNED NOT NULL DEFAULT 0,
    updated_at DATETIME(3) NOT NULL,

    PRIMARY KEY (tenant_id, user_id)
) ENGINE=InnoDB;
~~~

事务：

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
SET used = used + 1,
    version = version + 1,
    updated_at = NOW(3)
WHERE tenant_id = ?
  AND user_id = ?;

COMMIT;
~~~

同一个用户的并发创建会在 quota 行上排队。

---

# 20. 方案二：条件 UPDATE 更紧凑

~~~sql
START TRANSACTION;

UPDATE user_agent_quota
SET used = used + 1,
    version = version + 1,
    updated_at = NOW(3)
WHERE tenant_id = ?
  AND user_id = ?
  AND used < quota;

-- affected_rows == 0 => 没有额度

INSERT INTO agent_definition (...);

COMMIT;
~~~

如果 INSERT 失败：

~~~text
整个事务 rollback
↓
used + 1 也回滚
~~~

这就是事务真正有价值的地方：

> **多个本地数据库修改要么一起成功，要么一起失败。**

---

# 21. Archive / Restore 为什么也属于配额问题

如果业务规定：

~~~text
只有 active Agent 占配额
~~~

那么：

~~~text
create    used +1
archive   used -1
restore   used +1
delete    根据状态决定
~~~

这些操作必须统一使用同一套状态机。

否则很容易出现：

~~~text
create 时加了
archive 时忘减
restore 又加一次
↓
quota 漂移
~~~

所以不要把“配额限制”理解成只改 Create API。

它其实是：

> **整个资源生命周期的不变量。**

---

# 22. 用状态条件保证 Archive 幂等

例如：

~~~sql
UPDATE agent_definition
SET lifecycle_status = 2,
    updated_at = NOW(3)
WHERE id = ?
  AND lifecycle_status = 1;
~~~

只有 ACTIVE -> ARCHIVED 真的发生时，才 quota used -1。

重复 archive：

~~~text
affected_rows = 0
↓
不再减 quota
~~~

这和点赞的 active 0 -> 1 才 count +1，本质上是同一个问题：

> **请求次数不等于状态变化次数。**

---

# 23. 场景：Token / Cost 怎么存

一个很常见的错误：

~~~sql
UPDATE user_usage
SET total_tokens = total_tokens + 8472
WHERE user_id = ?;
~~~

所有请求不断争一行。

而且：

~~~text
为什么今天账单多了 200 万 token？
~~~

你很难追溯。

---

# 24. Ledger：先记录事实，再做聚合

~~~sql
CREATE TABLE usage_ledger (
    id            BIGINT UNSIGNED NOT NULL,
    tenant_id     BIGINT UNSIGNED NOT NULL,
    user_id       BIGINT UNSIGNED NOT NULL,
    run_id        BIGINT UNSIGNED NOT NULL,
    step_id       BIGINT UNSIGNED NULL,
    provider      VARCHAR(64) NOT NULL,
    model         VARCHAR(128) NOT NULL,
    input_tokens  INT UNSIGNED NOT NULL,
    output_tokens INT UNSIGNED NOT NULL,
    cost_micros   BIGINT UNSIGNED NOT NULL,
    created_at    DATETIME(3) NOT NULL,

    PRIMARY KEY (id),
    KEY idx_user_time (tenant_id, user_id, created_at, id),
    KEY idx_run (run_id, id)
) ENGINE=InnoDB;
~~~

每次模型调用追加一条。

然后异步生成：

~~~text
user_usage_daily
tenant_usage_hourly
billing_invoice
model_cost_daily
~~~

---

# 25. 为什么 Ledger 比“一个总数”强

Ledger 可以回答：

~~~text
哪一个 run 花的？
哪个模型花的？
什么时候花的？
输入 token 还是输出 token？
能不能重新算账？
某个聚合任务算错了能不能重放？
~~~

这也是很多支付、计费、库存、积分系统喜欢 append-only ledger 的原因。

---

# 26. Agent 场景下 JSON 应该怎么用

MySQL JSON 很方便，但不要变成：

> “我懒得建模，所以所有东西塞一个 JSON。”

适合放 JSON：

~~~text
model_config
tool arguments
tool metadata
扩展属性
低频读取的配置
~~~

不适合全部塞 JSON：

~~~text
status
tenant_id
user_id
run_id
created_at
需要 JOIN / FILTER / ORDER BY 的核心字段
~~~

因为这些字段决定：

- 索引；
- 唯一约束；
- 查询；
- 锁；
- 运维分析。

核心关系应该显式建模。

---

# 27. 一个完整 Agent 执行链

~~~mermaid
sequenceDiagram
    participant U as User
    participant API as Agent API
    participant DB as MySQL
    participant Q as Task Queue
    participant W as Worker
    participant L as LLM
    participant T as Tool

    U->>API: Prompt
    API->>DB: INSERT turn + run
    API->>Q: enqueue run

    W->>DB: claim task / lease
    W->>L: model call
    L-->>W: tool_call

    W->>DB: INSERT tool_call(PENDING)
    W->>T: execute(idempotency_key)
    T-->>W: result
    W->>DB: tool_call=SUCCESS

    W->>DB: INSERT checkpoint
    W->>L: continue
    L-->>W: final answer

    W->>DB: run=SUCCESS
    W->>DB: INSERT usage_ledger
    API-->>U: result
~~~

这条链里 MySQL 的作用不是“给模型提供知识”。

它承担的是：

> **执行控制面的持久化。**

---

# 28. Agent 数据库最容易犯的 8 个错误

### ① Session 和 Run 混在一起

结果：retry / resume / attempt 很难表达。

### ② Agent 配置原地覆盖

结果：历史 Run 无法复现。

### ③ Tool Call 不存幂等键

结果：恢复后重复副作用。

### ④ 在事务里调用 LLM

结果：长事务 + 长时间持锁。

### ⑤ 所有上下文都塞 MySQL TEXT

结果：大行、IO、备份、复制压力。

### ⑥ 任务只存 RUNNING，没有 lease

结果：Worker 死后任务永久卡住。

### ⑦ Usage 只存总数

结果：无法审计、无法重算。

### ⑧ 以为 MySQL 能让外部系统一起 rollback

结果：数据库状态和真实世界副作用分裂。

---

# 29. Agent 场景会把哪些 MySQL 核心机制逼出来

~~~text
Quota
  → 行锁 / 条件 UPDATE / 事务

Task Queue
  → FOR UPDATE SKIP LOCKED

Retry
  → UNIQUE / 幂等键

Resume
  → checkpoint / durable state

Tool Side Effect
  → 幂等 + reconciliation

Usage Billing
  → append-only ledger

Agent Version
  → immutable versioned rows

大上下文
  → MySQL metadata + object storage

并发状态更新
  → optimistic locking / version

异步事件
  → transactional outbox
~~~

所以 Agent 并不是“数据库用得少”。

反而因为：

> **执行时间长、外部副作用多、容易失败、需要恢复**

它对状态建模的要求非常高。

---

# 30. 下一步：进入 InnoDB 内部

到这里你已经看到很多：

~~~text
UNIQUE
FOR UPDATE
SKIP LOCKED
COMMIT
联合索引
version
~~~

但还没有回答底层：

> 为什么它们有效？

下一章会从短视频与 Agent 的 SQL 反推：

- B+Tree；
- 聚簇索引；
- 二级索引；
- 回表；
- 联合索引；
- MVCC；
- Read View；
- undo；
- Record Lock；
- Gap Lock；
- Next-Key Lock；
- Deadlock；
- REPEATABLE READ / READ COMMITTED。

继续看：

> [03｜从场景反推 InnoDB：索引、MVCC、锁与事务](./03-innodb-from-scenes.md)
