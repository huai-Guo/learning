# 03｜MySQL 索引怎么设计：从 Query 到 B+Tree，再到 EXPLAIN 验证

> 前三章解决“表为什么这样设计”。
>
> 这一章解决另一个核心问题：
>
> **给你一条真实 SQL，你怎么判断该不该建索引、建哪几个字段、字段顺序怎么排、这个索引到底有没有被正确使用？**

索引设计不是口诀集合。完整过程应该是：

~~~text
Query
↓
过滤条件
↓
排序 / 分组
↓
返回列
↓
数据分布
↓
候选联合索引
↓
EXPLAIN
↓
EXPLAIN ANALYZE
↓
真实生产指标
↓
保留 / 调整 / 删除
~~~

---

# 0. 每一条重要 Query 先回答 10 个问题

~~~text
① WHERE 里哪些是等值条件？
② 哪些是范围条件？
③ ORDER BY / GROUP BY 是什么？
④ LIMIT 多大？
⑤ SELECT 真正需要哪些列？
⑥ 表有多少行？
⑦ 每个条件的数据分布怎样？
⑧ 查询 QPS 多高？
⑨ 写入 QPS 多高？
⑩ 是否值得为了它增加一棵索引树？
~~~

然后才讨论 CREATE INDEX。

---

# 1. 联合索引不是“多个字段都建了索引”

~~~sql
KEY idx_user_status_time
(user_id, status, created_at DESC, id DESC)
~~~

应该理解为一组按字典序排列的 key：

~~~text
先 user_id
user_id 相同再 status
前两者相同再 created_at
前三者相同再 id
~~~

所以它天然适合：

~~~text
user_id = ?
user_id = ? AND status = ?
user_id = ? AND status = ? AND created_at < ?
~~~

这就是最左前缀的本质。

---

# 2. 两个单列索引通常不等于一个联合索引

查询：

~~~sql
SELECT id
FROM video_like
WHERE user_id = 10086
  AND video_id = 9001;
~~~

方案 A：

~~~sql
KEY idx_user(user_id)
KEY idx_video(video_id)
~~~

方案 B：

~~~sql
UNIQUE KEY uk_user_video(user_id, video_id)
~~~

方案 B 可以直接在一棵有序树里定位 (10086,9001)。方案 A 可能选择一个单列索引后再过滤，或者由优化器考虑 Index Merge。

对于核心高频组合查询，联合索引通常更直接，而且 UNIQUE 还可以同时保护业务不变量。

---

# 3. 字段顺序怎么定：从 Query 反推

短视频作者页：

~~~sql
SELECT id, current_revision_id, created_at
FROM video
WHERE creator_id = ?
  AND lifecycle_status = ?
ORDER BY created_at DESC, id DESC
LIMIT 20;
~~~

候选：

~~~sql
KEY idx_creator_status_created
(creator_id, lifecycle_status, created_at DESC, id DESC)
~~~

推导：

~~~text
creator_id
= 等值过滤

lifecycle_status
= 等值过滤

created_at,id
= 排序 + keyset cursor
~~~

数据库可以先缩到某作者某状态对应的连续区间，再按索引已有顺序读取前 20 条。

---

# 4. “高选择性字段放最左”不是绝对规则

多租户查询：

~~~sql
WHERE tenant_id = ?
  AND user_id = ?
ORDER BY created_at DESC
~~~

tenant_id 单独看可能选择性不高，但它可能是所有查询都必须携带的数据隔离前缀，甚至未来还是 shard routing key。

因此：

~~~sql
(tenant_id, user_id, created_at DESC, id DESC)
~~~

完全可能是正确设计。

字段顺序应该综合：

~~~text
查询模式
+ 等值 / 范围
+ 排序
+ 数据分布
+ 多查询复用
+ 租户 / 分片边界
~~~

而不是只看 cardinality。

---

# 5. 范围条件之后的字段到底“失不失效”

索引：

~~~text
(user_id, created_at, video_id)
~~~

查询：

~~~sql
WHERE user_id = ?
  AND created_at >= ?
  AND video_id = ?
~~~

user_id 可以先定位；created_at 构造 range scan。

进入 created_at 范围以后，video_id 往往不能继续像前面的等值字段一样进一步缩小同一个连续 B+Tree 查找边界。

但 video_id 仍然可能用于：

- Index Condition Pushdown；
- 覆盖索引；
- 减少回表后的过滤成本。

