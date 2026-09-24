# LLM 大模型面试速成路线

> 目标：让一个计算机基础不强的人，从“知道 ChatGPT”一路走到能够回答大模型算法/工程常见面试题，并能把知识串成完整逻辑。

这套资料不是“背 23 道题”，而是把题目放回它们真正所属的知识链。


## 图文化入口（推荐）

如果你不想从纯文字 Markdown 开始，优先打开这些页面：

- [LLM 总览首页](index.html)
- [Transformer / BERT / GPT 图解](transformer.html)
- [Pretraining / Post-training 图解](training.html)
- [Inference / Serving 图解](inference-serving.html)
- [RAG / Agent 图解](rag-agent.html)

这些页面使用浅色卡片、流程图、对比图、悬浮解释和章节导航；Markdown 章节继续作为更完整的文字参考。

## 0. 总地图

~~~mermaid
flowchart LR
    A[数学与深度学习基础] --> B[Transformer]
    B --> C[BERT / GPT / Encoder / Decoder]
    C --> D[预训练]
    D --> E[后训练 SFT / DPO / RLHF / GRPO]
    E --> F[推理与解码]
    F --> G[KV Cache / FlashAttention / PagedAttention]
    G --> H[量化 / LoRA / QLoRA]
    H --> I[RAG]
    I --> J[Agent / Tool Calling]
    J --> K[MoE]
    K --> L[vLLM / SGLang / llama.cpp]
    L --> M[评测 / 幻觉 / 系统设计]
~~~

面试真正考的不是“会不会背概念”，而是能不能回答三层：

1. **是什么**：定义与直觉。
2. **为什么**：它解决什么问题，为什么这么设计。
3. **工程上怎么用**：代价、指标、取舍、线上问题。

## 1. 推荐阅读顺序

| 顺序 | 章节 | 看完应该会什么 |
|---|---|---|
| 1 | [00-基础数学与深度学习](00-foundations.md) | 向量、矩阵、Softmax、Loss、梯度、Embedding |
| 2 | [01-Transformer、BERT 与 GPT](01-transformer-bert-gpt.md) | Encoder/Decoder、QKV、MHA/GQA/MQA、位置编码 |
| 3 | [02-预训练](02-pretraining.md) | LLM 怎么从随机参数训练成 Base Model |
| 4 | [03-后训练](03-post-training.md) | SFT、RLHF、PPO、DPO、GRPO、拒绝采样 |
| 5 | [04-推理与解码](04-inference-decoding.md) | 自回归、Prefill/Decode、采样、KV Cache |
| 6 | [05-微调与量化](05-finetuning-quantization.md) | Full FT、LoRA、QLoRA、INT8/INT4/AWQ/GPTQ |
| 7 | [06-RAG 与 Agent](06-rag-agent.md) | Embedding、召回、Rerank、Tool Calling、Agent Loop |
| 8 | [07-MoE 与现代模型结构](07-moe-modern-architecture.md) | MoE、路由、负载均衡、现代模型的效率设计 |
| 9 | [08-部署与推理系统](08-serving-deployment.md) | vLLM/SGLang/TGI/llama.cpp、吞吐、显存、并发 |
| 10 | [09-评测、幻觉与安全](09-evaluation-hallucination.md) | benchmark、LLM-as-Judge、幻觉、线上评测 |
| 11 | [10-面试题库](10-interview-bank.md) | 截图 23 题 + 扩展高频题 |
| 12 | [11-系统设计案例](11-system-design-cases.md) | 企业 RAG、高并发 Chat、Coding Agent |
| 13 | [12-论文与源码路线](12-papers-and-source.md) | 继续深挖论文和源码 |
| 14 | [13-7天速成计划](13-seven-day-crash-plan.md) | 每天学什么、画什么、怎么自测 |
| 15 | [14-术语字典](14-glossary.md) | HBM、Kernel、NCCL、Logits 等术语扫盲 |
| 16 | [15-最小实验](15-mini-labs.md) | 用小代码验证 Softmax、Attention、KV Cache、RAG |

## 2. LLM 生命周期

~~~mermaid
flowchart LR
    A[海量文本/代码] --> B[Tokenizer]
    B --> C[Pretraining]
    C --> D[Base Model]
    D --> E[SFT]
    E --> F[Preference / RL]
    F --> G[Chat / Reasoning Model]
    G --> H[Serving]
    H --> I[RAG / Agent]
    I --> J[Eval / Feedback]
~~~

一句话：

- **预训练**：学语言、知识、代码和模式。
- **后训练**：学会听指令、偏好、推理和任务完成。
- **推理**：把训练好的模型高效跑起来。
- **RAG/Agent**：接外部知识和工具。
- **评测**：证明它真的变好了。

## 3. 截图里的 23 道题放到哪里

1. LLM vs 传统 NLP → 01
2. Transformer / Encoder / Decoder → 01
3. MHA / MQA / GQA / FlashAttention → 01、04
4. Sin/Cos / RoPE / ALiBi → 01
5. Tokenizer → 02
6. 大模型如何训练 → 02
7. Scaling Law / 涌现 → 02
8. 微调方案 → 05
9. LoRA → 05
10. SFT 后的 Post-Training → 03
11. DPO vs PPO → 03
12. Greedy / Beam / Sampling → 04
13. Temperature / Top-p / Top-k → 04
14. KV Cache / Prompt Cache → 04、08
15. INT8 / INT4 / AWQ / GPTQ → 05
16. Prompt 工程 → 06
17. CoT → 03、06
18. 幻觉 → 09
19. MoE / DeepSeek / Qwen → 07
20. vLLM / TGI / llama.cpp / SGLang → 08
21. 模型评测 → 09
22. 模型选型 → 09、11
23. Lost in the Middle / 长上下文 → 01、04

## 4. 面试回答统一模板

任何概念都先按：

> **定义 → 机制 → 为什么需要 → 代价/场景**

例如“什么是 KV Cache”：

- 定义：缓存历史 token 的 K/V。
- 机制：Decode 时只算新 token 的 QKV，不重算历史 K/V。
- 为什么：自回归生成否则每一步都重复算历史。
- 代价：显存随 batch、sequence length、层数增长。

## 5. 最终必须能从头讲完的链路

~~~text
用户 Prompt
    │
    ▼
Tokenizer
    │
    ▼
Token IDs
    │
    ▼
Embedding + Position
    │
    ▼
N × Transformer Decoder Block
    │
    ├─ RMSNorm
    ├─ Self Attention
    │    ├─ Q/K/V
    │    ├─ RoPE
    │    ├─ GQA/MQA
    │    └─ KV Cache
    ├─ Residual
    ├─ RMSNorm
    ├─ FFN / SwiGLU / MoE
    └─ Residual
    │
    ▼
LM Head
    │
    ▼
Logits
    │
    ▼
Temperature / Top-k / Top-p
    │
    ▼
Next Token
    │
    └──────────────► 再送回模型继续生成
~~~

如果这条链能从头到尾解释清楚，大多数 LLM 基础面试已经有骨架。
