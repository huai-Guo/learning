# 04｜MySQL / InnoDB 内部：一条 SQL 从客户端到磁盘经历什么

> 这一章回答：
>
> **你写下一条 SELECT / UPDATE 以后，MySQL 内部到底谁在做什么？数据在哪？索引在哪？锁在哪？日志又在哪？**

先不要把 MySQL 想成一个黑盒。

~~~mermaid
flowchart LR
    APP["Application"] --> CONN["Connection / Session"]
    CONN --> PARSER["Parser"]
    PARSER --> OPT["Optimizer"]
    OPT --> EXEC["Executor"]
    EXEC --> HANDLER["Storage Engine Handler"]
    HANDLER --> INNO["InnoDB"]
    INNO --> BP["Buffer Pool"]
    INNO --> LOCK["Lock / MVCC"]
    INNO --> REDO["Redo / Undo"]
    BP --> PAGE["Data / Index Pages"]
    REDO --> DISK["Redo / Tablespace / Undo"]
~~~

---

# 0. MySQL Server 和 InnoDB 不是同一层

先记住两个世界。

## MySQL Server Layer

主要负责：

~~~text
连接 / Session
SQL 解析
权限与语义检查
Optimizer
Executor
Join / Sort / Aggregate 等 SQL 执行逻辑
Binlog
~~~

## InnoDB Storage Engine

主要负责：

~~~text
B+Tree
Page
Buffer Pool
Record
MVCC
Row Lock
Redo
Undo
Tablespace
Crash Recovery
~~~

所以：

~~~text
SQL 怎么执行
和
数据页怎么保存
~~~

并不是完全同一层的问题。

---

# 1. 从应用到 MySQL：Connection / Session

后端一般不是每条 SQL 都重新建立 TCP 连接，而是通过连接池复用 MySQL connection。

一个 connection / session 会携带自己的上下文，例如：

- 当前事务；
- autocommit；
- 隔离级别；
- session variables；
- temporary objects；
- 当前数据库等。

所以“数据库连接”不是一个完全无状态 HTTP 请求。

这也是为什么连接池配置会直接影响数据库并发。

---

# 2. Parser：先把字符串变成 SQL 结构

应用发：

~~~sql
SELECT id, title
FROM video
WHERE creator_id = 10086
ORDER BY created_at DESC
LIMIT 20;
~~~

MySQL 首先需要理解：

~~~text
这是 SELECT
FROM video
选择 id,title
过滤 creator_id=10086
排序 created_at DESC
限制 20
~~~

语法错误会在这一阶段附近暴露。

但“能解析”不代表“知道怎么最快执行”。

下一步才是 Optimizer。

---

# 3. Optimizer：决定“怎么做”，而不是“做什么”

SQL 描述目标：

~~~text
我要这些结果
~~~

Optimizer 决定执行方案：

~~~text
走 PRIMARY KEY？
走 idx_creator_created？
全表扫描？
先扫哪张 JOIN 表？
用 Nested Loop 还是 Hash Join？
需要排序吗？
需要临时表吗？
~~~

它是 cost-based optimizer。

核心不是寻找理论上绝对最优计划，而是在有限时间里基于统计信息和成本模型选择一个预计较便宜的计划。

---

# 4. Optimizer 的统计信息从哪里来

它不可能真的把所有方案都完整执行一遍再比较。

所以依赖：

~~~text
表行数估算
索引 cardinality
索引统计
数据分布统计
Histogram
~~~

然后估算：

~~~text
某条件大约剩多少行
走这个索引要读多少 Page
回表多少次
排序多少数据
Join 哪个方向更便宜
~~~

如果估算错了，计划也可能错。

这就是 EXPLAIN ANALYZE 里 estimated rows 与 actual rows 差距非常值得关注的原因。

---

# 5. Executor：按照执行计划真正拉取数据

可以把现代执行过程理解成一组 iterator。

例如：

~~~text
Limit 20
  ↓
Index range scan
  ↓
