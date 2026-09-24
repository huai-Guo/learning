# 15｜五个最小实验：把“背过”变成“真的懂”

这些实验不追求训练真正的大模型，而是让你用几十行代码验证核心机制。

# Lab 1｜自己算 Softmax

~~~python
import math

logits = [2.0, 1.0, 0.1]

exp_values = [math.exp(x) for x in logits]
s = sum(exp_values)
probs = [x / s for x in exp_values]

print(probs)
print(sum(probs))
~~~

然后试：

~~~python
temperature = 0.5
scaled = [x / temperature for x in logits]
~~~

观察 Temperature 变小时分布是否变尖。

你应该能解释：

> Temperature 没有改变候选 token，只改变概率分布形状。

# Lab 2｜手写一个单头 Self-Attention

需要 NumPy：

~~~python
import numpy as np

X = np.array([
    [1.0, 0.0],
    [0.0, 1.0],
    [1.0, 1.0],
])

Wq = np.eye(2)
Wk = np.eye(2)
Wv = np.eye(2)

Q = X @ Wq
K = X @ Wk
V = X @ Wv

scores = Q @ K.T / np.sqrt(2)

def softmax(x):
    e = np.exp(x - np.max(x, axis=-1, keepdims=True))
    return e / e.sum(axis=-1, keepdims=True)

weights = softmax(scores)
output = weights @ V

print("scores:")
print(scores)
print("attention weights:")
print(weights)
print("output:")
print(output)
~~~

重点不是数字。

你必须指出：

~~~text
QK^T
= 谁和谁相关

Softmax
= 相关性转权重

×V
= 真正把信息取回来
~~~

# Lab 3｜Causal Mask

在上一个实验中加入：

~~~python
mask = np.triu(np.ones_like(scores), k=1)
masked_scores = np.where(mask == 1, -1e9, scores)
weights = softmax(masked_scores)
~~~

打印 weights。

检查：

> 第 1 个 token 是否无法注意未来 token？

这就是 Decoder 的因果注意力核心。

# Lab 4｜理解 KV Cache 到底省了什么

不必真的跑 Transformer，先做计算次数思想实验。

假设已经生成 5 个 token。

没有 Cache：

~~~text
Step 1: 计算 1 个历史位置
Step 2: 计算 2 个
Step 3: 计算 3 个
Step 4: 计算 4 个
Step 5: 计算 5 个
~~~

重复计算历史 K/V。

有 Cache：

~~~text
Step 1: 新算 token1 的 K/V
Step 2: 只新算 token2 的 K/V
Step 3: 只新算 token3 的 K/V
...
~~~

你仍然要：

> Q_new 和全部历史 K 做 Attention。

所以 KV Cache 是减少“历史 K/V 投影重算”，不是让 Attention 完全不看历史。

这是面试常见误区。

# Lab 5｜做一个最小 RAG

伪代码：

~~~python
documents = [
    "公司年假是 15 天。",
    "报销需要直属经理审批。",
    "生产数据库禁止个人账号直接访问。",
]

query = "年假多少天？"

# 真正项目这里是 embedding/BM25
retrieved = [documents[0]]

context = "\n".join(retrieved)

prompt = f"""
只根据下面资料回答。

资料：
{context}

问题：
{query}
"""
~~~

然后思考三种失败：

1. Retriever 没找到年假文档。
2. 找到了，但 Context Builder 截断了。
3. LLM 看到了正确文档仍回答错。

这三个问题的修复位置完全不同。

# Bonus｜显存计算

写一个函数：

~~~python
def weight_memory_gb(params_billion, bits):
    total_bits = params_billion * 1e9 * bits
    return total_bits / 8 / 1024**3

for bits in [16, 8, 4]:
    print(bits, weight_memory_gb(7, bits))
~~~

然后回答：

> 为什么输出值仍不能代表真实 Serving 显存？

因为还缺：

- KV Cache；
- runtime buffers；
- quantization scales；
- CUDA workspace；
- fragmentation。

# 实验完成标准

不是运行成功就结束。

每个实验都要做到：

1. 不看代码复述输入/输出。
2. 解释为什么这样设计。
3. 修改一个参数预测结果。
4. 能联系回真实 LLM。

如果做到这一点，再去看 PyTorch/Transformers 源码就不会完全迷路。
