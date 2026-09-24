# 01｜短视频场景：点赞、评论、发布与热点数据

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
