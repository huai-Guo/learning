# 07｜MoE 与现代大模型结构：为什么 DeepSeek、Qwen 要用专家模型

## 1. Dense Model 是什么

普通 Dense Transformer 的 FFN：

~~~text
每一个 token
   ↓
同一套 FFN 参数
   ↓
输出
~~~

如果模型有 70B 参数，推理时大量参数都会参与每个 token 的计算。

优点：结构简单，训练和部署相对直接。

缺点：参数规模增长通常伴随每 token 计算量增长。

## 2. MoE 的核心想法

MoE = Mixture of Experts。

把一个大 FFN 换成多个 Expert：

~~~text
Token
  ↓
Router
  ↓
选择 Top-K Experts
  ↓
Expert 3 + Expert 17
  ↓
加权合并
~~~

关键：

> 总参数可以非常大，但一个 token 只激活其中少量专家。

这就是 Total Parameters 和 Activated Parameters 要分开的原因。

## 3. 为什么 MoE 有吸引力

~~~text
Dense:
总参数 70B
每个 token 大量参数参与计算

MoE:
总参数 200B+
每 token 只激活其中较小子集
~~~

目标是：

> 更大的模型容量，而不让每 token FLOPs 按总参数同比增长。

但 MoE 不是免费午餐。

## 4. Router 怎么选专家

每个 token 的 hidden state 输入 router：

~~~text
h
 ↓
router linear
 ↓
expert logits
 ↓
routing score
 ↓
Top-K experts
~~~

例如：

~~~text
E1  0.01
E2  0.08
E3  0.62  ← selected
E4  0.03
E5  0.26  ← selected
~~~

最终把被选专家输出按权重聚合。

## 5. Expert 是否等于人工领域专家

不要简单理解成：

> Expert 1 专门数学，Expert 2 专门英语。

训练后确实可能出现某些专业化，但 routing 空间通常比人工标签更复杂。

更准确：

> 多专家增加条件化参数容量，Router 学习把不同 token 表示送到合适的参数子空间。

## 6. 最大问题：负载不均衡

如果 Router 总选 Expert 7：

~~~text
E7: 爆满
E1: 很闲
E2: 很闲
...
~~~

后果：

- 某些 GPU 成为瓶颈；
- 专家训练不均；
- 通信恶化；
- 可能触发容量限制。

因此需要 load balancing。

## 7. Load Balancing

常见思路：

- auxiliary balancing loss；
- expert capacity；
- router regularization；
- routing bias；
- 动态均衡。

DeepSeek-V3 技术报告特别强调 auxiliary-loss-free load balancing。

## 8. Expert Parallelism

专家太多，一张 GPU 放不下：

~~~text
GPU0: Expert 0,1
GPU1: Expert 2,3
GPU2: Expert 4,5
GPU3: Expert 6,7
~~~

Token routing 后需要跨 GPU dispatch / combine，通常涉及 All-to-All communication。

所以 MoE 性能瓶颈不只 GEMM，还包括网络。

## 9. Shared Experts

一些架构增加 Shared Expert：

~~~text
Token
├─ 一定经过 Shared Expert
└─ 再经过 Routed Experts
~~~

思路：

- Shared Expert 学通用模式；
- Routed Experts 提供条件化容量。

## 10. DeepSeek-V3 为什么值得看

DeepSeek-V3 技术报告公开的代表性设计包括：

- 671B total parameters；
- 每个 token 约 37B activated parameters；
- DeepSeekMoE；
- Multi-head Latent Attention（MLA）；
- auxiliary-loss-free load balancing；
- Multi-Token Prediction。

面试重点不在背数字，而是理解：

> 它在同时优化模型容量、训练成本、推理 KV 开销和 MoE 负载均衡。

## 11. MLA 是什么方向

标准 Attention 要缓存 K/V。

MLA 的重要目标之一：

> 用低维 latent representation 压缩与 K/V 相关的信息，降低推理 KV Cache 成本。

和 GQA 的共同目标：

> 历史 KV 太贵，怎么减少？

但方式不同：

- GQA：减少 KV heads。
- MLA：做潜变量/低秩压缩设计。

## 12. Multi-Token Prediction

传统：

~~~text
当前上下文
→ 预测下一个 token
~~~

MTP：

> 训练时增加对多个未来 token 的预测目标。

潜在价值：

- 增加训练信号；
- 改善表示；
- 可和 speculative decoding 类思路形成联系。

## 13. Qwen 的 MoE

Qwen3 系列同时有 Dense 和 MoE。

例如 235B-A22B 一类命名可以帮助理解：

- Total parameters 很大；
- Activated parameters 较小。

它体现的仍然是 MoE 核心：

> 做大容量，不让每 token 激活全部参数。

## 14. Dense vs MoE 怎么选

Dense 更适合：

- 模型规模较小；
- 单机/少卡；
- 工程简单优先；
- 通信成本敏感。

MoE 更适合：

- 追求超大总容量；
- 有高速互联；
- 有成熟 expert parallel；
- serving kernel 支持好。

## 15. 高频追问

### MoE 为什么参数大但计算不同比增加？

每个 token 只激活 Top-K Experts。

### MoE 难部署在哪里？

Router balance、Expert placement、All-to-All、显存分布、网络和 kernel。

### GQA、MLA、MoE 是同一维度吗？

不是：

- GQA / MLA：主要优化 Attention/KV。
- MoE：主要改变 FFN 参数激活方式。

下一章：[部署与推理系统](08-serving-deployment.md)
