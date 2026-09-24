# 04｜推理：Prefill、Decode、KV Cache、Sampling、FlashAttention

## 1. 自回归生成

用户输入：

~~~text
中国的首都是
~~~

模型输出所有词表 token 的 logits：

~~~text
北京  12.1
上海   8.0
深圳   5.3
...
~~~

通过解码策略选出“北京”，再把它追加进上下文继续预测。

~~~text
中国的首都是
     ↓
北京
     ↓
中国的首都是北京
     ↓
。
~~~

所以生成阶段是串行的：第 t+1 个 token 依赖前 t 个 token。

## 2. Prefill vs Decode

### Prefill

一次处理整个 prompt，例如 4000 token。

特点：

- token 之间可并行；
- 大矩阵乘法利用率较好；
- 往往更偏 compute-bound；
- 会建立初始 KV Cache。

### Decode

之后每一步通常只增加一个 token。

特点：

- 串行；
- 每步读取大量历史 KV；
- memory bandwidth 非常关键；
- 容易变成 memory-bound。

面试关键：

> Prefill 和 Decode 是完全不同的性能阶段，所以现代推理系统会分别优化，甚至把两者拆到不同机器。

## 3. KV Cache

没有 KV Cache：

生成第 1000 个 token 时，前面 999 个 token 的 K/V 每一步都重新算。

KV Cache：

> 缓存每一层历史 token 的 K 和 V。

新 token 到来时：

~~~text
新 token
  ↓
算 Q_new / K_new / V_new
  ↓
Q_new 对 K_cache 做 Attention
  ↓
读取 V_cache
~~~

历史 token 的 K/V 不再重复投影。

## 4. KV Cache 大小

粗略：

~~~text
KV bytes
≈ 2
× num_layers
× sequence_length
× num_kv_heads
× head_dim
× bytes_per_element
× batch
~~~

2 表示 K 和 V 两份。

所以长上下文 + 大并发时，KV Cache 可能比你想象得更占显存。

这也是 GQA/MQA 的重要价值。

## 5. Prompt Cache / Prefix Cache

假设每个请求共享 5000 token System Prompt：

~~~text
[同一个公司制度 5000 tokens]
+ 用户 A 问题

[同一个公司制度 5000 tokens]
+ 用户 B 问题
~~~

Prefix Cache 可以缓存共享 prefix 的 KV，后续跳过重复 Prefill。

区分：

- **KV Cache**：单个 request 自回归过程中缓存历史。
- **Prefix Cache**：多个 request 共享相同前缀时复用已算 KV。

## 6. Greedy Search

永远取 argmax。

优点：

- 稳定；
- 确定性强；
- 计算简单。

适合：

- 分类式任务；
- 格式固定输出；
- 某些代码/结构化任务。

缺点：缺乏多样性，容易局部最优。

## 7. Beam Search

同时保留 B 个候选序列。

~~~text
Step 1: A / B / C
Step 2: AA AB AC BA BB BC ...
只保留累计概率最高的 B 条
~~~

传统翻译等 seq2seq 常见。

开放式聊天中不一定适合，因为：

- 更贵；
- 高概率序列不代表最符合用户偏好；
- 容易产生模板化输出。

## 8. Temperature

~~~text
softmax(logits / T)
~~~

T 小：

- 分布更尖；
- 更确定。

T 大：

- 分布更平；
- 更多样。

注意 API 中 temperature=0 往往会走特殊确定性逻辑，不是数学意义上直接除 0。

## 9. Top-k

只保留概率最高的 k 个 token，其余置零后归一化。

缺点：

> 无论当前模型确定还是不确定，候选数量都固定。

## 10. Top-p

找一个最小 token 集合，使累计概率达到 p。

模型很确定时集合小；不确定时集合大。

所以比固定 k 更自适应。

## 11. 参数怎么配

不存在全局最佳值。

### 代码 / 数学 / JSON

偏确定：

- 低随机性；
- 低 temperature；
- structured output；
- constrained decoding。

### 创意写作

可增加随机性：

- 更高 temperature；
- 较宽 top-p。

真正工程上：

> 用自己的 eval 集调参，不要迷信网上固定参数。

## 12. Repetition Penalty

降低已出现 token 再次被选中的概率，缓解循环重复。

但过强会伤害：

- 代码；
- 表格；
- 固定模板；
- 本来需要重复的术语。

## 13. FlashAttention

标准 Attention 若显式物化 N×N 中间矩阵，会产生大量 HBM 读写。

FlashAttention 的核心不是改模型语义，而是：

> 使用 IO-aware tiling，尽量在更快的片上 SRAM 中完成分块计算，减少 GPU HBM 往返。

重要区别：

~~~text
GQA/MQA
= 模型 Attention 结构优化

FlashAttention
= Attention kernel / IO 计算优化
~~~

不要回答“FlashAttention 把 O(n²) 变 O(n)”。经典 FlashAttention 仍是 exact attention。

## 14. PagedAttention

服务场景里每个请求长度不同。

如果给每个请求预留一整块最大连续 KV 内存，会产生：

- 内部碎片；
- 外部碎片；
- 预留浪费。

PagedAttention 思路类似 OS 分页：

~~~text
逻辑 KV 序列
  ↓
Block table
  ↓
分散的物理 KV blocks
~~~

这样能更灵活管理 KV Cache。

vLLM 的代表性贡献之一就是围绕分页式 KV 管理构建高吞吐 serving。

## 15. Continuous Batching

传统 batch：

~~~text
A: 100 output tokens
B: 20 output tokens
~~~

B 结束后，如果 batch 固定，它的槽位可能空着等 A。

Continuous Batching：

> 请求完成就移出，新请求动态加入。

目标是提高 GPU 利用率和 throughput。

## 16. Chunked Prefill

超长 prompt 的 Prefill 会长时间占 GPU，打断正在 decode 的低延迟请求。

Chunked Prefill 把大 Prefill 切成块，与 Decode 更灵活地调度，平衡：

- TTFT；
- TPOT；
- throughput。

## 17. Speculative Decoding

Draft Model 快速猜多个 token：

~~~text
小模型：A B C D
          ↓
大模型一次验证
~~~

如果很多候选被接受，就减少大模型串行 Decode 次数。

## 18. TTFT / TPOT / Throughput

### TTFT

Time To First Token：

> 从请求进入系统到输出第一个 token。

受队列、Prefill 等影响。

### TPOT

Time Per Output Token：

> 第一个 token 之后，每输出一个 token 的平均时间。

### Throughput

> 单位时间处理的 tokens 或 requests。

线上常常要权衡：

~~~text
低单请求延迟
vs
最大系统吞吐
~~~

## 19. 为什么 context 不是越大越好

上下文变长会带来：

- Prefill 更慢；
- KV Cache 更大；
- Attention 计算更多；
- Lost in the Middle；
- 无关信息增多；
- 单请求成本变高。

所以工程上常用：

- RAG；
- context pruning；
- prompt compression；
- rerank；
- summary memory。

下一章：[微调与量化](05-finetuning-quantization.md)
