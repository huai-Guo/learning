# 01｜Transformer、BERT、GPT：Encoder / Decoder 一次打通

## 1. Transformer 解决了什么

RNN/LSTM 主要按顺序处理：

~~~text
我 → 爱 → 北 → 京
~~~

难并行，长距离依赖路径也长。

Transformer 用 Self-Attention 让 token 直接关注其他 token，大部分训练计算可以并行。

## 2. Self-Attention 直觉

~~~text
小明把苹果给了小红，因为她饿了
~~~

处理“她”时，需要判断更应该关注“小明”“苹果”还是“小红”。

Self-Attention：

~~~text
当前 token
   ↓
对其他 token 打相关性分数
   ↓
Softmax
   ↓
加权汇总 Value
~~~

## 3. Q、K、V

输入 X 经过三套可学习矩阵：

~~~text
Q = XWq
K = XWk
V = XWv
~~~

直觉：

- Query：我在找什么。
- Key：我有什么标签供别人匹配。
- Value：真正被取走的信息。

核心公式：

~~~text
Attention(Q,K,V)
= softmax(QK^T / sqrt(d_k)) V
~~~

## 4. 为什么除 sqrt(d_k)

维度越高，随机向量点积的方差会变大，Softmax 输入容易过尖。

缩放后训练更稳定。

## 5. Multi-Head Attention

单头只有一种注意力空间。

多头可以让不同 head 学不同关系：

- 指代；
- 语法；
- 局部搭配；
- 长距离依赖。

~~~text
Input
 ├─ Head 1
 ├─ Head 2
 ├─ Head 3
 └─ Head N
      ↓
    Concat
      ↓
   Projection
~~~

## 6. MHA、MQA、GQA

### MHA

~~~text
Q1 ↔ K1,V1
Q2 ↔ K2,V2
Q3 ↔ K3,V3
Q4 ↔ K4,V4
~~~

每个 query head 都有对应 KV head，KV Cache 大。

### MQA

~~~text
Q1 ─┐
Q2 ─┼── K1,V1
Q3 ─┤
Q4 ─┘
~~~

所有 query heads 共用一组 KV，缓存很省，但共享过强。

### GQA

~~~text
Q1,Q2 → K1,V1
Q3,Q4 → K2,V2
~~~

在质量和 KV Cache 之间折中，是现代 LLM 常见设计。

面试关键句：

> GQA 减少 KV heads，因此显著降低 Decode 阶段 KV Cache 容量和内存带宽压力。

## 7. Encoder

Encoder 允许双向看上下文。

BERT 例子：

~~~text
我今天去 [MASK] 旅游
~~~

预测 MASK 时既能看左边也能看右边。

适合：

- 分类；
- NER；
- 语义表示；
- Embedding；
- 检索。

## 8. Decoder

Decoder 使用 Causal Mask：

~~~text
位置1 只看 1
位置2 看 1,2
位置3 看 1,2,3
...
~~~

不能偷看未来 token。

因此天然适合自回归生成。

GPT、Llama、Qwen 等通用 LLM 大量采用 Decoder-only。

## 9. BERT vs GPT

| | BERT | GPT 类 |
|---|---|---|
| 架构 | Encoder-only | Decoder-only |
| 上下文 | 双向 | 因果单向 |
| 经典目标 | Masked LM | Next Token Prediction |
| 强项 | 表征/理解 | 生成 |
| 典型输出 | hidden representation | next-token logits |

BERT：

~~~text
北京是[MASK]的首都
→ 中国
~~~

GPT：

~~~text
北京是中国的
→ 首都
~~~

## 10. Encoder-Decoder

原版 Transformer 是：

~~~text
输入
 ↓
Encoder
 ↓
语义表示
 ↓
Decoder
 ↓
输出
~~~

典型 T5、BART 等。

传统强项是翻译、摘要等 seq2seq 任务。

## 11. Decoder Block

现代 Decoder-only 模型可粗略记成：

~~~text
x
│
├─ RMSNorm
├─ Self Attention
│    ├─ Q/K/V
│    ├─ RoPE
│    ├─ GQA/MQA
│    └─ Causal Mask
├─ Residual
├─ RMSNorm
├─ FFN / SwiGLU / MoE
└─ Residual
    ↓
下一层
~~~

## 12. 位置编码为什么需要

Attention 本身不天然知道顺序：

~~~text
狗咬人
人咬狗
~~~

token 集合相似，但语义完全不同。

## 13. Sin/Cos

原版 Transformer 使用固定正弦/余弦位置编码。

优点：

- 不需要训练；
- 规律明确。

现代长上下文 LLM 中更常见 RoPE 体系。

## 14. RoPE

RoPE 不简单给 embedding 加位置向量，而是按位置旋转 Q/K。

这样 Q 和 K 的点积自然携带相对位置信息。

直觉：

~~~text
Q(position i)
K(position j)
   ↓
旋转后做点积
   ↓
结果与相对位置 i-j 有关
~~~

## 15. ALiBi

ALiBi 直接在 attention score 上加入与距离有关的 bias：

~~~text
score = QK^T + distance_bias
~~~

实现简单，有长度外推思路，但主流通用大模型更多见 RoPE 系列。

## 16. FlashAttention 和 GQA 不是一类优化

高频陷阱：

~~~text
MHA / MQA / GQA
= Attention 结构，KV heads 怎么共享

FlashAttention
= 同样的 Attention 数学结果，怎样更高效地在 GPU 上算
~~~

FlashAttention 通过 tiling 等 IO-aware 技术减少 HBM 与片上 SRAM 间读写。

不要说成“把 Attention 从 O(n²) 变成 O(n)”。经典 FlashAttention 仍计算 exact attention，核心是 IO 和内存效率。

## 17. Lost in the Middle

上下文窗口很大，不等于模型能同样好地利用任意位置的信息。

常见现象：

> 关键信息在开头或结尾容易被利用，放在中间可能表现下降。

原因可能包括：

- 注意力分散；
- 训练长度分布；
- 位置泛化；
- 噪声增加；
- 检索信号被淹没。

因此：

~~~text
更长 context ≠ 一定更好
~~~

实际系统会配合 RAG、rerank、context pruning、prompt compression。

## 18. 面试追问

### 为什么多数通用 LLM 用 Decoder-only？

- next-token 目标统一简单；
- 原始文本天然提供自监督标签；
- 生成能力直接适配 Chat、Coding、Agent；
- 规模足够后也能获得很强理解能力。

### BERT 为什么不适合像 GPT 那样长文本生成？

它的双向注意力和 Masked LM 训练目标主要优化表征理解，不是左到右自回归序列生成。

### GQA 为什么提升推理效率？

Decode 阶段大量时间花在读历史 KV，减少 KV head 数可减少缓存容量和显存带宽。

参考论文：

- Attention Is All You Need
- BERT: Pre-training of Deep Bidirectional Transformers
- FlashAttention

下一章：[预训练](02-pretraining.md)
