# 10｜LLM 高频面试题库：截图 23 题扩展版

每题都按：

> 定义 → 机制 → 为什么 → 代价 → 场景

回答。

## A. Transformer

### 1. 什么是 LLM？和传统 NLP 区别？

LLM 是在大规模数据和计算上预训练的通用语言模型，通常基于 Transformer，用统一预训练目标学习多任务能力；传统 NLP 更常见针对分类、NER、翻译等任务分别建模。

### 2. Transformer 基本结构？

Embedding、位置、Self-Attention、FFN、Residual、Norm，多层堆叠。

### 3. Encoder 与 Decoder？

Encoder 双向表征；Decoder Causal Mask 自回归；Encoder-Decoder 用于条件序列生成。

### 4. 为什么 QK 点积后除 sqrt(d_k)？

避免维度大时点积方差过大导致 Softmax 过尖。

### 5. MHA、MQA、GQA？

MHA 每个 Q head 对应 KV；MQA 所有 Q 共用一套 KV；GQA 多个 Q 分组共享 KV，在质量和 KV Cache 之间折中。

### 6. FlashAttention？

IO-aware exact Attention，通过分块减少 HBM 读写，不是简单把 O(n²) 变 O(n)。

### 7. Attention 为什么常说 O(n²)？

QK^T 需要计算 n×n token pair。

### 8. Residual 为什么重要？

提供信息/梯度高速路径，帮助深层网络优化。

### 9. RMSNorm vs LayerNorm？

RMSNorm 不减均值，按 RMS 缩放，计算更简洁，现代 LLM 常见。

### 10. SwiGLU？

带门控的 FFN 激活结构，提升非线性表示能力。

## B. Position / Tokenizer

### 11. 位置编码做什么？

给 Attention 注入顺序/相对位置。

### 12. Sin/Cos、RoPE、ALiBi？

Sin/Cos 加固定位置；RoPE 旋转 Q/K；ALiBi 给 attention score 加距离 bias。

### 13. RoPE 为什么有相对位置信息？

不同位置对应不同旋转，相乘/点积后可表达位置差。

### 14. 长上下文怎么扩？

RoPE scaling、position interpolation、YaRN 类方法、long-context training、sliding/hybrid attention；不能只改一个 max length。

### 15. Tokenizer？

字符串切成 subword/byte token，再映射 ID。

### 16. BPE / WordPiece / Unigram 区别？

分别从 merge、似然/打分、概率子词模型等思路构词表。

### 17. 为什么 Tokenizer 影响成本？

同一句话切出的 token 越多，训练/推理 sequence 越长。

## C. Pretraining

### 18. LLM 怎么训练？

数据清洗去重 → Tokenize → Packing → Pretrain → Base → SFT → Preference/RL → Eval。

### 19. Next Token 为什么能学知识？

为了降低 Loss，模型必须学习语言结构、事实共现和代码模式。

### 20. Scaling Law？

模型规模、数据、计算量与 Loss/能力有可预测缩放关系，需要合理配比。

### 21. 涌现？

某些能力表现随规模出现非线性提升，但“突然出现”受指标和评测方式影响。

### 22. 为什么 BF16？

相对 FP32 省显存/带宽，同时指数范围更适合训练。

### 23. DP / TP / PP？

DP 切数据；TP 切层内矩阵；PP 切模型层。

### 24. ZeRO / FSDP？

分片参数、梯度、optimizer state，降低单卡冗余。

### 25. Gradient Checkpoint？

少存 activation，反向重算，用计算换显存。

## D. Post-Training

### 26. SFT？

高质量 instruction-response 监督微调。

### 27. RLHF？

偏好 → Reward → RL 优化 policy。

### 28. DPO vs PPO？

DPO 直接用 chosen/rejected；PPO 是在线 RL，经典 RLHF 常需要 Reward/Value/Reference 等组件。

### 29. GRPO？

同 prompt 多采样，使用组内相对 reward 构造 advantage 类信号。

### 30. Rejection Sampling？

多生成，Judge/Verifier 筛好样本，再用于训练。

### 31. Verifiable Reward？

数学答案、代码测试等可以程序验证的 reward。

### 32. CoT 为什么有效？

将复杂问题拆成多个中间生成状态，降低单步难度。

### 33. CoT 局限？

成本高、会传播错误，中间文字不等于真实内部因果过程。

## E. Fine-Tuning

### 34. 微调方案？

Full FT、LoRA、QLoRA、Adapter、Prompt/Prefix tuning。

### 35. LoRA？

冻结 W，只训练低秩增量 BA。

### 36. LoRA 除参数少还有什么？

少 optimizer/gradient 显存、adapter 可插拔、多租户、版本管理方便、可 merge。

### 37. rank 越大越好？

不是，需要看容量、显存、过拟合和 Eval。

### 38. QLoRA？

低比特 Base Model + LoRA 训练。

### 39. Fine-Tuning vs RAG？

