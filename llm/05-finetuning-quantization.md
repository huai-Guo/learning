# 05｜微调与量化：Full FT、LoRA、QLoRA、INT8/INT4、AWQ、GPTQ

## 1. 先判断：真的需要 Fine-Tuning 吗

如果问题是：

> “模型缺最新知识。”

通常先考虑 RAG。

如果问题是：

- 要改变输出风格；
- 要固定行为；
- 要学领域任务；
- 要强化分类/抽取；
- 要学工具调用协议；
- 要让模型适配特定数据分布；

Fine-Tuning 更合理。

## 2. Full Fine-Tuning

更新所有参数。

优点：

- 适配能力上限高；
- 可以深度改变模型行为。

缺点：

- 显存大；
- 训练成本高；
- 每个业务版本维护完整模型；
- 容易过拟合或灾难性遗忘。

## 3. PEFT

Parameter-Efficient Fine-Tuning：

> 冻结大部分 Base Model，只训练少量新增参数。

常见：

- LoRA；
- Adapter；
- Prefix Tuning；
- Prompt Tuning；
- IA3。

最常见面试重点是 LoRA。

## 4. LoRA 原理

原本要更新：

~~~text
W
~~~

LoRA 冻结 W，只训练低秩增量：

~~~text
ΔW = B A
~~~

其中 rank r 很小。

最终：

~~~text
W' = W + scale × BA
~~~

核心假设：

> 下游任务所需的权重变化常可以被低秩矩阵近似。

## 5. LoRA 不只是减少参数量

这是截图第 9 题的重点。

LoRA 还有：

1. optimizer state 更少；
2. gradient 更少；
3. 显存更低；
4. 训练速度和成本更友好；
5. 一个 Base Model 可挂多个 LoRA；
6. 适合按客户/领域管理 adapter；
7. 可以在部署前 merge 到 base weights；
8. 版本切换和存储成本更低。

## 6. LoRA 插在哪里

常见目标：

- q_proj；
- k_proj；
- v_proj；
- o_proj；
- up_proj；
- down_proj；
- gate_proj。

只插 Q/V 是早期常见做法，现代任务常根据效果扩展到 Attention + FFN。

## 7. rank 越大越好吗

不是。

r 越大：

- 容量更强；
- 参数更多；
- 显存更多；
- 过拟合风险增加；
- 收益可能递减。

应该由 eval 选择。

## 8. QLoRA

QLoRA：

> 把 Base Model 以低比特量化形式加载，在此基础上训练 LoRA adapter。

目的是让大模型微调显存进一步下降。

不要说成“LoRA 参数本身 4bit 就叫 QLoRA”。

## 9. 量化是什么

把高精度权重/激活映射到更低 bit：

~~~text
FP16/BF16
→ INT8
→ INT4
→ FP8 / FP4 等
~~~

收益：

- 模型更小；
- 显存更少；
- 内存带宽压力更低；
- 支持更高并发。

代价：

- 量化误差；
- kernel 限制；
- 某些任务质量下降。

## 10. 量化不是简单四舍五入

原值：

~~~text
[-1.82, -0.53, 0.12, 1.77]
~~~

要映射到有限整数区间，需要：

- scale；
- zero-point（部分方案）；
- group；
- clipping；
- calibration。

反量化后的值不会完全等于原值。

## 11. Per-Tensor / Per-Channel / Group-wise

### Per-Tensor

整个 tensor 共用一个 scale。

实现简单，误差较大。

### Per-Channel

不同 channel 独立 scale，精度更细。

### Group-wise

每一小组权重共用 scale。

LLM INT4 常见。

group 越小往往越精细，但 metadata 和 kernel 成本增加。

## 12. Weight-only / W8A8

### Weight-only

权重量化，activation 保持较高精度。

部署简单，LLM 很常见。

### W8A8

Weight 8bit + Activation 8bit。

理论上计算和带宽收益更大，但 activation 的动态范围更难处理。

## 13. PTQ vs QAT

PTQ：

> 模型训练完以后再量化。

成本低。

QAT：

> 训练时模拟量化误差，让模型适应低精度。

通常质量更稳，但训练复杂。

## 14. GPTQ

GPTQ 是一种典型 weight-only PTQ 路线。

核心目标：

> 量化时尽量减少权重变化对层输出造成的重构误差。

常见于 GPU 低比特部署。

## 15. AWQ

AWQ = Activation-aware Weight Quantization。

核心观察：

> 少量对 activation 影响特别大的权重更敏感。

利用 activation statistics 做缩放与保护，以降低低比特量化损失。

## 16. INT8 / INT4 / AWQ / GPTQ 怎么选

不要把它们放在完全同一层级：

- INT8 / INT4：数值精度。
- AWQ / GPTQ：具体量化算法/方案。

选型先看：

- GPU/CPU；
- serving framework；
- kernel；
- 模型是否已有高质量量化权重；
- 质量容忍度；
- 显存；
- batch/QPS；
- latency。

## 17. KV Cache 也能量化

长上下文、大 batch 时，KV Cache 很大。

可以使用低精度 KV Cache，进一步降低显存。

但要验证：

- accuracy；
- kernel 支持；
- 模型兼容。

## 18. Fine-Tuning vs RAG

| | Fine-Tuning | RAG |
|---|---|---|
| 新知识更新 | 慢 | 快 |
| 私有实时数据 | 一般 | 强 |
| 改行为/风格 | 强 | 弱 |
| 可引用来源 | 弱 | 强 |
| 训练成本 | 有 | 少/无 |
| 推理额外检索 | 无 | 有 |

实际产品经常二者结合。

下一章：[RAG 与 Agent](06-rag-agent.md)