Filter
  ↓
Result
~~~

JOIN 可能：

~~~text
Nested Loop
├─ outer iterator
└─ inner index lookup
~~~

或者在适用场景下：

~~~text
Hash Join
├─ build side
└─ probe side
~~~

EXPLAIN FORMAT=TREE / EXPLAIN ANALYZE 就是在帮助你观察这棵执行树。

---

# 6. Executor 怎么和 InnoDB 说话

Server Layer 不应该自己知道：

~~~text
InnoDB B+Tree page 内部格式
undo page 在哪里
record lock 怎么实现
~~~

它通过存储引擎接口请求：

~~~text
按某索引找 key
读下一条记录
插入记录
更新记录
锁定记录
~~~

然后 InnoDB 完成真正的页和记录操作。

这就是 MySQL 支持 storage engine abstraction 的核心边界。

---

# 7. InnoDB 真正操作的基本单位之一：Page

磁盘不是每次只读一个 id=10086 的“逻辑行”。

InnoDB 把表和索引组织成 Page。

默认配置下常见 InnoDB page size 是 16 KiB。

可以先形成这个模型：

~~~text
Tablespace
├─ Page 100
├─ Page 101
├─ Page 102
└─ ...

B+Tree
├─ internal pages
└─ leaf pages
~~~

数据库 IO、缓存、B+Tree 分裂、flush 都围绕 Page 展开。

---

# 8. B+Tree 为什么不把每一行都做成一个磁盘节点

如果一个节点只保存一个 key：

~~~text
10 亿行
↓
树会非常高
↓
每次查询大量随机 IO
~~~

B+Tree Page 能容纳很多 key / pointer。

于是 fan-out 很大：

~~~text
root
↓
internal page
↓
leaf page
~~~

即使数据量很大，树高度通常仍然较低。

B+Tree 设计真正利用的是：

> 一次磁盘 Page IO 可以带回很多有序 key。

---

# 9. 聚簇索引内部到底存什么

InnoDB 表的 clustered index 叶子记录包含完整行数据。

如果有 PRIMARY KEY，它通常作为聚簇索引 key。

例如：

~~~text
PRIMARY KEY(id)
~~~

叶子近似：

~~~text
id=1001 | creator_id | status | created_at | ...
id=1002 | creator_id | status | created_at | ...
id=1003 | creator_id | status | created_at | ...
~~~

所以按主键找到 leaf record，就找到了整行。

---

# 10. 二级索引为什么还存主键

索引：

~~~sql
KEY idx_creator_created(creator_id, created_at)
~~~

叶子近似：

~~~text
creator_id | created_at | primary_key
~~~

因此 SELECT * 通过二级索引查询时常见：

~~~text
Secondary B+Tree
↓
得到 primary key
↓
Primary B+Tree
↓
得到完整 row
~~~

这就是回表。

所以二级索引不是“指向磁盘地址的永久指针”，而是通过主键回到聚簇索引。

---

# 11. Buffer Pool：为什么热数据不用每次读磁盘

InnoDB 的 Buffer Pool 缓存数据页和索引页。

读路径：

~~~text
需要 Page 123
↓
Buffer Pool 有？
├─ 有：直接内存访问
└─ 没有：从磁盘读 Page 123
          ↓
       放入 Buffer Pool
~~~

所以很多“索引查询很快”的前提还包括：

> 相关 B+Tree Page 很可能已经是热页。

索引大小影响 Buffer Pool 命中率，这也是宽索引的隐藏成本。

---

# 12. Buffer Pool 不是一个无限 HashMap

内存有限。

InnoDB 需要决定：

~~~text
哪些 Page 留着
哪些 Page 淘汰
哪些 dirty page 先 flush
~~~

Buffer Pool 内部会维护与 LRU、free page、dirty page flush 等相关的数据结构。

因此大范围扫描可能把大量冷 Page 带进内存，并影响真正热点页的驻留。

---

# 13. Dirty Page 是什么

