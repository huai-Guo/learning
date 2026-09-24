# 00｜计算机小白必须补的数学与深度学习基础

很多人直接背 Transformer，面试官一追问“QK 为什么点积、Softmax 是什么、Loss 怎么更新参数”，就断了。这里补最小必要基础。

## 1. 标量、向量、矩阵、张量

~~~text
标量 scalar
3.14

向量 vector
[0.2, 1.7, -0.4]

矩阵 matrix
[
  [1, 2, 3],
  [4, 5, 6]
]

张量 tensor
更高维数组
~~~

LLM 里几乎所有东西最后都是 Tensor。

如果 100 个 token，每个 hidden size 是 4096，那么一层表示可看成：

~~~text
X.shape = [100, 4096]
~~~

## 2. 为什么神经网络到处都是矩阵乘法

最简单的一层：

~~~text
y = xW + b
~~~

W 可以理解成一组可学习的转换规则。训练模型，本质就是不停调整这些矩阵里的数字。

## 3. 点积为什么能表示相关性

两个方向相近的向量，点积通常较大。

~~~text
a = [1, 0]
b = [0.9, 0.1]
c = [-1, 0]

a · b = 0.9
a · c = -1
~~~

Attention 里的 Q·K，就是在计算“这个 Query 和那个 Key 有多匹配”。

## 4. Softmax

模型原始分数叫 logits：

~~~text
北京  8.2
上海  5.1
香蕉  0.4
~~~

Softmax 把它们转成和为 1 的概率分布：

~~~text
北京  0.956
上海  0.043
香蕉  0.001
~~~

作用：

> 把任意实数分数变成可比较的概率，并保持可微。

## 5. Loss

训练样例：

~~~text
输入：中国的首都是
正确答案：北京
~~~

模型如果只给“北京”0.2 的概率，Loss 就比较高。语言模型最常见的是交叉熵损失。

正确 token 概率越高，Loss 越小。

## 6. Forward、Backprop、Optimizer

~~~mermaid
flowchart LR
    A[输入] --> B[Forward]
    B --> C[预测]
    C --> D[Loss]
    D --> E[Backprop]
    E --> F[Gradient]
    F --> G[Optimizer]
    G --> H[更新参数]
    H --> B
~~~

反向传播回答：

> 每一个参数如果稍微变化，Loss 会怎样变化？

这个方向就是 gradient。

最直觉的更新：

~~~text
parameter = parameter - learning_rate × gradient
~~~

真实 LLM 常用 AdamW 等优化器。

## 7. Learning Rate

太大：震荡、发散、loss spike。

太小：收敛非常慢。

训练通常有 warmup、峰值学习率、decay。

## 8. Embedding

Token ID 只是编号：

~~~text
北京 -> 8231
上海 -> 5127
~~~

8231 本身没有语义。

Embedding Table：

~~~text
vocab_size × hidden_size
~~~

查表后才得到向量：

~~~text
北京 -> [0.12, -0.43, ...]
上海 -> [0.15, -0.40, ...]
~~~

## 9. 激活函数

如果全是线性层，很多层叠起来仍可合成一个线性变换。

所以 FFN 里要有非线性：

- ReLU
- GELU
- SiLU
- SwiGLU

现代 LLM 常见 SwiGLU 类结构。

可以先记：

> Attention 负责“从哪里取信息”，FFN 负责“对当前位置的信息做非线性加工”。

## 10. Residual Connection

如果每层直接彻底改写输入，深层网络很难训练。

Residual：

~~~text
output = x + F(x)
~~~

让信息有一条“高速公路”跨过子层，有助于深层优化。

## 11. LayerNorm / RMSNorm

深层网络中激活尺度容易不稳定。

Normalization 用于稳定表示尺度和优化过程。

现代 Decoder-only LLM 经常使用 RMSNorm，并使用 Pre-Norm：

~~~text
x
├─ Norm → Attention → +
│                    ↑
└────────────────────┘
~~~

RMSNorm 不减均值，计算相对简单。

## 12. FP32 / FP16 / BF16 / FP8

| 格式 | 每元素大致字节 | 直觉 |
|---|---:|---|
| FP32 | 4 | 精度高、显存大 |
| FP16 | 2 | 省显存，但动态范围较窄 |
| BF16 | 2 | 动态范围接近 FP32，常用于训练 |
| FP8 | 1 | 更省、更快，但依赖硬件和数值策略 |

大模型训练常使用 mixed precision。

## 13. 最粗的模型权重显存估算

~~~text
memory ≈ parameter_count × bytes_per_parameter
~~~

7B：

~~~text
BF16/FP16 ≈ 7B × 2 = 14 GB
INT8      ≈ 7 GB + metadata
INT4      ≈ 3.5 GB + metadata
~~~

但推理还要 KV Cache、临时 buffer；训练还要梯度、optimizer state、activation。

所以“模型权重能放进显卡”不等于“能训练”。

## 14. 面试自测

### Q：为什么 Attention 用点积？

Query 和 Key 都是向量，点积提供高效可并行的匹配分数。缩放并 Softmax 后形成注意力权重。

### Q：训练神经网络到底更新什么？

更新参数张量里的数值，不是在修改程序控制流。

### Q：为什么需要非线性激活？

没有非线性，多层线性变换仍可合并成一个线性变换，表达能力受限。

下一章：[Transformer、BERT 与 GPT](01-transformer-bert-gpt.md)