动态知识优先 RAG；行为/风格/技能适配偏 Fine-Tuning；实际常组合。

## F. Inference

### 40. Greedy / Beam / Sampling？

Greedy 每步最大；Beam 保留多路径；Sampling 按概率随机。

### 41. Temperature / Top-k / Top-p？

控制分布尖锐度、固定候选数、累计概率候选集合。

### 42. KV Cache？

缓存历史每层 K/V，Decode 不重算历史投影。

### 43. Prefix Cache？

跨请求复用共同前缀 KV，跳过重复 Prefill。

### 44. Prefill vs Decode？

Prefill 可并行且偏 compute；Decode 串行且偏 memory bandwidth。

### 45. TTFT / TPOT？

首 token 延迟 / 后续每 token 延迟。

### 46. Continuous Batching？

请求动态加入/退出 batch，提高 GPU 利用率。

### 47. PagedAttention？

按 block 管理 KV，减少连续预留和内存碎片。

### 48. Speculative Decoding？

Draft 快速提出 token，大模型批量验证，减少串行 Decode。

## G. Quantization

### 49. INT8 / INT4？

低 bit 表示权重/激活，省显存和带宽。

### 50. GPTQ vs AWQ？

GPTQ 偏重构误差；AWQ 利用 activation statistics 保护敏感权重。

### 51. 量化一定更快？

不一定，依赖硬件、kernel、batch、dequant overhead。

## H. RAG

### 52. RAG 流程？

Chunk → Embedding → Retrieve → Rerank → Context → LLM。

### 53. 为什么 Reranker？

Retriever 保 Recall，Reranker 在小候选集上精排。

### 54. BM25 + Dense 为什么混合？

精确关键词与语义召回互补。

### 55. RAG 怎么评？

Retrieval Recall@K/MRR/nDCG；Generation correctness/faithfulness/citation。

### 56. Chunk 越大越好？

不是。太小语义碎，太大检索不准且 prompt 贵。

## I. Agent

### 57. Agent 和 LLM？

LLM 是模型；Agent 是模型 + tools + state + loop + policy。

### 58. Tool Calling 链路？

LLM 提议 → Host 校验 → Tool 执行 → Result 回模型 → 继续。

### 59. Agent 如何停止？

finish signal、max turns、timeout、budget、host policy。

### 60. Memory vs Context？

Memory 可以在外部；Context 是当前调用真正输入模型的 tokens。

### 61. MCP？

统一 Agent/Host 与 tools/resources 的协议接口。

## J. MoE

### 62. MoE？

Router 为 token 选择少量 Expert，总容量大、激活参数少。

### 63. MoE 难点？

Router balance、Expert Parallel、All-to-All、网络和 kernel。

### 64. DeepSeek-V3 关键结构？

DeepSeekMoE、MLA、无辅助损失负载均衡、MTP。重点解释每个解决什么问题。

### 65. MLA vs GQA？

共同想降 KV 成本；GQA 减 KV heads，MLA 走潜变量压缩路线。

## K. Serving

### 66. vLLM 为什么快？

内存管理 + continuous batching + scheduler + prefix cache + optimized kernels + distributed execution。

### 67. SGLang 特点？

高性能 runtime、prefix/cache-aware execution、structured generation、PD 分离、分布式能力。

### 68. TGI？

Hugging Face 生产 serving：router、TP、batching、streaming、metrics 等。

### 69. llama.cpp？

GGUF、本地/CPU/Mac/Edge、多量化和跨硬件。

### 70. 如何估算推理显存？

weights + KV cache + runtime buffers；不能只算权重。

## L. Evaluation

### 71. 模型怎么评测？

Public benchmark + internal domain eval + production A/B。

### 72. LLM-as-Judge 坑？

Position、verbosity、self-preference、judge error。

### 73. 为什么幻觉？

模型优化 token 概率，不是数据库真值；再叠加知识/context/retrieval/reasoning 错误。

### 74. 怎么缓解幻觉？

RAG、tool、citation、verifier、structured output、abstain、human review。

### 75. Lost in the Middle？

长上下文中不同位置的信息利用不均，中间信息可能更难被利用。

### 76. Context 越大越好吗？

不。Prefill、KV、成本、噪声和利用率都会变差。

### 77. 项目里怎么选模型？

固定业务 Eval 和 SLA，再比较质量、可靠性、延迟、吞吐、成本，最后灰度 A/B。

## M. 系统设计

### 78. 百万文档企业 RAG？

讲 ingestion、chunk、embedding、BM25、vector、rerank、ACL、citation、cache、eval。

### 79. 高并发 LLM API？

讲 queue、scheduler、continuous batching、KV budget、TP、autoscaling、TTFT/TPOT、streaming。

### 80. Coding Agent？

讲 workspace、sandbox、tools、Agent Loop、tests/verifier、context compression、resume、permissions、eval。

下一章：[系统设计案例](11-system-design-cases.md)