UPDATE 一行后：

~~~text
磁盘 Page = 旧版本
Buffer Pool Page = 新版本
~~~

此时内存 Page 和磁盘不同，这个 Page 就是 dirty page。

它并不要求事务 COMMIT 时立即把整个 16 KiB Page 同步刷回最终表文件。

因为 InnoDB 还有 redo log。

---

# 14. 为什么“改 Page”之外还要写 Redo

如果：

~~~text
Buffer Pool 已修改
↓
数据页还没刷盘
↓
断电
~~~

内存修改就丢了。

所以使用 WAL 思路：

~~~text
先让恢复所需 redo 足够可靠
↓
COMMIT
↓
dirty page 后台慢慢刷
~~~

这样避免每次事务都同步随机写完整数据页。

---

# 15. Log Buffer：Redo 也先在内存形成

事务修改 Page 时会产生 redo records。

它们先进入 redo log buffer，再按照提交与后台刷新策略写入 redo log files。

所以写路径不是：

~~~text
UPDATE
↓
直接改磁盘表文件
~~~

而更像：

~~~text
修改 Buffer Pool Page
+
生成 Undo
+
生成 Redo
↓
提交持久化协议
↓
以后刷 Dirty Page
~~~

---

# 16. Undo 在内部承担两个完全不同但相关的角色

## Rollback

事务：

~~~text
100 -> 80
~~~

ROLLBACK 时需要撤销逻辑变化。

## MVCC

另一个事务可能仍需要看到：

~~~text
100
~~~

于是旧版本信息还用于构建一致性读。

所以：

~~~text
Redo = crash 后向前恢复
Undo = rollback + 历史版本
~~~

不要只记“redo 重做、undo 回滚”这一句话。

---

# 17. InnoDB 行里还有事务版本信息

InnoDB MVCC 记录会涉及隐藏系统字段，例如事务 ID 与 rollback pointer。

可以形成简化模型：

~~~text
当前记录
├─ DB_TRX_ID
├─ DB_ROLL_PTR
└─ user columns
        │
        └─ undo version chain
             ↓
          older version
~~~

普通一致性读结合 Read View 判断当前版本是否可见；不可见时可以沿 undo 版本链寻找可见历史版本。

---

# 18. 普通 SELECT 和 SELECT FOR UPDATE 为什么不是一回事

普通 SELECT 在常见场景下是 consistent nonlocking read：

~~~text
Read View
↓
选择可见版本
~~~

SELECT ... FOR UPDATE 是 locking read：

~~~text
读取最新可锁定记录
+
对相关索引记录 / 范围加锁
~~~

所以一个 UPDATE 正在进行，并不意味着所有普通 SELECT 都必须阻塞。

MVCC 正是在提高读写并发。

---

# 19. Lock 和 Latch 不是同一个概念

这是内部知识里非常重要的一点。

## Lock

事务级并发控制：

~~~text
Record Lock
Gap Lock
Next-Key Lock
Table Intention Lock
~~~

可能持有到事务 COMMIT / ROLLBACK。

## Latch / Mutex

保护内存内部数据结构的短期同步：

~~~text
某个 Buffer Pool 结构
某棵 B+Tree Page 修改
内部共享结构
~~~

通常持有时间非常短。

不要把“行锁”和“内部 mutex”混成一种锁。

---

# 20. INSERT 一条记录内部可能发生什么

简化：

~~~text
INSERT
↓
检查约束 / UNIQUE
↓
定位聚簇索引叶子 Page
↓
Page 在 Buffer Pool？没有则读入
↓
在 Page 中插入 record
↓
维护所有 secondary indexes
↓
产生 undo
↓
产生 redo
↓
记录变成事务未提交版本
↓
COMMIT
~~~

所以索引越多，INSERT 维护的树越多。

---

# 21. 为什么随机主键会影响写入局部性

单调增长主键：

~~~text
大多数新记录
↓
接近 B+Tree 右侧叶子
~~~

