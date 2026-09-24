# 01｜短视频：从产品需求一步步设计数据库

> 这一章现在不再从“点赞表怎么建”开始，而是先完整设计一个短视频业务数据库，再进入点赞、评论、发布、热点等具体问题。
>
> 贯穿原则：**先定义业务世界，再定义表。**

---

# A. 先确定数据库边界

一个成熟短视频 App 不会只有一个巨大 mysql 数据库把所有业务揉在一起。

可以先按所有权划分：

~~~text
Content DB
├─ video
├─ video_revision
├─ video_asset
├─ moderation_task
├─ publish_job
└─ video_tag

Interaction DB
├─ video_like
├─ video_favorite
├─ comment
├─ comment_moderation
└─ interaction_outbox

Social DB
└─ user_follow

User DB
└─ user_profile

推荐 / 搜索 / 统计
通常还有独立的数据系统
~~~

为什么这样划？

因为视频内容生命周期、点赞评论关系生命周期、关注关系生命周期不同，它们的写入者、事务边界、容量、查询方向也不同。

这里后续为了教学会把 DDL 放在一起展示，但要记住真实服务化系统首先考虑“谁拥有这份数据”。

---

# B. 先列完整业务链，不先建表

~~~text
创作者上传视频
↓
对象存储上传完成
↓
转码出 360p / 720p / 1080p
↓
保存草稿
↓
编辑标题、封面、tag
↓
提交机器审核
↓
可能进入人工审核
↓
审核通过
↓
立即/定时发布
↓
进入推荐系统
↓
用户刷到视频
↓
播放
↓
点赞 / 取消赞
↓
收藏 / 取消收藏
↓
评论 / 回复
↓
关注作者
↓
举报
↓
运营下架
↓
作者编辑新版本再发布
~~~

这已经说明：一个 video 表绝对不可能优雅地承担所有职责。

---

# C. 领域模型先画出来

