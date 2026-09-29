# 00｜真正的第一步：从业务需求设计数据库与表

> 这一章是整个 MySQL 专题新的核心。
>
> 不先问“该建几个索引”，而先问：
>
> **这个业务世界里有哪些事实？哪些对象有自己的生命周期？哪些关系必须永久记住？哪些状态必须原子变化？**

数据库设计不是从 CREATE TABLE 开始，而是从业务语义开始。

---

# 0. 一个完整的数据库设计过程

~~~mermaid
flowchart LR
    A["业务需求"] --> B["Use Case / Command"]
    B --> C["Query"]
    C --> D["业务不变量"]
    D --> E["实体与关系"]
    E --> F["数据库边界"]
    F --> G["表与字段"]
    G --> H["主键 / 唯一约束"]
    H --> I["查询驱动索引"]
    I --> J["事务边界"]
    J --> K["并发与失败"]
    K --> L["生命周期"]
    L --> M["容量与扩展"]
~~~

很多糟糕设计，是因为直接从“需求”跳到了 CREATE TABLE，中间十步都没做。

---

# 1. 第一步不是画表，而是列业务动作

假设设计短视频创作与发布系统。产品真正提出的是：

~~~text
创作者上传素材
创作者保存草稿
创作者修改标题和封面
创作者提交审核
机器审核
人工复审
审核通过
定时发布
创作者继续编辑下一版
运营下架
创作者删除草稿
用户查看公开视频
用户查看自己的创作列表
~~~

这些是 Use Cases / Commands。

它们决定哪些状态必须持久化。

---

# 2. 第二步：单独列 Query

至少有：

~~~text
Q1 按 video_id 查看视频详情
Q2 查看创作者最近 20 个作品
Q3 查看创作者所有审核中的作品
Q4 拉取待人工审核队列
Q5 查看某视频审核历史
Q6 Feed 拿到 20 个 video_id 后批量取元数据
Q7 查询某视频当前线上版本
Q8 查询上传任务是否完成
~~~

为什么 Query 必须在建索引之前列出来？

因为联合索引应该从 WHERE、ORDER BY、LIMIT、JOIN 反推，而不是凭经验堆出来。

---

# 3. 第三步：写业务不变量

不变量是并发、重试、宕机后也必须成立的规则。

~~~text
I1 一个 video 只能属于一个 creator
I2 一个 video 内 version_no 必须唯一
I3 同一个审核任务不能成功完成两次
I4 只有审核通过的 revision 才能发布
I5 一个 video 任意时刻只有一个 published revision
I6 同一个 upload request 重试不能生成多个逻辑资产
I7 删除 video 不能抹掉必须保留的审核和计费审计
~~~

这些不变量会自然推出：

~~~text
UNIQUE
NOT NULL
CHECK
条件 UPDATE
事务
锁
状态机
幂等键
~~~

数据库设计的核心，就是把重要业务规则变成系统可以强制执行的约束。

---

# 4. 第四步：识别实体、关系、事实、状态

## 实体 Entity

有独立身份和生命周期：

~~~text
Video
VideoAsset
VideoRevision
ModerationTask
PublishJob
~~~

## 关系 Relationship

~~~text
User likes Video
User follows User
Agent uses Tool
~~~

## 事实 Fact

~~~text
一次点赞
一次模型调用
一次审核结论
一次用量计费
~~~

## 当前状态 State

~~~text
video.lifecycle_status
run.status
quota.used
current_revision_id
~~~

复杂系统通常同时存在事实表、当前状态表和异步投影，而不是所有信息塞进一张万能表。

---

# 5. 先画领域关系，不急着写字段