所以更准确的说法是：

> 范围条件之后的字段往往不能继续构造同样精确的索引搜索边界，但并不等于完全没有价值。

---

# 6. Index Condition Pushdown 为什么重要

假设二级索引：

~~~text
(zipcode, lastname, firstname)
~~~

查询：

~~~sql
WHERE zipcode = '95054'
  AND lastname LIKE '%etrunia%'
  AND address LIKE '%Main%'
~~~

zipcode 可以决定扫描范围，但 lastname 的前导百分号不能继续缩小 B+Tree 搜索范围。

如果没有 ICP：

~~~text
二级索引找到大量 zipcode 候选
↓
大量回表
↓
Server 再判断 lastname
~~~

有 ICP：

~~~text
二级索引候选
↓
InnoDB 先用索引中的 lastname 过滤
↓
通过后才回表
~~~

EXPLAIN Extra 常见：

~~~text
Using index condition
~~~

---

# 7. 覆盖索引为什么能减少一次 B+Tree 查找

~~~sql
SELECT video_id, created_at
FROM video_like
WHERE user_id = ?
  AND active = 1
ORDER BY created_at DESC, video_id DESC
LIMIT 20;
~~~

索引：

~~~sql
(user_id, active, created_at DESC, video_id DESC)
~~~

查询需要的数据全部在二级索引 entry 中：

~~~text
Secondary B+Tree
↓
直接返回
~~~

而不是：

~~~text
Secondary B+Tree
↓
取得 primary key
↓
Primary B+Tree
↓
读取整行
~~~

EXPLAIN Extra 常见 Using index，表示可以只利用索引数据满足查询。

---

# 8. 但不要为了覆盖无限加字段

索引越宽：

~~~text
每个 index entry 越大
↓
一个 Page 能放的 entry 越少
↓
树和缓存占用越大
↓
INSERT / UPDATE / DELETE 维护更贵
~~~

覆盖索引适合：高频、返回列少、收益明确的关键路径。

---

# 9. SELECT * 为什么经常让优化空间变差

业务只需要 id、status、created_at，却写 SELECT *，会带来：

- 更多回表机会；
- 更多网络传输；
- 更多对象反序列化；
- 覆盖索引机会减少；
- 新增列后请求数据量被动增长。

生产 SQL 应该尽量表达真实列需求。

---

# 10. ORDER BY 如何利用索引

~~~sql
WHERE user_id = ?
ORDER BY created_at DESC, id DESC
LIMIT 20
~~~

配：

~~~sql
(user_id, created_at DESC, id DESC)
~~~

user_id 固定后，剩余索引记录已经按目标顺序组织，可以避免额外排序。

MySQL 支持 descending indexes，因此 ASC / DESC 方向也应该进入索引设计。

---

# 11. Using filesort 不等于“一定写磁盘文件”

filesort 是 MySQL 的排序执行路径名称。它可能在内存完成，也可能因为数据量和内存限制使用临时磁盘空间。

看到 Using filesort 真正应该问：

> 这个排序是否可以通过正确的索引顺序直接避免？

---

# 12. Keyset Pagination 为什么必须和索引一起设计

深分页：

~~~sql
ORDER BY created_at DESC
LIMIT 20 OFFSET 100000
~~~

数据库往往仍需访问并丢弃前面大量记录。

Keyset：

~~~sql
WHERE user_id = ?
  AND (created_at, id) < (?, ?)
ORDER BY created_at DESC, id DESC
LIMIT 20
~~~

配：

~~~sql
(user_id, created_at DESC, id DESC)
~~~

可以从上一次游标附近继续扫描。

评论、Feed、消息、Run Timeline 都应该优先考虑这种模型。

---

# 13. 为什么排序里经常追加 id

created_at 可能重复。

只按 created_at 排序不能形成稳定全序，所以常用：

~~~text
created_at DESC, id DESC
~~~

游标就可以表示成：

~~~text
(last_created_at, last_id)
~~~

这是正确分页语义，不是为了凑联合索引。

---

# 14. LIKE 什么时候适合普通 B+Tree

通常：

~~~sql
name LIKE 'mysql%'
~~~

可以利用有序前缀范围。

而：

~~~sql
name LIKE '%mysql'
name LIKE '%mysql%'
~~~

无法像固定前缀那样构造 B+Tree 左边界。

包含式全文搜索更适合 Full-Text 或专门搜索系统。

---

