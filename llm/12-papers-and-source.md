# 12｜论文与源码学习路线

不是要求全部精读。顺序是：先直觉，再关键章节，再源码。

## 1. Transformer

Attention Is All You Need

https://arxiv.org/abs/1706.03762

重点：

- Scaled Dot-Product Attention；
- Multi-Head Attention；
- Encoder/Decoder；
- Positional Encoding。

## 2. BERT

BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding

https://arxiv.org/abs/1810.04805

重点：

- Encoder-only；
- Masked LM；
- 双向上下文；
- pretrain + finetune。

## 3. RoPE

RoFormer

https://arxiv.org/abs/2104.09864

目标：

> 理解为什么旋转 Q/K 后内积能携带相对位置。

## 4. LoRA

https://arxiv.org/abs/2106.09685

重点：

- 冻结 W；
- ΔW=BA；
- rank；
- adapter merge。

## 5. QLoRA

https://arxiv.org/abs/2305.14314

重点：

- 低比特 Base；
- LoRA；
- NF4；
- 内存优化。

## 6. FlashAttention

https://arxiv.org/abs/2205.14135

最重要：

> 优化 IO complexity，不是简单发明近似 Attention。

## 7. vLLM

https://docs.vllm.ai/

优先看：

- KV cache；
- prefix caching；
- continuous batching；
- distributed serving；
- quantization。

## 8. SGLang

https://docs.sglang.ai/

重点：

- runtime；
- cache reuse；
- structured generation；
- PD disaggregation；
- MoE serving。

## 9. TGI

https://huggingface.co/docs/text-generation-inference/

重点：

- router；
- launcher；
- model server；
- tensor parallel；
- batching；
- streaming。

## 10. llama.cpp

https://github.com/ggml-org/llama.cpp

重点：

- GGUF；
- quantization；
- CPU/GPU backend；
- llama-cli；
- llama-server。

## 11. DeepSeek-V3

https://arxiv.org/abs/2412.19437

重点：

- DeepSeekMoE；
- 671B total / 37B activated；
- MLA；
- auxiliary-loss-free load balancing；
- MTP。

不要只背分数，要问：

> 每个设计解决的是算力、显存、通信还是训练稳定性？

## 12. Qwen3

https://arxiv.org/abs/2505.09388

重点：

- Dense + MoE family；
- 总参数 vs 激活参数；
- multilingual；
- reasoning 能力设计。

## 13. DPO

Direct Preference Optimization

https://arxiv.org/abs/2305.18290

重点：

> 为什么 preference optimization 可以不用完整 RM + PPO 在线环。

## 14. Reasoning RL

建议结合 DeepSeek-R1 等公开技术报告理解：

- SFT / cold start；
- RL；
- verifiable reward；
- group-relative optimization；
- distillation。

不要把 reasoning model 简化成 Prompt 加一句“step by step”。

## 15. Lost in the Middle

https://arxiv.org/abs/2307.03172

重点：

> Context capacity 与 information utilization 不是一回事。

## 16. RAG 学习顺序

~~~text
BM25
↓
Embedding
↓
ANN / Vector DB
↓
Hybrid Retrieval
↓
Reranker
↓
Grounded Generation
↓
RAG Eval
~~~

不要只学某个 Vector DB SDK。

## 17. 源码怎么读

不要从仓库第一行一路看。

问题驱动：

### 请求怎么进 scheduler？

搜索：

- API；
- request；
- scheduler；
- engine。

### KV block 怎么分配？

搜索：

- kv_cache；
- block；
- cache manager。

### Continuous Batching 怎么做？

搜索：

- schedule；
- waiting/running；
- token budget。

### Prefix Cache 怎么命中？

搜索：

- prefix；
- hash；
- block reuse。

## 18. 优先级

面试必须：

1. Transformer。
2. BERT vs GPT。
3. Attention / GQA。
4. Tokenizer。
5. Pretraining。
6. SFT / DPO / RLHF。
7. LoRA。
8. KV Cache。
9. Sampling。
10. RAG。
11. MoE。
12. vLLM。

中高级加分：

1. FlashAttention。
2. Paged KV。
3. Continuous Batching。
4. Prefix Cache。
5. PD Disaggregation。
6. Tensor/Expert Parallel。
7. Quantization kernels。
8. LLM Eval。
9. Agent Harness。
10. Safety / Prompt Injection。

## 19. 面对新名词的统一方法

未来看到：

~~~text
FlashMLA
EAGLE
FP4
新的 MoE Router
新的 Agent framework
~~~

统一问：

1. 它解决哪个瓶颈？
2. 改的是模型、训练、推理还是系统？
3. 基线是什么？
4. 收益从哪里来？
5. 代价是什么？

这样技术再多，也能挂回同一棵知识树。