~~~mermaid
erDiagram
    CREATOR ||--o{ VIDEO : owns
    VIDEO ||--o{ VIDEO_REVISION : has
    VIDEO ||--o{ VIDEO_ASSET : has
    VIDEO_REVISION ||--o{ MODERATION_TASK : checked_by
    VIDEO_REVISION ||--o| PUBLISH_JOB : published_by
~~~

先确认关系是否正确，再讨论字段长度。

---

# 6. 为什么不能只有一张 video 表

初学者容易设计：

~~~sql
CREATE TABLE video (
    id BIGINT,
    creator_id BIGINT,
    title VARCHAR(256),
    description TEXT,
    cover_url VARCHAR(1024),
    source_url VARCHAR(1024),
    review_status TINYINT,
    review_reason VARCHAR(1024),
    publish_status TINYINT,
    publish_at DATETIME,
    deleted TINYINT
);
~~~

需求复杂以后马上出现：

~~~text
审核针对的是哪一版？
修改标题会不会覆盖已审核内容？
线上展示的是 v3 还是正在编辑的 v4？
一个视频多个清晰度文件放哪？
审核记录为什么只剩最后一次？
定时发布失败记录放哪？
~~~

根因不是字段太多，而是多个不同生命周期的对象被压进一行。

---

# 7. 拆表的核心：生命周期

~~~text
video
= 视频长期身份

video_revision
= 某次不可变内容快照

video_asset
= 原视频、封面、转码文件等资产

moderation_task
= 某一次审核尝试

publish_job
= 某一次发布任务
~~~

它们值得分开，因为创建、修改、失败、重试、删除的生命周期不同。

---

# 8. 主表 video：保存身份与指针

~~~sql
CREATE TABLE video (
    id                    BIGINT UNSIGNED NOT NULL,
    creator_id            BIGINT UNSIGNED NOT NULL,
    current_revision_id   BIGINT UNSIGNED NULL,
    published_revision_id BIGINT UNSIGNED NULL,
    lifecycle_status      TINYINT UNSIGNED NOT NULL,
    created_at            DATETIME(3) NOT NULL,
    updated_at            DATETIME(3) NOT NULL,

    PRIMARY KEY (id),
    KEY idx_creator_status_created
        (creator_id, lifecycle_status, created_at DESC, id DESC)
) ENGINE=InnoDB;
~~~

这里故意不把 title、description、review_reason 全放进去，因为它们属于具体 revision 或审核事实。

---

# 9. video_revision：保存内容快照

~~~sql
CREATE TABLE video_revision (
    id             BIGINT UNSIGNED NOT NULL,
    video_id       BIGINT UNSIGNED NOT NULL,
    version_no     INT UNSIGNED NOT NULL,
    title          VARCHAR(256) NOT NULL,
    description    VARCHAR(2000) NOT NULL,
    cover_asset_id BIGINT UNSIGNED NULL,
    review_status  TINYINT UNSIGNED NOT NULL,
    content_hash   BINARY(32) NOT NULL,
    created_by     BIGINT UNSIGNED NOT NULL,
    created_at     DATETIME(3) NOT NULL,

    PRIMARY KEY (id),
    UNIQUE KEY uk_video_version (video_id, version_no),
    KEY idx_video_created (video_id, created_at DESC, id DESC),
    KEY idx_review_queue (review_status, created_at, id)
) ENGINE=InnoDB;
~~~

现在一个视频可以同时有：

~~~text
published_revision_id = v3
current_revision_id   = v4
~~~

v4 审核失败也不会污染线上 v3。

---

# 10. 为什么 version_no 必须 UNIQUE

业务不变量：同一个 video 不能出现两个 v4。

所以：

~~~sql
UNIQUE KEY uk_video_version (video_id, version_no)
~~~

它首先是业务约束，其次才是索引。

好的设计尽量把关键不变量下沉为 PRIMARY KEY、UNIQUE、NOT NULL、CHECK、条件更新或事务，而不是只写在 Controller 的 if 里。

---

# 11. 主键和业务键往往同时存在

video_revision 同时有：

~~~text
id
(video_id, version_no)
~~~

id 是 surrogate key：短、稳定、适合被引用。

video_id + version_no 是 business key：表达业务唯一性。

有 surrogate primary key，不等于可以省掉业务 UNIQUE。

---

# 12. 一对多还是多对多，会直接改变表结构

Video 与 Tag 是多对多：

~~~sql
CREATE TABLE tag (
    id BIGINT UNSIGNED NOT NULL,
    name VARCHAR(64) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uk_name (name)
);

CREATE TABLE video_tag (
    video_id BIGINT UNSIGNED NOT NULL,
    tag_id BIGINT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL,
    PRIMARY KEY (video_id, tag_id),
    KEY idx_tag_video (tag_id, video_id)
);
~~~

是否需要 idx_tag_video，要看是否真的有“某 tag 下查视频”的 Query。

---

# 13. 字段设计：每个字段都要回答问题

~~~text
语义是什么？
是否允许 NULL？
默认值有没有真实业务含义？
是否参与 WHERE？
是否参与 ORDER BY？
是否会变化？
值域多大？
是否需要审计？
~~~

例如 published_at = NULL 可以明确表达“尚未发布”。

用 1970-01-01 代表未发布，实际上是在发明一个假时间。

---

# 14. NULL、空字符串、0 不是同一语义

例如审核原因：

~~~text
NULL = 还没有审核结果
""   = 已审核，但没有补充说明
"涉政" = 明确审核原因
~~~

如果业务区分它们，表结构就应该保留这种区别。

---

# 15. 时间字段也是领域模型

~~~text
created_at  = 事实第一次创建
updated_at  = 当前状态最后变化
published_at = 发布业务事件时间
deleted_at  = 进入逻辑删除状态
lease_until = Worker 执行权过期时间
expires_at  = 业务有效期
~~~

不要机械地每张表都复制 created_at / updated_at，而不理解语义。

---

# 16. 不要设计“万能 status”

最差设计之一：

~~~text
video.status
0 草稿
1 上传中
2 转码中
3 审核中
4 审核拒绝
5 待发布
6 已发布
7 下架
8 删除
9 转码失败
10 发布失败
~~~

这里把视频生命周期、上传、转码、审核、发布任务混在一个状态机里。

更合理：

~~~text
video.lifecycle_status
video_revision.review_status
video_asset.transcode_status
publish_job.status
~~~

不同生命周期应该拆开建模。

---

# 17. 状态机先画，再定义 status

~~~mermaid
stateDiagram-v2
    [*] --> DRAFT
    DRAFT --> REVIEWING
    REVIEWING --> PASSED
    REVIEWING --> REJECTED
    REJECTED --> DRAFT
    PASSED --> PUBLISHED
    PUBLISHED --> OFFLINE
~~~

数据库更新要表达旧状态：

~~~sql
UPDATE video_revision
SET review_status = ?
WHERE id = ?
  AND review_status = ?;
~~~

affected_rows = 0 就意味着并发或状态已经变化，而不是静默覆盖。

---

# 18. Query Matrix：索引设计真正的输入

| Query | WHERE | ORDER BY | 频率 | 返回量 |
|---|---|---|---:|---:|
| 视频详情 | id=? | - | 很高 | 1 |
| 作者作品 | creator_id=? | created_at desc | 高 | 20 |
| 审核队列 | review_status=? | created_at asc | 高 | 50 |
| 版本历史 | video_id=? | version_no desc | 中 | 20 |
| Feed 批量卡片 | id IN(...) | - | 很高 | 20 |

如果你无法列出 Query Matrix，就还没准备好设计二级索引。

---

# 19. 从 Query 反推联合索引

需求：创作者查看自己的审核中作品，按创建时间倒序分页。

~~~sql
SELECT id, current_revision_id, created_at
FROM video
WHERE creator_id = ?
  AND lifecycle_status = ?
ORDER BY created_at DESC, id DESC
LIMIT 20;
~~~

推导：

~~~text
creator_id 等值过滤
↓
lifecycle_status 等值过滤
↓
created_at + id 排序与游标
~~~

得到：

~~~sql
KEY idx_creator_status_created
    (creator_id, lifecycle_status, created_at DESC, id DESC)
~~~

---

# 20. Invariant Matrix：设计评审最重要的一张表

| 不变量 | 数据库表达 |
|---|---|
| 同 video 版本号唯一 | UNIQUE(video_id, version_no) |
| 一个上传请求只生成一个逻辑任务 | UNIQUE(creator_id, idempotency_key) |
| revision 状态只能合法迁移 | 条件 UPDATE |
| 发布只允许通过审核的 revision | 事务 + 状态校验 |
| 一个定时任务一期只产生一次 occurrence | UNIQUE(schedule_id, scheduled_at) |

如果关键业务规则只存在于应用层某个 if，需要警惕。

---

# 21. Mutation Matrix：它决定事务边界

| 写操作 | 涉及表 | 不变量 | 并发风险 |
|---|---|---|---|
| 创建草稿 | video + revision | 初始版本唯一 | 请求重试 |
| 新建版本 | revision + video | version_no 唯一 | 并发创建 v4 |
| 提交审核 | revision + moderation_task | 不能重复提交 | 双击/重试 |
| 发布 | video + publish_job | 只能发布 passed revision | 多 Worker |
| 下架 | video + audit | 状态迁移合法 | 多运营并发 |

事务应该围绕“必须一起成功/失败的不变量”设计，而不是围绕一个 HTTP 请求的全部代码设计。

---

# 22. Failure Matrix：生产设计必须假设任意一步失败

以发布为例：

| 失败位置 | DB 状态 | 外部状态 | 恢复策略 |
|---|---|---|---|
| 创建 job 前 | 无 job | 未调用 | 重试 |
| job 已提交，MQ 未发 | 有 job | 无消息 | Outbox / CDC |
| CDN 成功，DB 未更新 | pending | 外部 success | 幂等查询 / 对账 |
| DB success，HTTP 返回前断网 | success | success | 请求幂等 |

真正的数据库设计不能只画正常路径。

---

# 23. 创建新 revision：不变量如何决定并发方案

如果代码是：

~~~text
SELECT MAX(version_no) = 3
↓
INSERT v4
~~~

两个请求可能同时读到 3。

所以必须先定义：

> 同 video 的 version_no 唯一。

然后选择一种实现：

- UNIQUE(video_id, version_no) 最终兜底；
- 锁住 video 主行后分配版本号；
- video 表维护 next_version 原子递增。

重点不是背哪一种，而是先有不变量。

---

# 24. 数据库事务和业务工作流不是一回事

适合一个本地事务：

~~~text
INSERT video_revision
+
UPDATE video.current_revision_id
~~~

不适合放进同一事务：

~~~text
上传 500MB 视频
调用转码服务
等待审核模型 30 秒
发 CDN 发布请求
~~~

后者应该是可恢复工作流，而不是长事务。

---

# 25. 外键到底该不该用

不要背“必须用”或“大厂不用”两种口号。

InnoDB 支持 FOREIGN KEY，用于维护相关表之间的引用完整性。

是否使用要看：

~~~text
是否属于同一个数据库所有权边界？
是否需要跨服务独立演进？
是否大量批量导入 / 迁移？
删除语义是否复杂？
团队是否能可靠做应用层完整性治理？
~~~

video_revision -> video 如果属于同一个 Content DB，FK 是合理选项之一。

跨微服务独立数据库的 user_id 引用，则不应该假装存在一个本地 FK。

---

# 26. 数据库边界先按业务所有权，不按页面

错误：

~~~text
首页库
详情页库
个人中心库
~~~

更合理的思路可能是：

~~~text
Content DB
├─ video
├─ video_revision
├─ video_asset
├─ moderation_task
└─ publish_job

Interaction DB
├─ video_like
├─ video_favorite
└─ comment

Social DB
└─ user_follow

Agent Control DB
├─ agent_definition
├─ agent_version
├─ run
├─ step
├─ tool_call
└─ checkpoint
~~~

拆库首先是所有权与事务边界问题，其次才是容量问题。

---

# 27. 一个微服务也完全可以拥有多张表

Agent Runtime Service 维护：

~~~text
agent_run
agent_run_step
agent_tool_call
agent_checkpoint
agent_task
~~~

这些表共同表达一次可恢复执行。

机械地“一张表一个服务”，会把原本简单的本地事务变成分布式事务。

---

# 28. 规范化解决什么

如果每个 video 都重复 creator_name：

~~~text
用户改名
↓
成千上万条 video 都需要更新
~~~

规范化让核心事实只存一份。

---

# 29. 为什么真实系统又会反规范化

Feed 读取要求低延迟：

~~~text
20 video
+ 20 author
+ stat
+ relation
~~~

读模型可以做可重建冗余：

~~~text
video_card_projection
Redis
Search Index
KV View
~~~

原则：核心事实尽量规范化，读性能按访问模式做可重建冗余。

任何冗余都必须回答“谁更新、失败怎么补、允许延迟多久”。

---

# 30. 软删除不是 deleted=1 就结束

继续问：

~~~text
唯一约束怎么处理？
查询是否总能过滤？
CDC 是否发删除事件？
对象存储何时物理删？
审核记录是否保留？
点赞关系是否级联？
backup 多久后真正消失？
~~~

删除通常分：业务不可见、在线库归档、最终物理删除三层。

---

# 31. JSON 什么时候该用

适合：

~~~text
provider-specific model_config
tool arguments
低频扩展 metadata
快速变化但很少单独查询的配置
~~~

不适合把核心字段都藏起来。

如果一个字段频繁参与 WHERE、JOIN、ORDER BY、UNIQUE、权限判断、状态机或分片路由，它通常应该是正式列。

MySQL 8.4 的 JSON 列不能直接像普通标量列那样建立普通索引；常见做法是通过生成列等方式建立可索引访问路径。

---

# 32. 数据类型不是越大越保险

例如：

~~~text
status -> TINYINT / 明确枚举语义
count  -> UNSIGNED integer
money  -> DECIMAL 或整数最小单位
hash   -> BINARY
large blob -> object storage reference
~~~

Agent 计费可以使用 cost_micros BIGINT 保存微单位，避免浮点累积误差并方便审计。

---

# 33. AUTO_INCREMENT、64-bit 分布式 ID、UUID 怎么选

不要问“谁最好”，而问：

~~~text
谁生成？
是否跨库？
是否需要离线生成？
主键多宽？
是否时间趋势递增？
是否暴露给外部？
是否需要未来合并数据？
~~~

InnoDB 的主键会成为聚簇索引，二级索引还会携带主键，因此主键宽度和写入局部性都值得认真考虑。

---

# 34. 表设计必须做容量估算

至少估：

~~~text
行数
每天新增
平均行大小
索引数量
保留时间
冷热比例
读 QPS
写 QPS
热点 key
增长速度
~~~

例如 video_like 每天 2 亿关系变化与每天 1000 条，是两个完全不同的系统。

---

# 35. 第四张核心表：Capacity Matrix

| 表 | 日增 | 保留 | 热读 | 热写 | 最危险问题 |
|---|---:|---:|---:|---:|---|
| video | 100 万 | 长期 | 高 | 中 | 元数据批量读 |
| video_like | 2 亿 | 长期 | 极高 | 极高 | 热点与分片 |
| comment | 5000 万 | 长期 | 高 | 高 | 深分页 |
| usage_ledger | 10 亿级事件 | 合规期 | 中 | 极高 | 写放大/归档 |
| run_step | 随 Agent 运行增长 | 180 天 | 中 | 高 | 大量历史 |

容量不是上线后再想的问题。

---

# 36. 完整数据库设计产物不应该只有 DDL

至少包含：

~~~text
1. Scope / 数据库边界
2. Use Cases
3. Query Matrix
4. Invariant Matrix
5. ER Diagram
6. State Machines
7. Table DDL
8. Index Rationale
9. Transaction Boundaries
10. Concurrency Strategy
11. Failure / Retry Strategy
12. Data Lifecycle
13. Capacity Estimate
14. Scaling Plan
15. Migration Plan
~~~

只给 CREATE TABLE，通常只完成了数据库设计的一小部分。

---

# 37. 后面两条主线都按同一方法学习

~~~text
业务需求
↓
数据库边界
↓
实体与关系
↓
不变量
↓
Query Matrix
↓
表设计 v1
↓
找问题
↓
表设计 v2
↓
索引
↓
事务
↓
并发
↓
失败
↓
规模化
~~~

下一章：

> [01｜短视频：从产品需求一步步设计数据库](./01-short-video-scenes.md)
