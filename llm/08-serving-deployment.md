# 08｜部署与推理系统：vLLM、SGLang、TGI、llama.cpp 怎么选

线上真正关心：

- QPS；
- TTFT；
- TPOT；
- tokens/s；
- 并发；
- 显存；
- 稳定性；
- 批处理；
- 缓存；
- 多卡；
- 成本。

## 1. 最简单部署链路

~~~text
Client
  ↓ HTTP
API Server
  ↓
Tokenizer
  ↓
Inference Engine
  ↓
GPU
  ↓
Token Stream
  ↓
Client
~~~

高并发还会有：

~~~text
Load Balancer
  ↓
Gateway
  ↓
Request Queue
  ↓
Scheduler
  ↓
Model Workers
  ↓
GPU Cluster
~~~

## 2. 为什么直接 model.generate 不够

本地 demo 很方便，但线上多用户还需要：

- dynamic batching；
- request scheduling；
- KV Cache 分配；
- streaming；
- cancellation；
- prefix reuse；
- distributed inference；
- metrics / tracing。

## 3. vLLM 核心记忆点

重点：

- paged KV cache / PagedAttention 思路；
- continuous batching；
- prefix caching；
- chunked prefill；
- quantization；
- tensor / pipeline / data / expert parallel；
- speculative decoding；
- 高吞吐 serving。

不要只背：

> vLLM 快，因为 PagedAttention。

更完整：

> serving 性能来自内存管理、调度、batching、kernel 和 distributed execution 的组合。

## 4. SGLang 核心记忆点

重点包括：

- 高性能 runtime；
- cache-aware / prefix reuse；
- structured generation；
- continuous batching；
- 分布式推理；
- Prefill-Decode Disaggregation；
- 大型 MoE serving 优化。

## 5. PD Disaggregation

Prefill 偏计算密集，Decode 偏内存/带宽。

统一 scheduler 中，超长 Prefill 可能干扰 Decode，造成 TPOT 抖动。

PD 分离：

~~~text
Prefill Workers
      │
      ├── KV transfer
      ▼
Decode Workers
~~~

优点：

- 两阶段独立扩容；
- 分别优化硬件与调度；
- 减少互相干扰。

代价：

- KV 传输；
- 网络；
- 编排复杂度。

## 6. TGI

Hugging Face Text Generation Inference 提供：

- launcher；
- router；
- tensor parallel；
- continuous batching；
- streaming；
- attention 优化；
- quantization；
- metrics/tracing；
- structured generation。

如果团队 Hugging Face 生态很重，TGI 的集成路径自然。

## 7. llama.cpp

核心方向：

> 低依赖、跨硬件、高效运行量化模型。

特点：

- C/C++；
- GGUF；
- CPU；
- Apple Silicon / Metal；
- CUDA；
- Vulkan；
- 低比特量化；
- CPU+GPU 混合 offload。

典型：

- 桌面；
- Mac；
- 边缘设备；
- CPU；
- 本地开发。

## 8. 四者如何选

| 场景 | 候选 |
|---|---|
| GPU 高吞吐 API | vLLM / SGLang |
| 大规模 MoE、复杂调度、PD 分离 | SGLang / vLLM，按模型实测 |
| Hugging Face 生产生态 | TGI |
| CPU / Mac / Edge / GGUF | llama.cpp |

不要说某框架永远最快。

正确说法：

> 性能依赖模型、GPU、量化、context、batch、并发和具体版本，要用目标 workload benchmark。

## 9. Tensor Parallelism

~~~text
Weight Matrix
├─ GPU0
├─ GPU1
├─ GPU2
└─ GPU3
~~~

单层矩阵跨多 GPU。

优点：大层能跨卡。

缺点：层内高频通信，对高速互联敏感。

## 10. Pipeline Parallelism

~~~text
GPU0: layers 0-19
 ↓
GPU1: layers 20-39
 ↓
GPU2: layers 40-59
~~~

要处理 pipeline bubble、microbatch 调度。

## 11. Expert Parallelism

MoE Experts 分布在不同 GPU，Token 需要 All-to-All 发到对应 Expert。

因此要考虑：

- expert placement；
- load balance；
- EP + TP + DP；
- network bandwidth。

## 12. 推理显存组成

~~~text
Model Weights
+ KV Cache
+ Activations / temp buffers
+ CUDA graph / workspace
+ runtime overhead
~~~

所以：

> 70B INT4 约 35GB，不代表 40GB GPU 一定稳跑。

还要给 KV 和 runtime 留空间。

## 13. 并发为什么吃 KV

每个 active request 都有自己的历史 KV。

~~~text
A: 8K context
B: 32K context
C: 4K context
~~~

并发越高，总 KV 越大。

Scheduler 要做 admission / preemption / token budget 管理。

## 14. Throughput vs Latency

大 batch：

- GPU 利用率高；
- throughput 高；
- 请求可能排队更久。

小 batch：

- 单请求快；
- GPU 不够饱。

所以先定义 SLA：

~~~text
TTFT P95
TPOT P95
QPS
tokens/s
cost/request
~~~

## 15. Prefix Cache

企业请求常共享：

- system prompt；
- safety rules；
- tool schema。

缓存共同 prefix 的 KV 可以跳过重复 Prefill。

多租户还要考虑：

- cache isolation；
- 隐私；
- hash collision；
- timing side channel。

## 16. Streaming

常见传输：

- SSE；
- WebSocket；
- HTTP chunk。

Streaming 不一定降低总生成耗时，但显著降低用户感知延迟。

## 17. safetensors 与 GGUF

### safetensors

训练/GPU/Hugging Face 生态常见。

### GGUF

llama.cpp 生态常见，便于量化和本地运行。

它们是权重存储/元数据格式，不是模型架构。

## 18. 面试：如何部署一个 70B 模型

不要只答“vLLM”。

应该先说明：

1. precision / quantization；
2. GPU 型号和显存；
3. max context；
4. 峰值并发；
5. TTFT/TPOT SLA；
6. 是否 TP；
7. KV Cache 预算；
8. batching；
9. prefix cache；
10. autoscaling；
11. streaming；
12. observability。

这才是工程答案。

下一章：[评测、幻觉与安全](09-evaluation-hallucination.md)