# 15. 函数包住索引列为什么常常不理想

有：

~~~sql
KEY idx_created(created_at)
~~~

不要优先写：

~~~sql
WHERE DATE(created_at) = '2026-09-24'
~~~

更自然：

~~~sql
WHERE created_at >= '2026-09-24 00:00:00'
  AND created_at <  '2026-09-25 00:00:00'
~~~

让谓词直接作用在索引列上，便于构造范围访问。

---

# 16. JSON 里的核心字段什么时候应该升格

Agent model_config 可以放 JSON，但如果 region、provider、tier 开始频繁参与：

~~~text
WHERE
ORDER BY
UNIQUE
权限过滤
分片路由
~~~

它们就应该认真考虑成为正式列，或通过生成列等方式建立索引访问路径。

JSON 是扩展性工具，不是逃避 Schema Design 的方法。

---

# 17. 单列索引仍然很重要

如果查询就是：

~~~sql
WHERE external_request_id = ?
~~~

并且该值应该全局唯一：

~~~sql
UNIQUE(external_request_id)
~~~

非常合理。

不是所有索引都应该联合；联合索引来自组合访问模式。

---

# 18. UNIQUE 索引首先保护正确性

~~~sql
UNIQUE(user_id, video_id)
~~~

表达：同一个用户和视频只有一份逻辑关系。

如果只建普通 KEY，应用并发 bug 仍可能插出两条业务重复记录。

设计评审必须区分：

~~~text
性能索引
vs
业务约束索引
~~~

---

# 19. 低选择性字段不是绝对不能放索引

status 只有几个值，单独 INDEX(status) 可能价值低。

但是任务队列：

~~~sql
WHERE status = READY
  AND available_at <= NOW()
ORDER BY priority DESC, id
LIMIT 1
~~~

索引：

~~~sql
(status, available_at, priority DESC, id)
~~~

却可能是关键访问路径。

低选择性字段能否做联合索引左部，要看真实 Query，不看口号。

---

# 20. Prefix Index 什么时候有用

长字符串可以只索引前 N 个字符：

~~~sql
INDEX idx_name(name(32))
~~~

收益是索引 entry 更小；代价是前缀可能区分度不够，也不能覆盖完整列值。

N 应该基于真实前缀基数和 Query 评估，而不是随便选 20 或 32。

---

# 21. 冗余索引怎么判断

已有：

~~~sql
INDEX(a,b,c)
~~~

又有：

~~~sql
INDEX(a)
~~~

后者可能是冗余候选，因为前者的 leftmost prefix 已支持 a 查找。

但删除前还要检查：

- 索引宽度；
- 覆盖能力；
- 优化器计划；
- 实际 workload。

不能机械删。

---

# 22. Invisible Index：删除索引前的灰度手段

思路：

~~~text
怀疑 idx_old 没用
↓
设为 invisible
↓
普通优化器不再选择
↓
观察线上
↓
确认安全
↓
再 DROP
~~~

索引也应该有生命周期治理。

---

# 23. 为什么索引越多写越贵

INSERT 一行不只维护 PRIMARY KEY，还要维护所有 secondary indexes。

因此：

~~~text
读优化
↔
写放大 / 空间 / Buffer Pool 占用
~~~

始终是交换关系。

---

# 24. 主键设计为什么影响所有二级索引

InnoDB 二级索引记录会携带主键值。

因此 BIGINT 主键和很宽的 VARCHAR 主键，会让所有 secondary index 的空间成本不同。

“主键怎么设计”本质上也是“所有二级索引怎么设计”。

---

# 25. EXPLAIN 第一眼看什么

至少关注：

~~~text
type
possible_keys
key
key_len
rows
filtered
Extra
~~~

常见访问方式直觉：

~~~text
const
唯一键常量点查

eq_ref
JOIN 中唯一/主键单行匹配

ref
非唯一等值索引查找

range
索引范围扫描

index
扫描整棵索引

ALL
全表扫描
~~~

访问类型只是线索，不是简单的“分数排名”。

---

# 26. rows 是估算，不是真实执行值

普通 EXPLAIN 的 rows 来自优化器统计估算。

如果估算偏差很大，优化器可能选择不理想的计划。

所以复杂慢查询要继续看 EXPLAIN ANALYZE。

---

# 27. EXPLAIN ANALYZE 看什么

MySQL 8.4 的 EXPLAIN ANALYZE 会实际运行 SELECT，并以 TREE 形式展示 iterator 信息，包括：

