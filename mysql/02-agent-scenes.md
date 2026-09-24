# 02｜Agent：从产品需求一步步设计数据库

> Agent 数据库真正难的不是“把聊天消息存下来”，而是：
>
> **如何把一个长时间、可失败、可重试、有外部副作用、可恢复的执行过程建模成稳定的持久化状态。**

---

# A. 先确定 Agent 平台的数据库边界

假设我们不是做一个本地 Demo，而是做企业级 Agent SaaS。

业务可能包含：

~~~text
用户创建 Agent
Agent 有多个版本
多人共享 Agent
创建 Session
用户发起 Turn
Turn 可以 Retry
Run 可以 Crash Resume
模型会多次调用 Tool
高风险 Tool 需要人工审批
Worker 可以水平扩容
Run 可以被取消
用户有并发配额
租户有月度 Token 配额
需要精确计费
管理员需要审计
历史大结果要归档
~~~

可以先划分：

~~~text
Agent Definition Domain
├─ agent_definition
├─ agent_version
└─ agent_permission

Conversation Domain
├─ session
├─ session_member
├─ turn
└─ message

Execution Domain
├─ run
├─ run_step
├─ tool_call
├─ tool_approval
├─ checkpoint
└─ task

Billing / Quota Domain
├─ agent_quota
├─ concurrency_quota
├─ quota_period
├─ usage_ledger
└─ usage_projection

Audit / Integration
├─ audit_event
└─ outbox_event
~~~

这些表不一定必须全部在一个物理 schema，但它们对应的是不同业务生命周期。

---

# B. 先画 ER，不先写 DDL

