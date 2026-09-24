# 06｜复杂设计案例库：把“会 MySQL”变成“会设计系统”

> 每个案例都故意加入冲突需求、并发、失败、历史数据和规模约束。
>
> 目标不是背答案，而是练习：**需求 → 表 → 索引 → 事务 → 一致性 → 扩展。**

---

# Case 1｜评论系统：两级回复、审核、置顶、热评

需求：一级评论、回复、独立审核、删除、作者置顶、百万回复、时间分页和热评排序同时存在。

错误设计：把所有回复塞进 comment.reply_json。

它会导致无法独立分页、无法独立审核、单行不断变大、并发更新同一行。

更合理：

~~~text
comment
├─ id
├─ video_id
├─ user_id
├─ root_id
├─ parent_id
├─ depth
├─ content
├─ status
└─ created_at

comment_stat
├─ comment_id
├─ like_count
└─ reply_count

comment_moderation
├─ id
├─ comment_id
├─ result
├─ reason
└─ created_at
~~~

两级回复时 root_id 指向一级评论，parent_id 指向实际回复对象。

一级评论索引：

~~~sql
KEY idx_video_status_created
(video_id, status, created_at DESC, id DESC)
~~~

回复索引：

~~~sql
KEY idx_root_status_created
(root_id, status, created_at ASC, id ASC)
~~~

热评排序通常不应该依赖每次请求实时扫描并 ORDER BY 高频变化的 like_count，而应该考虑异步 materialized ranking。

---

# Case 2｜关注系统：关系有两个查询方向

需求：

~~~text
A 关注了谁
谁关注了 B
A 是否关注 B
互相关注
粉丝数
明星 1 亿粉丝
~~~

关系表：

~~~sql
CREATE TABLE user_follow (
    id BIGINT UNSIGNED NOT NULL,
    follower_id BIGINT UNSIGNED NOT NULL,
    followee_id BIGINT UNSIGNED NOT NULL,
    active TINYINT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,

    PRIMARY KEY (id),
    UNIQUE KEY uk_relation (follower_id, followee_id),
    KEY idx_follower_active_created
        (follower_id, active, created_at DESC, followee_id),
    KEY idx_followee_active_created
        (followee_id, active, created_at DESC, follower_id)
);
~~~

这里两棵二级索引来自 outgoing edges 与 incoming edges 两类真实 Query。

如果未来按 follower_id 分片，“我关注谁”是本地查询，但“谁关注某明星”就会跨 shard。于是另一方向可能需要异步 projection。

---

# Case 3｜视频编辑与发布：线上 v3 + 草稿 v4

需求：

~~~text
v3 已发布
v4 正在编辑
v4 审核拒绝
用户仍然必须看到 v3
~~~

所以不能原地 UPDATE 唯一一行 video 内容。

应该分：

~~~text
video.published_revision_id = v3
video.current_revision_id   = v4
~~~

这个 identity + immutable revision 模式也适用于 Agent Prompt Version、Workflow Version、配置中心和 CMS。

---

# Case 4｜视频上传：幂等、分片上传、转码

客户端创建 upload 后网络超时并重试三次，不能生成三份逻辑上传。

~~~sql
CREATE TABLE upload_session (
    id BIGINT UNSIGNED NOT NULL,
    creator_id BIGINT UNSIGNED NOT NULL,
    idempotency_key VARCHAR(128) NOT NULL,
    object_key VARCHAR(1024) NULL,
    status TINYINT UNSIGNED NOT NULL,
    expires_at DATETIME(3) NOT NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,

    PRIMARY KEY (id),
    UNIQUE KEY uk_creator_request (creator_id, idempotency_key),
    KEY idx_expire (status, expires_at, id)
);
~~~

分片明细：

~~~text
upload_part(upload_id, part_no, etag, size)
UNIQUE(upload_id, part_no)
~~~

同一个 part 重传也只能对应一个逻辑 part。

---

# Case 5｜Agent 人工审批 Tool：为什么需要 UNKNOWN

Agent 想执行高风险 Tool。

状态可能是：

~~~text
PENDING_APPROVAL
APPROVED
REJECTED
EXECUTING
SUCCEEDED
FAILED
UNKNOWN
EXPIRED
~~~

UNKNOWN 的意义：外部请求已经发出，但网络中断，无法确认远端是否执行成功。

如果把 UNKNOWN 错误归类成 FAILED 并自动重试，就可能重复扣款、重复删除资源、重复发邮件。

数据库建模必须能表达现实世界的不确定状态。

---

# Case 6｜Agent 定时任务：Schedule 不等于 Run

用户配置每天 08:00 生成日报。

至少区分：

~~~text
schedule_definition
scheduled_occurrence
run
~~~

为什么？

因为 2026-09-24 08:00 这一期任务本身需要唯一身份。

~~~text
UNIQUE(schedule_id, scheduled_at)
~~~

这样 scheduler 重启、重复扫描、主从切换，也不会为同一期创建多个逻辑 occurrence。

Worker 再通过 lease 与 FOR UPDATE SKIP LOCKED 抢具体任务。

---

# Case 7｜Agent 月度配额：不要每月 UPDATE used=0

需求：每 tenant 每月一亿 token。

最差设计：tenant_quota.used 每月一号清零。

问题：历史账单消失、跨月 Run 难归属、重置任务失败会污染新月份。

更合理：

~~~text
quota_period
(tenant_id, period_start, period_end, quota)

usage_ledger
(tenant_id, run_id, occurred_at, tokens)

usage_projection
(tenant_id, period_start, used)
~~~

月份应该成为数据，而不是依赖一个“神奇清零任务”。

---

# Case 8｜多租户 Agent：tenant_id 不只是权限字段

核心表可能包含 tenant_id：

~~~text
agent_definition
session
run
usage_ledger
quota
~~~

因为它可能参与：

- 权限过滤；
- 数据隔离；
- 联合索引前缀；
- shard routing；
- billing；
- tenant 迁移。

但是否每张叶子表都冗余 tenant_id，必须根据查询和隔离边界决定，不能机械复制。

---

# Case 9｜哪些事件根本不该进 MySQL

Agent 一次运行可能产生：

~~~text
model token delta
tool stdout
debug logs
heartbeats
progress events
business state changes
~~~

如果全部逐条写 MySQL，主库、binlog、replica 都会被高频低价值事件拖累。

更合理分类：

~~~text
业务状态事实 -> MySQL
大结果 -> Object Storage
调试日志 -> Log System
实时 delta -> Stream / Broker
分析指标 -> OLAP / Metrics
~~~

数据库设计也包括决定“什么不进数据库”。

---

# Case 10｜综合题：企业 Agent 平台

需求：

~~~text
企业用户创建 Agent
每人最多 9 个 Agent
Agent 有版本
支持多人共享 Session
每个 Turn 可 Retry
Run 支持 Crash Resume
Tool 删除资源前要人工审批
每月按 Token 计费
管理员审计 180 天历史
~~~

至少可能推导出：

~~~text
tenant
user / membership

agent_definition
agent_version
agent_quota

session
session_member
turn
message

run
run_step
checkpoint

tool_call
tool_approval

usage_ledger
usage_projection

audit_event
outbox_event
~~~

然后逐张表回答：

~~~text
谁拥有它？
主键是什么？
业务唯一键是什么？
生命周期是什么？
最常见 Query 是什么？
索引怎么来的？
事务和谁一起？
失败后怎么恢复？
多久归档？
未来按什么 shard？
~~~

这些问题能答完整，才算真正完成数据库设计。