随机 UUID 主键：

~~~text
新记录散布在整棵 B+Tree
↓
更多随机 Page 访问
↓
更容易触发 Page split / cache churn
~~~

这不是说 UUID 永远不能用。

而是：如果拿 UUID 作为 InnoDB clustered primary key，要理解它对 Page locality 和所有 secondary index 宽度的影响。

---

# 22. Page Split 是什么

目标 leaf page 已经很满，又要插入中间 key：

~~~text
旧 Page
↓
空间不足
↓
分裂 / 重新组织
↓
父层更新指针
~~~

频繁随机插入可能增加 page split 和碎片成本。

所以主键趋势性与索引字段更新模式会影响写路径。

---

# 23. Secondary Index 更新为什么可能很随机

video_like 新增：

~~~text
PRIMARY(id)
idx_user_created(user_id, created_at)
idx_video_created(video_id, created_at)
~~~

即使 id 单调递增，user_id / video_id 对应的二级索引叶子可能散布在不同 Page。

一条 INSERT 可能要修改多棵树的不同页。

这就是 secondary index 写放大的物理来源。

---

# 24. Change Buffer 是什么，为什么 MySQL 8.4 要特别注意默认值

Change Buffer 可以缓存某些 secondary index page 的变更，当目标 Page 不在 Buffer Pool 时，避免为了一个修改立刻把冷页读进内存，之后再 merge。

它主要针对 secondary index 随机 IO 问题。

但是要注意版本事实：

> MySQL 8.4 中 innodb_change_buffering 默认值是 none。

所以不能照搬旧教程说“所有二级索引写都会默认进入 change buffer”。

理解机制与确认当前版本配置同样重要。

---

# 25. Adaptive Hash Index 是什么，为什么也不能照搬旧教程

InnoDB 可以根据热点 B+Tree 搜索模式建立 adaptive hash index，让部分热点查找更像内存 Hash lookup。

但 MySQL 8.4 中 adaptive hash index 默认关闭。

因此面试或排障时更准确：

~~~text
InnoDB 有 AHI 机制
但是否开启取决于版本与配置
MySQL 8.4 默认 OFF
~~~

不要把历史默认值当成当前事实。

---

# 26. Doublewrite Buffer 解决什么

假设一个 16 KiB Page 写磁盘过程中只写了一半，机器断电：

~~~text
Page header 是新的
Page 后半部分是旧的
~~~

这叫 torn page 风险。

Redo 并不等价于永远能从任意损坏的半页安全恢复。

InnoDB 的 doublewrite 机制在数据页写最终位置前，先把页面写到 doublewrite 区域；如果恢复时发现最终页写坏，可以使用 doublewrite 中的完整副本。

它解决的是：

> Page 物理写入原子性 / torn page 防护。

这和 redo 的职责不同。

---

# 27. Checkpoint 为什么存在

如果 redo 永远不截断：

~~~text
系统运行一年
↓
恢复需要重放一年日志
~~~

不可接受。

Checkpoint 用于推进“哪些更早 redo 已经不再是 crash recovery 必需”的边界。

背后依赖 dirty page flushing。

所以：

~~~text
Redo Log
Dirty Page
Checkpoint
Page Cleaner
~~~

是一组关联机制。

---

# 28. Flush List 和 LRU Flush 是两个不同视角

Buffer Pool 既要：

~~~text
为新 Page 腾空间
~~~

又要：

~~~text
控制 dirty page / checkpoint 推进
~~~

所以内部会有围绕 LRU 与 dirty page flush list 的不同刷新目标。

不要把“刷脏页”理解成只有 COMMIT 时发生一次。

后台 page cleaner 会持续工作。

---

# 29. 一个 SELECT 点查的完整链路

~~~sql
SELECT *
FROM video_like
WHERE user_id = 10086
  AND video_id = 9001;
~~~

有 UNIQUE(user_id,video_id)。

完整心智模型：

~~~text
Client
↓
Parser
↓
Optimizer
  选择 uk_user_video