~~~mermaid
erDiagram
    TENANT ||--o{ AGENT_DEFINITION : owns
    AGENT_DEFINITION ||--o{ AGENT_VERSION : versions
    TENANT ||--o{ SESSION : owns
    SESSION ||--o{ TURN : contains
    TURN ||--o{ RUN : attempts
    RUN ||--o{ RUN_STEP : contains
    RUN_STEP ||--o| TOOL_CALL : may_trigger
    TOOL_CALL ||--o| TOOL_APPROVAL : may_require
    RUN ||--o{ CHECKPOINT : checkpoints
    RUN ||--o{ USAGE_LEDGER : consumes
~~~

这里最重要的三个拆分：

~~~text
Agent Definition ≠ Agent Version
Turn ≠ Run
Run Step ≠ Tool Call
~~~

这三个如果混在一起，后面 Retry、Resume、审计都会很痛苦。

---

# C. 先做 Invariant Matrix

| 业务规则 | 数据库表达 |
|---|---|
| 一个 Agent 的 version_no 唯一 | UNIQUE(agent_id, version_no) |
| 一个 Turn 的 attempt_no 唯一 | UNIQUE(turn_id, attempt_no) |
| 一个 Run 的 step_no 唯一 | UNIQUE(run_id, step_no) |
| 一个 Tool Call 的业务幂等键唯一 | UNIQUE(idempotency_key) |
| 同一高风险 Tool 的审批代次唯一 | UNIQUE(tool_call_id, approval_generation) |
| 每个用户 active Agent 不超过 quota | quota 行 + 条件 UPDATE / 锁 |
| 某 schedule 某个时间点只生成一次 occurrence | UNIQUE(schedule_id, scheduled_at) |
| 每条 usage 事实只记一次 | UNIQUE(provider_request_id) 或稳定 usage key |

如果这些规则没有数据库约束，重试和并发迟早会把数据打乱。

---

# D. Query Matrix

| Query | 条件 | 排序 | 调用方 |
|---|---|---|---|
| 用户 Agent 列表 | tenant,user,status | updated_at desc | Agent API |
| Session 列表 | tenant,user | updated_at desc | UI |
| Session 消息 | session_id | seq_no asc | Context Builder |
| Turn 的所有 Run | turn_id | attempt_no asc | UI / Retry |
| Run Timeline | run_id | step_no asc | Debug UI |
| 待执行任务 | status,available_at | priority desc | Worker |
| 待恢复任务 | status,lease_until | lease_until asc | Reaper |
| Tool 审批队列 | status,tenant | created_at asc | Approval UI |
| 月度用量 | tenant,period | - | Billing |
| Run 用量明细 | run_id | id asc | Audit |

索引应该围绕这些访问模式设计。

---

# E. Agent Definition 和 Version 为什么一定要拆

最差设计：

~~~text
agent
├─ id
├─ name
├─ system_prompt
├─ model
├─ tools_json
└─ updated_at
~~~

用户一编辑：

~~~text
system_prompt v7
↓
直接覆盖
↓
v8
~~~

正在执行的 Run 如果继续读取 agent 当前字段，就会出现前半段用 v7、后半段用 v8，历史结果也无法复现。

更合理：

~~~sql
CREATE TABLE agent_definition (
    id                 BIGINT UNSIGNED NOT NULL,
    tenant_id          BIGINT UNSIGNED NOT NULL,
    owner_user_id      BIGINT UNSIGNED NOT NULL,
    name               VARCHAR(128) NOT NULL,
    current_version_id BIGINT UNSIGNED NULL,
    lifecycle_status   TINYINT UNSIGNED NOT NULL,
    created_at         DATETIME(3) NOT NULL,
    updated_at         DATETIME(3) NOT NULL,

    PRIMARY KEY (id),
    KEY idx_owner_status_updated
        (tenant_id, owner_user_id, lifecycle_status, updated_at DESC, id DESC)
) ENGINE=InnoDB;

CREATE TABLE agent_version (
    id           BIGINT UNSIGNED NOT NULL,
    agent_id     BIGINT UNSIGNED NOT NULL,
    version_no   INT UNSIGNED NOT NULL,
    prompt_ref   VARCHAR(1024) NOT NULL,
    model_config JSON NOT NULL,
    tool_config  JSON NOT NULL,
    config_hash  BINARY(32) NOT NULL,
    created_at   DATETIME(3) NOT NULL,

    PRIMARY KEY (id),
    UNIQUE KEY uk_agent_version (agent_id, version_no)
) ENGINE=InnoDB;
~~~

Run 启动时绑定 agent_version_id，之后版本更新不影响已经运行的任务。

---

# F. Session / Turn / Run 为什么是三层

~~~text
Session
= 长期对话容器

Turn
= 用户的一次输入及这一轮意图

Run
= 对某个 Turn 的一次具体执行尝试
~~~

例子：

~~~text
Session S1
└─ Turn T18
   ├─ Run R1 失败
   ├─ Run R2 用户 Retry
   └─ Run R3 从 checkpoint 恢复
~~~

如果 Turn 和 Run 合并，Retry 到底是覆盖原记录还是创建新执行，会变得非常混乱。

---

# G. 一个更完整的 Agent 核心 Schema

~~~text
agent_definition
agent_version

session
session_member
turn
message

run
run_step
tool_call
tool_approval
checkpoint
task

quota_period
usage_ledger
usage_projection

audit_event
outbox_event
~~~

不是为了“表越多越专业”，而是因为这些对象的生命周期真的不同。

---

# H. Mutation Matrix

| 操作 | 本地事务 | 外部动作 | 关键风险 |
|---|---|---|---|
| 创建 Agent | quota + definition + version | 无 | 并发超额 |
| 发布 Agent 新版本 | version + current pointer | 无 | version 冲突 |
| 创建 Turn | turn + run + task | Queue 可异步 | 重试重复 |
| Worker 抢任务 | task lease | 无 | 双 Worker |
| 模型调用 | step start/end + usage | Provider | 超时不确定 |
| Tool Call | tool_call 状态 | 外部 Tool | 重复副作用 |
| 人工审批 | approval + tool 状态 | 无 | 重复批准 |
| Checkpoint | checkpoint pointer | Object Storage | blob/DB 不一致 |
| Run 完成 | run + outbox | 通知/计费异步 | 事件丢失 |

这张表比单独看 DDL 更能体现 Agent 数据库真正的复杂度。

---

# I. 接下来保留原章节的 Run、Tool、Resume、Quota 深挖

下面原有内容继续讲具体实现，但现在请始终追问：

~~~text
这张表代表什么生命周期？
对应哪个业务不变量？
对应哪个 Query？
为什么必须单独存在？
失败后用哪一份持久化状态恢复？
~~~

---


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


---

# 31. 新场景：多人共享 Session，为什么需要 session_member

企业 Agent 可能允许：

~~~text
用户 A 创建 Session
用户 B 被邀请加入
用户 C 只有只读权限
~~~

不要把 session.owner_user_id 硬扩展成 member_ids JSON。

更合理：

~~~sql
CREATE TABLE session_member (
    session_id BIGINT UNSIGNED NOT NULL,
    user_id    BIGINT UNSIGNED NOT NULL,
    role       TINYINT UNSIGNED NOT NULL,
    joined_at  DATETIME(3) NOT NULL,

    PRIMARY KEY (session_id, user_id),
    KEY idx_user_session (user_id, session_id)
) ENGINE=InnoDB;
~~~

它允许一个 Session 多成员、一个用户加入多个 Session、独立权限和双向查询。

---

# 32. 新场景：人工审批 Tool

高风险 Tool：

~~~text
delete_resource
transfer_money
publish_to_prod
send_external_email
~~~

可以有：

~~~sql
CREATE TABLE tool_approval (
    id                  BIGINT UNSIGNED NOT NULL,
    tool_call_id        BIGINT UNSIGNED NOT NULL,
    approval_generation INT UNSIGNED NOT NULL,
    status              TINYINT UNSIGNED NOT NULL,
    requested_by        BIGINT UNSIGNED NOT NULL,
    decided_by          BIGINT UNSIGNED NULL,
    reason              VARCHAR(1024) NULL,
    expires_at          DATETIME(3) NOT NULL,
    created_at          DATETIME(3) NOT NULL,
    decided_at          DATETIME(3) NULL,

    PRIMARY KEY (id),
    UNIQUE KEY uk_call_generation
        (tool_call_id, approval_generation),
    KEY idx_pending
        (status, expires_at, created_at, id)
) ENGINE=InnoDB;
~~~

为什么审批不能直接存在 tool_call.approved=true？

因为审批本身也有生命周期和审计要求：

~~~text
谁申请？
谁批准？
何时过期？
是否拒绝？
是否重新发起第二轮审批？
~~~

---

# 33. Tool Call 状态必须能表达 UNKNOWN

真实外部调用：

~~~text
Worker -> Cloud API: delete VM
Cloud API 执行成功
网络在返回途中断开
Worker 超时
~~~

本地数据库无法知道成功还是失败。

所以状态机至少要允许：

~~~text
PENDING
EXECUTING
SUCCEEDED
FAILED
UNKNOWN
~~~

如果把 UNKNOWN 当 FAILED 自动重试，就可能产生重复副作用。

恢复策略应该是：

~~~text
UNKNOWN
↓
使用 external_request_id / idempotency_key
↓
查询远端真实状态
↓
reconcile
~~~

---

# 34. 新场景：定时 Agent

用户设置每天 08:00 生成日报。

需要区分：

~~~text
schedule_definition
scheduled_occurrence
run
~~~

表：

~~~sql
CREATE TABLE scheduled_occurrence (
    id           BIGINT UNSIGNED NOT NULL,
    schedule_id  BIGINT UNSIGNED NOT NULL,
    scheduled_at DATETIME(3) NOT NULL,
    status       TINYINT UNSIGNED NOT NULL,
    run_id       BIGINT UNSIGNED NULL,
    created_at   DATETIME(3) NOT NULL,

    PRIMARY KEY (id),
    UNIQUE KEY uk_schedule_time (schedule_id, scheduled_at),
    KEY idx_due (status, scheduled_at, id)
) ENGINE=InnoDB;
~~~

为什么需要 occurrence？

因为 scheduler 可能重启、重复扫描、主从切换，但同一个 08:00 逻辑执行只应该生成一次。

---

# 35. 并发 Run 配额和 Agent 创建配额不是一回事

~~~text
Agent 创建配额
= 一个用户最多有多少个 Agent

Run 并发配额
= 此刻最多同时跑多少个 Run

Token 月度配额
= 一个结算周期最多消费多少 Token
~~~

三个约束生命周期不同，不能只做一个 quota 表。

可能分别建 agent_quota、concurrency_quota、quota_period。

---

# 36. 月度配额为什么要建 period

错误：

~~~text
tenant_usage.used_tokens
每月一号 used_tokens = 0
~~~

更合理：

~~~sql
CREATE TABLE quota_period (
    id           BIGINT UNSIGNED NOT NULL,
    tenant_id    BIGINT UNSIGNED NOT NULL,
    period_start DATE NOT NULL,
    period_end   DATE NOT NULL,
    token_quota  BIGINT UNSIGNED NOT NULL,
    created_at   DATETIME(3) NOT NULL,

    PRIMARY KEY (id),
    UNIQUE KEY uk_tenant_period (tenant_id, period_start)
) ENGINE=InnoDB;
~~~

这样历史月份不会被“清零”覆盖，账单、审计、跨月 Run 都有明确归属。

---

# 37. usage_ledger 还需要防重复记账

Provider 超时、消息重复投递或消费重试，都可能导致同一 usage 被再次写入。

因此 usage_ledger 常需要一个稳定去重键，例如：

~~~text
provider_request_id
或
(run_id, step_id, usage_generation)
~~~

数据库 UNIQUE 再次成为最后一道幂等防线。

---

# 38. Checkpoint blob 和数据库如何保持一致

Checkpoint 很大，通常：

~~~text
state blob -> Object Storage
metadata -> MySQL
~~~

但可能：

~~~text
对象存储上传成功
↓
DB INSERT checkpoint 失败
↓
留下 orphan blob
~~~

反过来，DB 指针已提交但 blob 不可读更加危险。

工程上需要设计临时 object key、hash、finalize 状态、orphan GC、完整性检查，并保证 DB 只指向 finalized blob。

“数据库只保存引用”也不是零成本设计。

---

# 39. 审计日志和运行日志不是一回事

Audit Event：

~~~text
谁修改了 Agent 权限
谁批准了 Tool
谁删除了 Session
管理员何时导出数据
~~~

这是合规事实。

Debug Log：

~~~text
worker retry #3
HTTP 502
tool stdout line 1831
~~~

这是可观测性数据。

前者可能需要不可轻易修改并长期保留，后者更适合日志系统。

---

# 40. Agent 数据库最终应该形成的地图

~~~mermaid
flowchart TB
    subgraph Def["Definition"]
      AD["agent_definition"]
      AV["agent_version"]
    end

    subgraph Conv["Conversation"]
      S["session"]
      SM["session_member"]
      T["turn"]
      M["message"]
    end

    subgraph Exec["Execution"]
      R["run"]
      RS["run_step"]
      TC["tool_call"]
      TA["tool_approval"]
      CP["checkpoint"]
      TASK["task"]
    end

    subgraph Bill["Billing"]
      QP["quota_period"]
      UL["usage_ledger"]
      UP["usage_projection"]
    end

    Def --> R
    Conv --> R
    R --> RS --> TC --> TA
    R --> CP
    R --> UL
    R --> TASK
    UL --> UP
~~~

真正掌握 Agent + MySQL，不是会背这些表名。

而是看到一个新需求，例如“支持多人协作 Agent + 高风险工具审批 + 定时运行 + 月度预算”，你能自己把它拆成不同生命周期，再推导出表、唯一约束、索引和事务边界。
