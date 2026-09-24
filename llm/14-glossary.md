# 14｜LLM 面试术语字典：小白遇到陌生词先查这里

这份不是百科全书，只收录前面章节里高频出现、面试经常默认你懂的词。

## 模型与训练

### Parameter 参数

模型中可学习的数值，例如矩阵 W 里的元素。

“7B 模型”通常表示大约 70 亿参数。

### Hidden Size

每个 token 在 Transformer 中间层向量的维度。

例如 hidden_size=4096。

### Layer

Transformer Block 重复堆叠的一层。

### Head

Multi-Head Attention 中一个独立注意力子空间。

### Vocabulary

Tokenizer 可输出的 token 集合大小。

### Token

模型处理文本的最小离散单元之一，不等同于汉字，也不等同于英文单词。

### Embedding

把离散 token ID 映射成连续向量。

### Logits

模型在 Softmax 之前对每个候选类别/token 的原始分数。

### Probability

Logits 经 Softmax 等变换后得到的概率分布。

### Loss

衡量预测和训练目标差距的标量。

### Gradient

Loss 对参数的导数/变化方向，用于告诉 optimizer 参数该往哪里更新。

### Backpropagation

从 Loss 反向计算各参数 Gradient 的算法过程。

### Optimizer

根据 Gradient 更新参数，例如 AdamW。

### Learning Rate

每次更新参数的步长。

### Batch

一次并行送进模型训练/推理的一组样本。

### Epoch

完整遍历一遍训练数据。超大规模预训练不一定习惯用“跑多少 epoch”来描述，常看 token/step。

### Step

一次 optimizer update 或训练迭代。

### Checkpoint

训练中保存的模型状态，可用于恢复训练、评测或部署。

### Base Model

预训练完成但尚未充分做 instruction alignment 的模型。

### Instruct / Chat Model

在 Base Model 上经过 SFT、Preference/RL 等后训练，面向对话和指令。

## 推理与系统

### Inference

模型参数不再训练，使用模型做预测/生成。

### Serving

把 Inference 包成可供多个用户调用的长期在线服务。

### Latency

一次请求花多长时间。

### Throughput

单位时间系统处理多少请求或 token。

### QPS

Queries Per Second，每秒请求数。

### TTFT

Time To First Token，用户等待首 token 的时间。

### TPOT

Time Per Output Token，开始输出后每个 token 的平均生成耗时。

### P50 / P95 / P99

延迟百分位。

P99=2s 表示约 99% 请求在 2 秒内完成/达到对应指标。

### OOM

Out Of Memory，显存或内存不足。

### KV Cache

缓存历史 token 的 Key/Value，避免自回归 Decode 时重复计算。

### Prefix Cache

跨请求复用相同前缀产生的 KV。

### Prefill

处理完整输入 Prompt 的阶段。

### Decode

每次追加新 token 的自回归生成阶段。

## GPU 与硬件

### GPU

适合大规模并行矩阵计算的处理器。

### VRAM / GPU Memory

显卡显存。

### HBM

High Bandwidth Memory，高带宽 GPU 显存。容量大、带宽高，但比芯片片上 SRAM 远。

### SRAM / Shared Memory

GPU 芯片上更快、更小的存储层级。FlashAttention 的关键是减少 HBM 与片上存储之间的数据搬运。

### CUDA

NVIDIA GPU 编程平台和生态。

### Kernel

运行在 GPU 上执行某种计算的底层函数，例如 GEMM kernel、Attention kernel。

它和操作系统 kernel 不是同一个语境。

### GEMM

General Matrix Multiplication，大规模矩阵乘法。Transformer 绝大多数 FLOPs 来自矩阵乘法。

### FLOPs

浮点运算次数，用于描述理论计算量。

### Memory Bandwidth

单位时间能从显存搬多少数据。

Decode 很容易受带宽限制。

### NCCL

NVIDIA Collective Communications Library，常用于多 GPU AllReduce、AllGather、All-to-All 等通信。

### NVLink

GPU 之间的高速互联之一，通常比普通 PCIe 更适合高频跨卡通信。

## 分布式

### Data Parallel

模型复制多份，不同 GPU 处理不同数据，再同步梯度/状态。

### Tensor Parallel

把同一层大矩阵拆到多张 GPU。

### Pipeline Parallel

不同模型层放不同 GPU。

### Expert Parallel

MoE 不同 Expert 放不同 GPU。

### AllReduce

多个 GPU 聚合集体数据并把结果发回各参与者，梯度同步常用。

### All-to-All

每个节点可能给所有其他节点发送不同数据，MoE Token dispatch 常见。

## RAG / Agent

### Embedding Model

把文本映射成向量，用于语义检索。

### Vector DB / ANN Index

存储和快速近似搜索高维向量。

### BM25

经典关键词检索算法。

### Reranker

对 Retriever 找到的少量候选进一步精排。

### Groundedness

回答是否真正被提供的证据支持。

### Tool Calling

模型输出结构化工具调用意图，由 Host 真正执行。

### Agent

模型 + 状态 + 工具 + 循环 + 策略组成的任务系统。

### Harness

包住模型的运行框架，包括 Prompt、Tools、Agent Loop、上下文管理、权限和执行环境。

### Sandbox

隔离 Agent/代码执行的环境，限制文件、网络、进程和资源。

### MCP

用于连接 Host/Agent 与外部工具/资源的一类标准化协议。

## 训练后处理

### SFT

Supervised Fine-Tuning，监督指令微调。

### RLHF

Reinforcement Learning from Human Feedback，从人类偏好构造 reward 后强化学习。

### DPO

Direct Preference Optimization，直接用 chosen/rejected 偏好对优化模型。

### PPO

一种强化学习策略优化算法，经典 RLHF 常使用。

### GRPO

通过同一问题多样本的组内相对 reward 构造优化信号的一类方法。

### Distillation

用强 Teacher 生成数据/分布，让 Student 学习。

### Rejection Sampling

生成多个候选，筛好样本留下。

## 模型结构

### Dense

每个 token 经过相同的 Dense FFN 参数。

### MoE

Router 为 token 选择少量 Experts。

### Router

MoE 中决定 token 去哪些 Experts 的模块。

### Activated Parameters

一个 token 真正参与计算的参数量。MoE 中通常远小于 Total Parameters。

### MHA / MQA / GQA

不同 Q/K/V head 共享策略。

### MLA

通过 latent compression 等设计降低 Attention/KV 成本的结构方向，DeepSeek 系列具有代表性。

### RoPE

旋转位置编码，对 Q/K 根据位置做旋转。

## 常见文件/格式

### safetensors

面向安全和高效读取的模型 Tensor 文件格式。

### GGUF

ggml/llama.cpp 生态常见模型格式，包含权重和元数据，适合本地量化推理。

---

遇到术语先判断它属于哪一层：

~~~text
模型结构？
训练？
后训练？
推理？
GPU 系统？
RAG？
Agent？
评测？
~~~

归类以后就不会把 FlashAttention、GQA、PagedAttention、vLLM 混成同一种东西。
