# 02｜预训练：LLM 怎么从随机参数练出来

## 1. 完整流水线

~~~mermaid
flowchart LR
    A[原始网页/书籍/代码] --> B[清洗]
    B --> C[去重]
    C --> D[质量过滤]
    D --> E[Tokenizer]
    E --> F[Token 序列]
    F --> G[Packing / Batch]
    G --> H[Forward]
    H --> I[Next Token Loss]
    I --> J[Backprop]
    J --> K[Optimizer]
    K --> H
~~~

预训练结束得到 Base Model。

## 2. 数据工程

真实训练数据通常处理：

- HTML / boilerplate；
- 语言识别；
- 低质量内容；
- spam；
- 完全重复与近重复；
- benchmark contamination；
- 代码来源与许可证；
- 不同领域数据配比。

去重非常重要：

- 避免浪费算力；
- 降低死记硬背；
- 减少 benchmark 泄漏；
- 防止数据分布被高频重复内容扭曲。

## 3. Tokenizer

模型不直接吃“字符串”，而是 token ID。

例如：

~~~text
unbelievable
→ un / believ / able
→ 421 / 9821 / 731
~~~

常见路线：

- BPE；
- Byte-level BPE；
- WordPiece；
- Unigram；
- SentencePiece 工具链。

## 4. Vocabulary 大小怎么权衡

词表太小：

- 一个常用词被切很多 token；
- sequence 更长；
- 推理成本更高。

词表太大：

- embedding 和 LM head 更大；
- 稀有 token 学习不充分；
- 参数和训练成本增加。

多语言、中文、代码都会影响 tokenizer 选择。

## 5. Next Token Prediction

文本：

~~~text
中国 的 首都 是 北京
~~~

可产生多个监督位置：

~~~text
中国             → 的
中国 的          → 首都
中国 的 首都     → 是
中国 的 首都 是  → 北京
~~~

答案本来就在文本里，所以这是自监督学习。

## 6. 为什么预测下一个 token 能学到知识

要正确补：

~~~text
爱因斯坦提出了____
~~~

模型必须形成关于人物、物理和语言模式的表示。

要补：

~~~text
def add(a, b):
    return
~~~

模型要学 Python 的语法和代码模式。

训练目标简单，但为了降 Loss，模型被迫学习大量潜在结构。

## 7. Base Model vs Chat Model

Base Model 更像极强的文本续写器。

Chat Model 是在 Base Model 上后训练，学会：

- 对话模板；
- instruction following；
- 偏好；
- 安全；
- 工具调用；
- reasoning 策略。

不要把预训练和 SFT 混为一谈。

## 8. Scaling Law

Scaling Law 研究模型规模、数据量、计算量与损失/能力之间的规律。

关键不是“参数越大越好”，而是三者匹配：

~~~text
Parameters
Data
Compute
~~~

参数巨大但数据不足会 under-train；数据巨大但模型太小也难充分吸收。

## 9. 涌现能力

常用来描述规模增大后某些能力看起来突然显著出现。

但要谨慎：

- 离散指标会制造“跳变”；
- 连续指标下可能更平滑；
- prompt 与 evaluation 影响结论。

面试不要说“超过某个参数量就突然产生意识”。

更准确：

> 随模型规模、数据和训练质量提升，一些复杂任务会出现非线性增益，但“涌现”的测量方式本身仍有讨论。

## 10. 为什么预训练贵

主要成本：

- Attention；
- FFN 大矩阵乘法；
- forward + backward；
- optimizer；
- 海量 token；
- GPU 间通信。

## 11. 分布式训练四个核心概念

### Data Parallel

每张 GPU 有模型副本，吃不同 batch，最后同步梯度。

### Tensor Parallel

一层中的大矩阵切到多张 GPU。

### Pipeline Parallel

不同层放不同 GPU，形成流水线。

### ZeRO / FSDP

把参数、梯度、optimizer state 分片，减少每卡重复存储。

## 12. 为什么训练显存远大于权重

7B BF16 权重约：

~~~text
7B × 2 bytes ≈ 14 GB
~~~

训练还需要：

- gradient；
- master weights 或高精度状态；
- Adam 一阶矩；
- Adam 二阶矩；
- activations。

所以 24GB 显卡能加载 7B，不代表能全参数训练 7B。

## 13. Gradient Checkpointing

少保存部分 activation，反向时重新计算。

本质：

> 用更多计算换更少显存。

## 14. Packing

若 max sequence length 是 4096，但每条样本只有 300 token，单条占满一个 slot 很浪费。

Packing 把多条短样本拼起来提高 token 利用率。

要正确处理：

- attention mask；
- position；
- sample boundary。

## 15. 面试追问

### 为什么不直接用问答数据训练？

人工高质量问答规模有限，原始文本规模巨大。预训练先学通用能力，再用少量高质量数据做后训练更经济。

### Loss 降低一定代表模型更好吗？

不一定，还要看 validation、downstream benchmark、污染、alignment、真实业务任务。

### loss spike 可能是什么？

数据异常、学习率、数值精度、optimizer、分布式通信或极端 batch 都可能造成。

下一章：[后训练](03-post-training.md)