~~~mermaid
erDiagram
    USER ||--o{ VIDEO : creates
    VIDEO ||--o{ VIDEO_REVISION : has
    VIDEO ||--o{ VIDEO_ASSET : has
    VIDEO_REVISION ||--o{ MODERATION_TASK : checked_by
    VIDEO_REVISION ||--o{ VIDEO_TAG : tagged
    VIDEO ||--o{ VIDEO_LIKE : receives
    VIDEO ||--o{ VIDEO_FAVORITE : receives
    VIDEO ||--o{ COMMENT : has
    COMMENT ||--o{ COMMENT : replies
    USER ||--o{ USER_FOLLOW : follows
~~~

最关键的不是 ER 图漂亮，而是开始区分身份、版本、资产、审核事实、发布任务、用户关系和评论树。

---

# D. 短视频核心表不是一张，而是一组协作表

## 1. video：长期身份

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

## 2. video_revision：内容版本

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
    KEY idx_video_version (video_id, version_no DESC),
    KEY idx_review_queue (review_status, created_at, id)
) ENGINE=InnoDB;
~~~

## 3. video_asset：资产与转码结果

~~~sql
CREATE TABLE video_asset (
    id               BIGINT UNSIGNED NOT NULL,
    video_id         BIGINT UNSIGNED NOT NULL,
    revision_id      BIGINT UNSIGNED NULL,
    asset_type       TINYINT UNSIGNED NOT NULL,
    storage_key      VARCHAR(1024) NOT NULL,
    width            INT UNSIGNED NULL,
    height           INT UNSIGNED NULL,
    bitrate          INT UNSIGNED NULL,
    duration_ms      INT UNSIGNED NULL,
    transcode_status TINYINT UNSIGNED NOT NULL,
    created_at       DATETIME(3) NOT NULL,
    updated_at       DATETIME(3) NOT NULL,

    PRIMARY KEY (id),
    KEY idx_video_type (video_id, asset_type, id),
    KEY idx_transcode_queue (transcode_status, created_at, id)
) ENGINE=InnoDB;
~~~

大视频对象更适合对象存储；MySQL 保存业务身份、状态、元数据和 object key。

## 4. moderation_task：审核不是 video 上一个字段

~~~sql
CREATE TABLE moderation_task (
    id            BIGINT UNSIGNED NOT NULL,
    revision_id   BIGINT UNSIGNED NOT NULL,
    stage         TINYINT UNSIGNED NOT NULL,
    reviewer_type TINYINT UNSIGNED NOT NULL,
    status        TINYINT UNSIGNED NOT NULL,
    result        TINYINT UNSIGNED NULL,
    reason_code   VARCHAR(64) NULL,
    detail_ref    VARCHAR(1024) NULL,
    attempt_no    INT UNSIGNED NOT NULL,
    created_at    DATETIME(3) NOT NULL,
    finished_at   DATETIME(3) NULL,

    PRIMARY KEY (id),
    UNIQUE KEY uk_revision_stage_attempt
        (revision_id, stage, attempt_no),
    KEY idx_queue
        (status, stage, created_at, id),
    KEY idx_revision
        (revision_id, created_at, id)
) ENGINE=InnoDB;
~~~

一个 revision 可能经历机器审核超时重试、人工复审、申诉复审。如果只在 video 上保存 review_status/reason，历史会全部丢失。

## 5. publish_job：发布是一个可失败任务

~~~sql
CREATE TABLE publish_job (
    id              BIGINT UNSIGNED NOT NULL,
    video_id        BIGINT UNSIGNED NOT NULL,
    revision_id     BIGINT UNSIGNED NOT NULL,
    idempotency_key VARCHAR(128) NOT NULL,
    publish_at      DATETIME(3) NOT NULL,
    status          TINYINT UNSIGNED NOT NULL,
    attempt_no      INT UNSIGNED NOT NULL,
    lease_until     DATETIME(3) NULL,
    last_error      VARCHAR(1024) NULL,
    created_at      DATETIME(3) NOT NULL,
    updated_at      DATETIME(3) NOT NULL,

    PRIMARY KEY (id),
    UNIQUE KEY uk_idempotency (idempotency_key),
    KEY idx_dispatch (status, publish_at, lease_until, id)
) ENGINE=InnoDB;
~~~

发布失败、重试、定时调度都不应该污染 video 的基础身份。

---

# E. 先做 Query Matrix，再谈索引

| Query | 典型调用方 | 条件 | 排序 | 频率 |
|---|---|---|---|---:|
| 查视频身份 | Content Service | id | - | 极高 |
| 批量取 20 个视频 | Feed Aggregator | id IN | - | 极高 |
| 作者作品列表 | Creator Center | creator_id,status | created_at desc | 高 |
| 某视频版本历史 | Creator Center | video_id | version_no desc | 中 |
| 审核队列 | Moderation Worker | status,stage | created_at asc | 高 |
| 转码队列 | Transcode Worker | status | created_at asc | 高 |
| 待发布任务 | Publisher | status,publish_at | publish_at asc | 高 |
| 用户最近点赞 | Profile | user_id,active | created_at desc | 高 |
| 评论第一页 | Comment Service | video_id,status | created_at desc | 极高 |

以后你看到任何一个索引，都应该能回指这张表里的一个 Query。

---

# F. 再做 Invariant Matrix

| 规则 | 数据库表达 |
|---|---|
| 同一 video 的 version_no 唯一 | UNIQUE(video_id, version_no) |
| 同一用户只能有一份 user-video 点赞关系 | UNIQUE(user_id, video_id) |
| 同一 publish 请求重试不能生成多次逻辑发布 | UNIQUE(idempotency_key) |
| 同一审核 stage 的 attempt 编号唯一 | UNIQUE(revision_id, stage, attempt_no) |
| 发布只能从合法状态迁移 | 条件 UPDATE + 事务 |
| 同一 upload part 不重复 | UNIQUE(upload_id, part_no) |

这张表决定数据库到底替你兜住哪些错误。

---

# G. 再做 Mutation Matrix

| 操作 | 主要表 | 是否单事务 | 远程副作用 |
|---|---|---|---|
| 创建草稿 | video + revision | 是 | 无 |
| 提交审核 | revision + moderation_task + outbox | 是 | 审核服务异步 |
| 审核完成 | moderation_task + revision | 是 | 无 |
| 发布视频 | publish_job + video + outbox | 分阶段短事务 | CDN / 推荐 |
| 点赞 | video_like + outbox | 是 | Redis / MQ 异步 |
| 评论 | comment + outbox | 是 | 审核异步 |
| 关注 | user_follow + outbox | 是 | 计数异步 |

注意：一次产品操作不代表一个超长数据库事务。涉及远程系统时要拆成可恢复状态机。

---

# H. 接下来才进入点赞、评论、热点等具体场景

下面保留原来的场景讲解，但现在请带着 Query Matrix、Invariant Matrix 和 Mutation Matrix 去看。

索引、UNIQUE、FOR UPDATE、Outbox 都应该由设计一步步推出来，而不是突然出现的技术名词。

---


> 这一章不从“建一张 video 表”开始。
>
> 我们从用户真的打开一个短视频 App 开始，沿着请求链判断：**MySQL 在哪里出现、为什么出现、应该保存什么。**

---

# 0. 场景总图：一次“刷视频”并不是一次数据库查询

假设用户打开首页，推荐系统已经返回 20 个视频：

~~~text
[9001, 7821, 8112, ...]
~~~

真实链路通常更接近：

~~~mermaid
flowchart LR
    APP["App / Web"] --> GW["API Gateway"]
    GW --> FEED["Feed 聚合服务"]
    FEED --> REC["推荐服务"]
    REC -->|video_id list| FEED
    FEED --> VIDEO["Video Service"]
    FEED --> USER["User Service"]
    FEED --> STAT["Stat / Like Service"]
    VIDEO --> MYSQL[("MySQL")]
    STAT --> REDIS[("Redis")]
    STAT --> MYSQL2[("MySQL")]
    FEED --> APP
~~~

第一条重要结论：

> **MySQL 通常不是“推荐系统”。**

推荐服务先决定“给用户哪些 video_id”，内容服务再按 ID 获取持久化元数据。

因此：

~~~sql
SELECT id, author_id, title, cover_url, duration_ms, status
FROM video
WHERE id IN (...20 ids...);
~~~

这类查询很合理。

而下面这种思路就完全是另一件事：

~~~sql
SELECT *
FROM video
ORDER BY some_score DESC
LIMIT 20;
~~~

如果你是在做个性化推荐，它不是简单靠一张 MySQL 表排序就能解决的。

---

# 1. 视频基础表：先保存“稳定事实”

一个简化版本：

~~~sql
CREATE TABLE video (
    id           BIGINT UNSIGNED NOT NULL,
    author_id    BIGINT UNSIGNED NOT NULL,
    title        VARCHAR(256) NOT NULL,
    cover_url    VARCHAR(1024) NOT NULL,
    duration_ms  INT UNSIGNED NOT NULL,
    status       TINYINT NOT NULL,
    version      INT UNSIGNED NOT NULL DEFAULT 0,
    created_at   DATETIME(3) NOT NULL,
    published_at DATETIME(3) NULL,
    updated_at   DATETIME(3) NOT NULL,

    PRIMARY KEY (id),
    KEY idx_author_created (author_id, created_at DESC, id DESC),
    KEY idx_status_publish (status, published_at DESC, id DESC)
) ENGINE=InnoDB;
~~~

这里的重点不是字段名字，而是：

~~~text
video 表保存的是：
“这个视频是谁发的、现在处于什么状态、基本元数据是什么”
~~~

而不是：

~~~text
每秒播放数
实时在线人数
推荐分数
每次曝光日志
~~~

这些数据的访问模式、吞吐量、生命周期都不同，硬塞进一张表只会让它越来越难维护。

---

# 2. 为什么主键经常用 BIGINT，而不是一个很长的字符串

InnoDB 里：

> 主键通常就是聚簇索引，行数据跟着主键组织。

而二级索引叶子节点里还需要保存主键值。

所以如果：

~~~text
PRIMARY KEY = 一个 100 字节字符串
~~~

那么每个二级索引都会变胖。

短、稳定、单调趋势良好的主键通常更友好。

真实系统里可以使用：

- 自增 BIGINT；
- Snowflake 类 ID；
- 服务侧生成的 64-bit ID。

重点不是“必须雪花”，而是理解：

> **主键的尺寸会扩散到所有二级索引里。**

---

# 3. 场景一：用户点赞一个视频

用户：

~~~text
user_id = 10086
video_id = 9001
~~~

最核心的关系其实只有一句话：

> 用户 10086 当前是否点赞了视频 9001？

一种常见表设计：

~~~sql
CREATE TABLE video_like (
    id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id    BIGINT UNSIGNED NOT NULL,
    video_id   BIGINT UNSIGNED NOT NULL,
    active     TINYINT NOT NULL DEFAULT 1,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,

    PRIMARY KEY (id),

    UNIQUE KEY uk_user_video (user_id, video_id),

    KEY idx_user_active_created
        (user_id, active, created_at DESC, video_id),

    KEY idx_video_active_created
        (video_id, active, created_at DESC, user_id)
) ENGINE=InnoDB;
~~~

## 3.1 最重要的是 UNIQUE，不是 PRIMARY KEY

业务约束是：

~~~text
同一个 user_id + video_id
只能有一份“当前关系”
~~~

所以：

~~~sql
UNIQUE KEY uk_user_video (user_id, video_id)
~~~

不是为了“加速一下”。

它首先是：

> **数据库层最后一道业务约束。**

就算：

- API 重试；
- 客户端重复点击；
- 网关重放；
- 两个实例并发处理；

最终数据库仍不会允许出现两份完全相同的点赞关系。

---

# 4. 为什么不能只靠“先 SELECT 再 INSERT”

错误实现：

~~~text
请求 A: SELECT → 没有
请求 B: SELECT → 没有

请求 A: INSERT
请求 B: INSERT
~~~

如果没有唯一约束：

~~~text
两条点赞记录都成功
~~~

这就是经典的：

> check-then-act race condition。

所以工程上通常是：

~~~text
应用逻辑
   +
数据库 UNIQUE 约束
~~~

两层一起做。

不要把正确性完全寄托在“我代码里已经判断过了”。

---

# 5. 点赞接口真正难的是“状态变化”，不是 INSERT

用户可能：

~~~text
点赞
点赞重试
取消点赞
取消点赞重试
再次点赞
~~~

如果还要驱动计数：

~~~text
like_count +1
like_count -1
~~~

你必须区分：

~~~text
请求到达
≠
业务状态真的发生了变化
~~~

例如：

~~~text
当前 active = 1
又收到一次 like
~~~

这是幂等 no-op，不能再给计数 +1。

---

# 6. 一个更稳的点赞事务

思路：

~~~mermaid
sequenceDiagram
    participant API as Like API
    participant DB as MySQL
    participant O as Outbox

    API->>DB: BEGIN
    API->>DB: SELECT relation FOR UPDATE
    DB-->>API: 当前 active 状态

    alt 状态需要变化
        API->>DB: INSERT / UPDATE video_like
        API->>O: INSERT LIKE_CHANGED event
    else 已经是目标状态
        API->>DB: no-op
    end

    API->>DB: COMMIT
~~~

伪 SQL：

~~~sql
START TRANSACTION;

SELECT id, active
FROM video_like
WHERE user_id = 10086
  AND video_id = 9001
FOR UPDATE;

-- 应用判断状态

UPDATE video_like
SET active = 1,
    updated_at = NOW(3)
WHERE user_id = 10086
  AND video_id = 9001
  AND active = 0;

-- 只有真实发生 0 -> 1 时才写 outbox

INSERT INTO outbox_event (...);

COMMIT;
~~~

如果记录不存在则插入。

注意：

> “记录不存在时两个事务同时插入”仍可能竞争。

所以 UNIQUE 约束仍然是最后的正确性保护。

应用层应该把 duplicate key 当作一个可处理的并发结果，而不是“数据库坏了”。

---

# 7. 为什么不建议每次点赞都更新 video.like_count

最直觉的做法：

~~~sql
UPDATE video
SET like_count = like_count + 1
WHERE id = 9001;
~~~

低流量时完全能用。

但假设某个视频爆了：

~~~text
10 万人同时点赞同一 video_id
~~~

所有事务都要竞争：

~~~text
video.id = 9001
~~~

这一行。

于是：

~~~text
热点视频
   ↓
热点行
   ↓
大量行锁等待
   ↓
事务堆积
   ↓
数据库吞吐下降
~~~

这叫：

> **hot row contention（热点行竞争）**

---

# 8. 热门计数通常怎么做

一种常见架构：

~~~mermaid
flowchart LR
    A["Like Request"] --> B["MySQL: video_like 关系事实"]
    A --> C["Redis: 热计数"]
    B --> D["Outbox / Binlog"]
    D --> E["MQ / CDC"]
    E --> F["Counter Projector"]
    F --> G["MySQL 聚合表 / Redis 修正"]
~~~

MySQL 保存：

> “谁赞了谁”这种可恢复事实。

Redis 保存：

> 高频读取的近实时 count。

异步投影器根据事实修正聚合结果。

这时要接受一个重要现实：

> **“关系事实强一致”与“展示计数绝对实时”是两个不同问题。**

很多产品允许 count 有几十毫秒到几秒延迟。

---

# 9. 如果你真的要用 MySQL 做计数，怎么减轻热点

可以做分桶：

~~~sql
CREATE TABLE video_like_counter_bucket (
    video_id   BIGINT UNSIGNED NOT NULL,
    bucket_id  TINYINT UNSIGNED NOT NULL,
    like_count BIGINT UNSIGNED NOT NULL,

    PRIMARY KEY (video_id, bucket_id)
) ENGINE=InnoDB;
~~~

请求按 hash 分到：

~~~text
bucket 0
bucket 1
...
bucket 31
~~~

写入从：

~~~text
所有人争一行
~~~

变成：

~~~text
32 个桶分摊锁竞争
~~~

读取：

~~~sql
SELECT SUM(like_count)
FROM video_like_counter_bucket
WHERE video_id = ?;
~~~

但这仍然是在做工程权衡：

- 写更分散；
- 读更复杂；
- 仍不如专门的高速缓存计数器自然。

---

# 10. 场景二：判断“这 20 个视频我赞过哪些”

首页一次返回 20 个视频。

前端还需要：

~~~text
liked = true / false
~~~

不要写 20 次 SQL：

~~~text
SELECT ...
SELECT ...
SELECT ...
...
~~~

应该批量：

~~~sql
SELECT video_id
FROM video_like
WHERE user_id = ?
  AND active = 1
  AND video_id IN (...20 ids...);
~~~

此时：

~~~sql
UNIQUE KEY uk_user_video (user_id, video_id)
~~~

本身就很适合这种查法。

结果：

~~~text
[9001, 8112, 7555]
~~~

聚合服务再映射回 20 个卡片。

这就是一个很典型的：

> **批量查询消除 N+1。**

---

# 11. 场景三：用户打开“我的点赞”

需求：

~~~text
查询用户最近点赞的 20 个视频
~~~

SQL：

~~~sql
SELECT video_id, created_at
FROM video_like
WHERE user_id = ?
  AND active = 1
ORDER BY created_at DESC, video_id DESC
LIMIT 20;
~~~

于是联合索引：

~~~sql
KEY idx_user_active_created
    (user_id, active, created_at DESC, video_id)
~~~

不是凭感觉写的。

它是从查询一步步推出来的：

~~~text
WHERE user_id = ?
      ↓
user_id 放前面

AND active = 1
      ↓
继续收窄

ORDER BY created_at DESC
      ↓
让索引顺序和排序一致

video_id
      ↓
作为稳定游标的一部分 / 尽量减少回表
~~~

---

# 12. 为什么“索引越多越好”是错的

如果 video_like 有：

~~~text
1 亿行
~~~

每次点赞除了写聚簇索引，还要维护每棵二级索引。

所以：

~~~text
新增一个索引
≠
免费提升查询
~~~

它会增加：

- INSERT 成本；
- UPDATE 成本；
- DELETE 成本；
- buffer pool 占用；
- 磁盘空间；
- DDL 维护成本。

原则：

> **索引必须由真实查询模式驱动。**

如果业务根本没有：

~~~text
按 video_id 列出最近点赞用户
~~~

那么：

~~~sql
idx_video_active_created
~~~

可能就不应该存在。

---

# 13. 场景四：评论区第一页

表：

~~~sql
CREATE TABLE video_comment (
    id          BIGINT UNSIGNED NOT NULL,
    video_id    BIGINT UNSIGNED NOT NULL,
    user_id     BIGINT UNSIGNED NOT NULL,
    parent_id   BIGINT UNSIGNED NULL,
    root_id     BIGINT UNSIGNED NULL,
    content     VARCHAR(2000) NOT NULL,
    status      TINYINT NOT NULL,
    like_count  INT UNSIGNED NOT NULL DEFAULT 0,
    created_at  DATETIME(3) NOT NULL,
    updated_at  DATETIME(3) NOT NULL,

    PRIMARY KEY (id),

    KEY idx_video_status_created
        (video_id, status, created_at DESC, id DESC),

    KEY idx_root_created
        (root_id, status, created_at ASC, id ASC),

    KEY idx_user_created
        (user_id, created_at DESC, id DESC)
) ENGINE=InnoDB;
~~~

第一页：

~~~sql
SELECT id, user_id, content, created_at
FROM video_comment
WHERE video_id = ?
  AND status = 1
ORDER BY created_at DESC, id DESC
LIMIT 20;
~~~

这就是：

~~~sql
idx_video_status_created
~~~

存在的理由。

---

# 14. 为什么评论区不要一直 OFFSET

简单分页：

~~~sql
LIMIT 20 OFFSET 100000
~~~

数据库不是“直接跳到第 100001 行”。

大量情况下它仍要：

~~~text
找到 / 扫过前面很多索引记录
↓
丢掉
↓
再返回 20 行
~~~

页数越深越浪费。

评论、动态流这类无限滚动，更适合 cursor / keyset pagination。

---

# 15. Keyset Pagination

第一页最后一条：

~~~text
created_at = 2026-09-24 12:01:03.123
id         = 881234
~~~

下一页：

~~~sql
SELECT id, user_id, content, created_at
FROM video_comment
WHERE video_id = ?
  AND status = 1
  AND (created_at, id) < (?, ?)
ORDER BY created_at DESC, id DESC
LIMIT 20;
~~~

索引：

~~~text
(video_id, status, created_at DESC, id DESC)
~~~

这时数据库能从游标附近继续向后扫描，而不是每次从开头丢弃大量记录。

线上仍要用：

~~~sql
EXPLAIN
~~~

确认优化器真实使用了你预期的访问路径。

---

# 16. 为什么排序里还需要 id

如果只有：

~~~text
ORDER BY created_at DESC
~~~

而两个评论恰好同一毫秒：

~~~text
A.created_at == B.created_at
~~~

游标边界会变得不稳定。

所以常加：

~~~text
created_at DESC, id DESC
~~~

形成稳定全序。

这是很多 Feed / 评论 / 消息流都会使用的技巧。

---

# 17. 场景五：视频发布状态不能“谁最后 UPDATE 谁赢”

假设状态：

~~~text
DRAFT
  ↓
REVIEWING
  ↓
REVIEW_PASSED
  ↓
PUBLISHED
  ↓
OFFLINE
~~~

两个后台任务同时修改：

~~~text
审核服务：REVIEW_PASSED
运营服务：OFFLINE
~~~

如果都执行：

~~~sql
UPDATE video
SET status = ?
WHERE id = ?;
~~~

最后一次写会无条件覆盖前一次。

---

# 18. 用条件更新表达状态机

例如发布：

~~~sql
UPDATE video
SET status = 4,
    version = version + 1,
    published_at = NOW(3),
    updated_at = NOW(3)
WHERE id = ?
  AND status = 3
  AND version = ?;
~~~

如果：

~~~text
affected_rows = 0
~~~

说明：

- 状态已经不是 REVIEW_PASSED；
- 或 version 已经被别人改了。

这就是一种：

> **Optimistic Locking（乐观锁）**

重点不是有一个叫 version 的字段。

重点是：

> 更新必须声明“我以为旧状态是什么”。

---

# 19. 乐观锁什么时候比 FOR UPDATE 更自然

短事务、冲突概率低时：

~~~text
读取 version
↓
做本地计算
↓
UPDATE ... WHERE version = old_version
~~~

非常自然。

如果冲突：

~~~text
affected_rows = 0
↓
重读 / 重试
~~~

而如果业务必须：

~~~text
先锁住一份资源
↓
再根据最新值做多个相关修改
~~~

那么：

~~~sql
SELECT ... FOR UPDATE
~~~

更合适。

不要把“乐观锁/悲观锁”当成固定优劣。

它们对应不同冲突模型。

---

# 20. 场景六：不要在事务里调用远程服务

错误：

~~~text
BEGIN
↓
SELECT ... FOR UPDATE
↓
调用审核 RPC
↓
等待 800ms
↓
调用对象存储
↓
等待 2s
↓
UPDATE
↓
COMMIT
~~~

此时锁可能持有几秒。

并发请求大量等待。

正确方向通常是：

~~~text
短事务修改本地状态
↓
提交
↓
异步事件 / 工作流
↓
远程调用
↓
下一次短事务推进状态
~~~

原则：

> **数据库事务应该尽量短。**

事务不是“把整个业务流程包起来”的工具。

---

# 21. 场景七：Outbox 为什么会出现

假设点赞关系写成功后要发 MQ：

~~~text
BEGIN
  INSERT video_like
COMMIT

publish MQ
~~~

如果：

~~~text
COMMIT 成功
↓
进程立刻崩溃
↓
MQ 没发
~~~

那么：

~~~text
数据库有点赞
但下游永远不知道
~~~

反过来先发 MQ 也有问题：

~~~text
MQ 成功
↓
数据库事务失败
~~~

下游看到了一个并不存在的点赞。

---

# 22. Transactional Outbox

把业务事实和“待发送事件”放进同一事务：

~~~sql
START TRANSACTION;

UPDATE video_like ...;

INSERT INTO outbox_event (
    event_id,
    aggregate_type,
    aggregate_id,
    event_type,
    payload,
    created_at
)
VALUES (...);

COMMIT;
~~~

于是：

~~~text
要么：
点赞 + outbox 都成功

要么：
都失败
~~~

后台 dispatcher 再把 outbox 发到 MQ。

~~~mermaid
flowchart LR
    A["业务事务"] --> B[("video_like")]
    A --> C[("outbox_event")]
    C --> D["Dispatcher"]
    D --> E["MQ"]
    E --> F["推荐 / 统计 / 风控"]
~~~

注意：

> Outbox 并不会神奇地让整个系统“exactly once”。

Dispatcher 可能：

~~~text
MQ 已发送成功
↓
还没来得及标记 outbox
↓
进程崩溃
↓
重启后再次发送
~~~

所以消费者还要：

> **按 event_id 幂等。**

---

# 23. 场景八：短视频系统里 Redis 与 MySQL 的边界

一个实用的分法：

## MySQL

适合：

- 视频元数据；
- 点赞关系持久事实；
- 收藏关系；
- 评论；
- 审核状态；
- 订单/付费；
- 需要事务约束的数据。

## Redis

适合：

- 热门视频点赞数；
- “这批视频是否点赞”缓存；
- 高频排行榜；
- session / rate limit；
- 短期热点状态。

但不要说：

> Redis 快，所以 MySQL 没用了。

真正关系是：

~~~text
MySQL
= 持久事实 / 约束 / 事务 / 恢复基础

Redis
= 高频访问层 / 热点层 / 临时状态层
~~~

---

# 24. 一个完整点赞链路

把前面全部串起来：

~~~mermaid
sequenceDiagram
    participant U as User
    participant API as Like Service
    participant DB as MySQL
    participant R as Redis
    participant MQ as MQ
    participant P as Projector

    U->>API: POST /videos/9001/like
    API->>DB: BEGIN
    API->>DB: 锁定/读取 user-video relation
    DB-->>API: active=0
    API->>DB: UPDATE active=1
    API->>DB: INSERT outbox LIKE_ADDED
    API->>DB: COMMIT
    API->>R: 更新热点状态/计数
    API-->>U: success

    Note over DB,MQ: 异步
    DB->>MQ: Dispatcher 发布 outbox
    MQ->>P: LIKE_ADDED
    P->>P: 幂等消费
    P->>R: 修正/更新统计
~~~

你现在应该能看到：

> “点赞功能”并不是一个 `INSERT`。

它同时涉及：

- 唯一约束；
- 幂等；
- 行锁；
- 事务；
- 联合索引；
- 热点行；
- Redis；
- Outbox；
- 异步一致性。

---

# 25. 面试里真正应该怎么回答“设计点赞系统”

不要只答：

> Redis 记录 count，MySQL 记录关系。

应该按层展开：

~~~text
① 先定义事实
user_id + video_id 是点赞关系

② 数据库约束
UNIQUE(user_id, video_id)

③ 写入幂等
重复 like 是 no-op

④ 列表查询
(user_id, active, created_at, video_id) 联合索引

⑤ 热点问题
不能所有点赞 UPDATE 同一个 video.like_count

⑥ 缓存与聚合
Redis 扛热读与近实时 count

⑦ 可靠异步
关系变更 + outbox 同事务

⑧ 消费幂等
event_id 去重

⑨ 深分页
评论/点赞历史使用 keyset pagination

⑩ 规模继续扩大
再讨论分片、CDC、OLAP，而不是上来就分库分表
~~~

这才是一个完整的数据库工程回答。

---

# 26. 本章留下的五个底层问题

现在我们已经“会设计”了一些结构。

下一步必须解释底层为什么：

1. 为什么联合索引能同时支持过滤和排序？
2. 为什么二级索引会携带主键？
3. `SELECT ... FOR UPDATE` 到底锁的是“行”还是“索引记录”？
4. 为什么一个坏索引会让锁范围扩大？
5. 为什么普通 SELECT 不一定被 UPDATE 阻塞？

这些问题会在：

> [03｜从场景反推 InnoDB：索引、MVCC、锁与事务](./03-innodb-from-scenes.md)

里统一拆开。


---

# 27. 新场景：收藏和点赞为什么不一定共用一张 interaction 表

很诱人的设计：

~~~text
user_video_interaction
(user_id, video_id, liked, favorited, shared, ...)
~~~

看起来少建表，但要继续问：

~~~text
点赞和收藏生命周期相同吗？
查询方向相同吗？
数据保留策略相同吗？
写 QPS 相同吗？
以后收藏是否有 folder？
取消点赞是否要保留历史？
~~~

如果收藏未来支持收藏夹、排序、备注，那么收藏会自然长成 favorite_folder + video_favorite，而点赞仍然只是 user-video relation。

“字段看起来像”不代表应该放同一张表。

---

# 28. 新场景：收藏夹设计

~~~sql
CREATE TABLE favorite_folder (
    id          BIGINT UNSIGNED NOT NULL,
    user_id     BIGINT UNSIGNED NOT NULL,
    name        VARCHAR(128) NOT NULL,
    folder_type TINYINT UNSIGNED NOT NULL,
    created_at  DATETIME(3) NOT NULL,

    PRIMARY KEY (id),
    KEY idx_user_created (user_id, created_at, id)
) ENGINE=InnoDB;

CREATE TABLE video_favorite (
    id         BIGINT UNSIGNED NOT NULL,
    user_id    BIGINT UNSIGNED NOT NULL,
    folder_id  BIGINT UNSIGNED NOT NULL,
    video_id   BIGINT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL,

    PRIMARY KEY (id),
    UNIQUE KEY uk_folder_video (folder_id, video_id),
    KEY idx_user_video (user_id, video_id),
    KEY idx_folder_created (folder_id, created_at DESC, id DESC)
) ENGINE=InnoDB;
~~~

为什么 UNIQUE 是 folder_id + video_id，而不是 user_id + video_id？

因为产品规则可能允许同一个视频出现在用户的多个不同收藏夹。

业务规则改变，唯一键就改变。这正是“先定义不变量，再建表”。

---

# 29. 新场景：关注关系与明星热点

~~~sql
CREATE TABLE user_follow (
    id          BIGINT UNSIGNED NOT NULL,
    follower_id BIGINT UNSIGNED NOT NULL,
    followee_id BIGINT UNSIGNED NOT NULL,
    active      TINYINT UNSIGNED NOT NULL,
    created_at  DATETIME(3) NOT NULL,
    updated_at  DATETIME(3) NOT NULL,

    PRIMARY KEY (id),
    UNIQUE KEY uk_follow (follower_id, followee_id),
    KEY idx_follower_created
        (follower_id, active, created_at DESC, followee_id),
    KEY idx_followee_created
        (followee_id, active, created_at DESC, follower_id)
) ENGINE=InnoDB;
~~~

维护两个方向的索引，是因为真实 Query 同时存在“我关注了谁”和“谁关注了我”。

到了分库分表阶段，这两个方向甚至会产生 shard-key 冲突。

大型系统可能按 follower_id 保存主关系，再异步构建 followee 方向 projection。

---

# 30. 新场景：举报系统为什么不能塞 comment.status

用户可能举报视频、评论、用户、直播、私信；一个目标还可能被很多人举报。

因此举报是独立事实：

~~~text
report
├─ reporter_id
├─ target_type
├─ target_id
├─ reason_code
├─ evidence_ref
├─ status
└─ created_at
~~~

运营处置又是另一个生命周期：

~~~text
moderation_case
~~~

不要把用户举报、机器审核、内容最终状态压进同一个 status。

---

# 31. 新场景：计数到底放哪

一个视频可能有：

~~~text
play_count
like_count
comment_count
favorite_count
share_count
~~~

如果全部放 video 主行并高频 UPDATE：

~~~text
同一个爆款 video.id
↓
成为超级热点行
~~~

更合理要区分：

~~~text
关系事实
video_like / comment / favorite

实时展示
Redis / counter service

长期聚合
video_stat_snapshot / OLAP / projector
~~~

video 表可以有低频快照，但不应该把所有高频事实压在身份主行上。

---

# 32. 新场景：播放历史与曝光日志为什么是另一类数据

用户刷视频会产生曝光、开始播放、播放 3 秒、播放 80%、完播、跳过、重播等事件。

如果每个事件都同步写 OLTP MySQL 主库：

~~~text
Feed QPS
× 每个视频多个行为事件
↓
极高写放大
~~~

这类行为日志往往走：

~~~text
客户端/服务端事件
↓
日志或消息系统
↓
流处理
↓
OLAP / Feature Store
~~~

只有真正需要 OLTP 语义的“最近观看历史”等状态，才可能单独落 MySQL。

---

# 33. 一个更完整的短视频数据库地图

~~~mermaid
flowchart TB
    subgraph Content["Content DB"]
      V["video"]
      VR["video_revision"]
      VA["video_asset"]
      MT["moderation_task"]
      PJ["publish_job"]
    end

    subgraph Interaction["Interaction DB"]
      L["video_like"]
      F["video_favorite"]
      C["comment"]
      R["report"]
    end

    subgraph Social["Social DB"]
      UF["user_follow"]
    end

    Content --> O["Outbox / Binlog"]
    Interaction --> O
    Social --> O

    O --> MQ["MQ / CDC"]
    MQ --> Redis["Redis"]
    MQ --> Search["Search"]
    MQ --> Reco["Recommendation"]
    MQ --> OLAP["Warehouse / OLAP"]
~~~

学 MySQL 的关键不是把整张图都塞进 MySQL，而是知道哪些数据是 OLTP 核心事实，哪些数据应该成为异步读模型。