- estimated rows；
- actual rows；
- time to first row；
- iterator time；
- loops。

最有价值的场景之一：

~~~text
Optimizer 估 10 行
实际 50 万行
~~~

这通常说明统计、数据分布或谓词相关性值得继续调查。

注意：EXPLAIN ANALYZE 会真的执行查询，线上要理解开销。

---

# 28. Optimizer 为什么可能不用你建的索引

优化器是 cost-based，不是“有索引必用”。

它会考虑：

~~~text
估算行数
索引统计
随机回表成本
顺序扫描成本
排序成本
Join 顺序
CPU / IO 成本
~~~

如果 WHERE status=1 命中 90% 数据，扫描二级索引再大量回表可能比直接扫描更贵，所以 ALL 不一定是错误。

---

# 29. Histogram 解决什么问题

数据分布不均匀时，只有基数可能不足以估算选择性。

MySQL 8.4 支持 column histogram，帮助优化器估计某些谓词会过滤掉多少行。

Histogram 是统计信息，不是直接加速数据访问的索引。

---

# 30. ANALYZE TABLE 是什么角色

ANALYZE TABLE 可以更新 key distribution，也可以管理 histogram。

如果数据分布发生巨大变化，旧统计可能导致优化器估算错误。

但它不是“慢 SQL 万能修复命令”；应该先判断执行计划为什么不合理。

---

# 31. Index Merge 为什么不是联合索引替代品

有 INDEX(a) 和 INDEX(b)，MySQL 可能对 WHERE a=? AND b=? 考虑 Index Merge。

但如果这是高频核心 Query，INDEX(a,b) 往往能提供更直接的访问路径，并可能同时支持排序和覆盖。

不要因为有 Index Merge，就给所有列各建一个单列索引。

---

# 32. JOIN 索引怎么推导

~~~sql
SELECT ...
FROM run r
JOIN run_step s ON s.run_id = r.id
WHERE r.id = ?
ORDER BY s.step_no;
~~~

run.id 用 PRIMARY KEY 点查。

run_step 需要高效支持：

~~~text
run_id = ?
并按 step_no 读取
~~~

因此：

~~~sql
UNIQUE KEY uk_run_step(run_id, step_no)
~~~

同时解决 Join 查找、排序和“一个 Run 不得有两个 step 17”的不变量。

---

# 33. MySQL 8.4 不只有 Nested Loop，也有 Hash Join

当 Join 条件没有合适索引等场景时，MySQL 8.4 可以采用 hash join。

因此真正分析 Join 要看执行计划：

~~~text
Index Lookup?
Nested Loop?
Hash Join?
Table Scan?
~~~

不要把“JOIN 就是嵌套循环”当成永远正确的回答。

---

# 34. 一个困难案例：审批队列

~~~sql
SELECT id, tool_call_id, expires_at
FROM tool_approval
WHERE tenant_id = ?
  AND status = PENDING
  AND expires_at > NOW()
ORDER BY created_at
LIMIT 50;
~~~

这里同时有：

~~~text
tenant_id 等值
status 等值
expires_at 范围
created_at 排序
~~~

范围和排序目标可能冲突。

不能机械套“等值列 + 范围列 + 排序列”。应该看：

~~~text
PENDING 占比多少？
过期记录比例多少？
LIMIT 只有 50 吗？
是先按 created_at 扫小批量再过滤更便宜，还是先按 expires_at 做 range 更便宜？
是否应该把“可审批”预计算成单独状态？
~~~

索引设计最终是 cost tradeoff。

---

# 35. 索引设计 Checklist

~~~text
[ ] 对应哪条 Query？
[ ] 等值条件是什么？
[ ] range 条件是什么？
[ ] ORDER BY / GROUP BY 是什么？
[ ] LIMIT 是多少？
[ ] 是否值得覆盖？
[ ] 数据分布怎样？
[ ] 是否和已有索引重复？
[ ] 增加多少写放大？
[ ] 主键宽度会怎样扩散？
[ ] EXPLAIN 计划是什么？
[ ] EXPLAIN ANALYZE 的 actual rows / loops / time 怎样？
[ ] 线上 slow query / p95 / p99 是否真的改善？
~~~

到这里才算真正会建索引。

下一章：

> [04｜MySQL / InnoDB 内部：一条 SQL 从客户端到磁盘经历什么](./04-innodb-internals.md)
