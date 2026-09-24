# 13｜7 天大模型面试速成计划

目标不是 7 天变成研究员，而是：

> 让你能从底层链路解释主流 LLM，并能扛住大部分算法/工程岗位的一轮基础追问。

每天都遵循：

~~~text
学概念
↓
手画结构
↓
口述 3 分钟
↓
做追问
↓
用一个真实系统解释
~~~

# Day 1｜Transformer / BERT / GPT

阅读：

- 00-foundations
- 01-transformer-bert-gpt

必须会画：

~~~text
Token
↓
Embedding
↓
Decoder Block
├─ Norm
├─ Attention(QKV)
├─ Residual
├─ Norm
├─ FFN
└─ Residual
↓
LM Head
↓
Next Token
~~~

必须能回答：

1. Encoder / Decoder 区别。
2. BERT / GPT 区别。
3. QKV 是什么。
4. 为什么多头。
5. GQA 为什么省 KV。
6. RoPE 干什么。
7. FlashAttention 为什么快。

过关标准：

> 不看资料，5 分钟从输入 token 讲到 next-token logits。

# Day 2｜Pretraining / Post-Training

阅读：

- 02-pretraining
- 03-post-training

必须画：

~~~text
Raw Data
↓
Clean / Dedup
↓
Tokenizer
↓
Pretrain
↓
Base Model
↓
SFT
↓
DPO / RLHF / GRPO
↓
Chat / Reasoning Model
~~~

必须回答：

- next-token 为什么能学知识；
- SFT 和预训练区别；
- DPO vs PPO；
- GRPO 是什么；
- rejection sampling；
- verifiable reward；
- scaling law。

过关标准：

> 能把“一个随机模型如何变成 Chat Model”完整讲出来。

# Day 3｜Inference / Serving

阅读：

- 04-inference-decoding
- 08-serving-deployment

必须画：

~~~text
Prompt
↓
Prefill
↓
KV Cache
↓
Decode token 1
↓
Decode token 2
↓
...
~~~

以及：

~~~text
Clients
↓
Gateway
↓
Queue
↓
Scheduler
↓
Continuous Batch
↓
GPU Workers
~~~

必须回答：

- Prefill vs Decode；
- KV Cache；
- Prefix Cache；
- PagedAttention；
- Continuous Batching；
- TTFT/TPOT；
- vLLM vs SGLang vs TGI vs llama.cpp。

过关标准：

> 给你一张 80GB GPU，能解释为什么“权重放得下”仍可能 OOM。

# Day 4｜Fine-Tuning / Quantization / RAG

阅读：

- 05-finetuning-quantization
- 06-rag-agent 前半

必须回答：

- LoRA 公式；
- QLoRA；
- rank；
- INT4；
- AWQ/GPTQ；
- Fine-Tuning vs RAG；
- Chunk / Embedding / Reranker。

必须画：

~~~text
Document
↓
Chunk
↓
Embedding
↓
Retrieve
↓
Rerank
↓
Prompt
↓
LLM
~~~

过关标准：

> 面试官给“企业知识库”需求，你不会第一句话就说“微调模型”。

# Day 5｜Agent / MoE

阅读：

- 06-rag-agent 后半
- 07-moe-modern-architecture

必须回答：

- Agent vs LLM；
- Tool Calling；
- Agent Loop；
- Memory vs Context；
- MCP；
- MoE Router；
- Top-K Experts；
- Expert Parallel；
- DeepSeek-V3 的 MLA/MoE/MTP 分别解决什么。

必须画：

~~~text
Goal
↓
LLM
↓
Action
↓
Tool
↓
Observation
└────→ LLM
~~~

过关标准：

> 知道“让模型决定一切”不是好的 Agent 架构。

# Day 6｜Eval / Hallucination / System Design

阅读：

- 09-evaluation-hallucination
- 11-system-design-cases

必须回答：

- hallucination 来源；
- RAG 错误归因；
- LLM-as-Judge 偏差；
- internal eval；
- online A/B；
- 模型怎么选；
- Prompt Injection。

做三道系统设计：

1. 企业 RAG。
2. 高并发 Chat API。
3. Coding Agent。

过关标准：

> 每个系统设计都能说“指标、瓶颈、失败模式、如何验证”。

# Day 7｜80 题 Mock Interview

阅读：

- 10-interview-bank

方法：

第一轮：

> 每题 30 秒，一句话回答。

第二轮：

> 每题 2 分钟，定义→机制→原因→代价。

第三轮：

> 随机选 20 题，每题自己追加两个 Why。

例如：

~~~text
KV Cache 是什么？
↓
为什么只缓存 K/V 不缓存 Q？
↓
GQA 为什么降低 KV？
↓
KV Cache 为什么影响并发？
↓
PagedAttention 为什么有用？
~~~

这才叫真正“串起来”。

# 面试前最后必须能手画的 8 张图

1. Transformer Decoder Block。
2. Q/K/V Attention。
3. Encoder vs Decoder Mask。
4. Pretrain → SFT → RL。
5. Prefill → KV Cache → Decode。
6. RAG Pipeline。
7. Agent Loop。
8. LLM Serving Scheduler。

# 最后自检

如果下面任何一句还只能背定义，就回相应章节：

- 为什么 Decoder 不能看未来？
- 为什么 GQA 减少显存？
- 为什么 FlashAttention 与 GQA 不冲突？
- 为什么 LoRA 能用低秩？
- 为什么 DPO 不需要显式 Reward Model？
- 为什么 Decode 容易 memory-bound？
- 为什么长 context 不代表利用率高？
- 为什么 MoE 参数大但 FLOPs 没同比增长？
- 为什么 RAG 错了不能直接怪 LLM？
- 为什么高并发 Serving 需要 Scheduler？

全部能从“原因 → 机制 → 工程代价”讲清，才算完成这套速成路线。