↓
Executor
↓
InnoDB Handler
↓
Secondary B+Tree root
↓
internal page
↓
leaf page
↓
得到 primary key id
↓
Primary B+Tree
↓
找到 clustered record
↓
MVCC 判断版本可见性
↓
返回 Server
↓
返回 Client
~~~

如果所需 Page 都在 Buffer Pool，主要是内存访问；否则中间会出现磁盘 Page read。

---

# 30. 一个 UPDATE 的完整链路

~~~sql
UPDATE video_like
SET active = 1
WHERE user_id = 10086
  AND video_id = 9001;
~~~

简化链路：

~~~text
Parser / Optimizer
↓
通过 uk_user_video 定位
↓
InnoDB 找到 record
↓
检查并获取必要的 record lock
↓
生成 undo
↓
修改 Buffer Pool record
↓
维护涉及的 secondary indexes
↓
生成 redo
↓
事务 COMMIT 协调
↓
以后 dirty page flush
~~~

所以“一行 UPDATE”同时牵涉：

~~~text
索引
锁
MVCC
Undo
Redo
Buffer Pool
Page
~~~

---

# 31. 为什么一个坏索引会同时让 CPU、IO、锁都变差

如果本来应该点查 1 行，却因为没有索引扫描 100 万行：

~~~text
更多 Page
↓
更多 Buffer Pool 污染
↓
更多条件判断 CPU
↓
更多回表 / IO
↓
locking statement 可能访问/锁更多索引记录
↓
事务时间更长
↓
锁冲突进一步放大
~~~

所以索引不是单纯“查询快一点”。

它会改变整个数据库并发行为。

---

# 32. 为什么长事务内部代价很高

长事务可能同时意味着：

- Lock 持有更久；
- Undo 历史版本存活更久；
- Purge 更难推进；
- Deadlock 窗口变大；
- DDL metadata lock 风险变高；
- 连接长期占用。

所以不要在事务中：

~~~text
调用 LLM
等待 HTTP API
上传对象存储
sleep
人工审批
~~~

数据库事务应该尽量包住短小的本地原子状态变化。

---

# 33. 为什么 MySQL 内部知识最终还是要回到 Query

学习 Buffer Pool、Page、Redo 不是为了画架构图。

你最终应该能把线上现象反推回机制：

~~~text
为什么 SELECT * 很慢？
→ 回表 / 大行 / Page / Buffer Pool

为什么加很多索引写入变慢？
→ 多棵 B+Tree + 二级索引随机页修改

为什么长事务让 undo 膨胀？
→ MVCC 旧版本仍可能被 Read View 需要

为什么 COMMIT 不等于数据页已经落盘？
→ WAL + Redo + Dirty Page

为什么断电不会因为半页写坏直接毁数据？
→ Doublewrite + Recovery

为什么优化器不用索引？
→ Cost + Statistics + 回表成本
~~~

这才是“懂 MySQL 内部”。

---

# 34. 必须掌握的内部知识地图

~~~text
MySQL Server
├─ Connection / Session
├─ Parser
├─ Optimizer
├─ Executor / Iterator
├─ Join / Sort / Temp
└─ Binlog

InnoDB
├─ B+Tree
│  ├─ Clustered Index
│  └─ Secondary Index
├─ Page / Tablespace
├─ Buffer Pool
│  ├─ LRU
│  ├─ Free Pages
│  └─ Flush List
├─ Transaction
│  ├─ MVCC
│  ├─ Read View
│  ├─ Undo
│  └─ Lock
├─ Write Path
│  ├─ Redo Log Buffer
│  ├─ Redo Log
│  ├─ Dirty Page
│  ├─ Doublewrite
│  └─ Checkpoint
└─ Background Work
   ├─ Page Cleaner
   ├─ Purge
   └─ IO / Flush
~~~

下一章继续把事务、MVCC、Record / Gap / Next-Key Lock 与死锁单独深挖。
