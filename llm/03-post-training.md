# 03｜Post-Training：SFT、RLHF、PPO、DPO、GRPO 一次串起来

## 1. 为什么 Base Model 还要后训练

预训练目标只是：

> 预测下一个 token。

但产品真正需要的是：

- 回答问题；
- 遵循指令；
- 输出固定格式；
- 会推理；
- 会调用工具；
- 符合偏好和安全要求。

因此：

~~~text
Pretraining
   ↓
Base Model
   ↓
Post-Training
   ↓
Instruct / Chat / Reasoning Model
~~~

## 2. SFT

SFT = Supervised Fine-Tuning，监督微调。

数据形态：

~~~text
User:
解释 TCP 三次握手

Assistant:
...
~~~

训练目标本质仍然可以是 next-token loss，只是数据从海量原始文本变成高质量 instruction-response。

SFT 主要教模型：

- 对话模板；
- instruction following；
- 特定领域回答；
- 工具调用格式；
- 输出风格。

## 3. SFT 的局限

如果两个回答都能完成任务：

~~~text
A：正确、直接、完整
B：正确但啰嗦、跑题
~~~

单纯 SFT 更像是在说：

> “这是一个好答案，学着生成它。”

它不天然表达“两个答案谁更好”。

于是有 preference learning。

## 4. Preference Data

典型格式：

~~~text
Prompt
├─ Chosen Answer
└─ Rejected Answer
~~~

偏好可能来自：

- 人类标注；
- AI judge；
- 单元测试；
- 规则校验；
- reward function。

## 5. 经典 RLHF

简化流程：

~~~mermaid
flowchart LR
    A[Prompt] --> B[Policy]
    B --> C[Answer]
    C --> D[Reward Model]
    D --> E[Reward]
    E --> F[PPO]
    F --> B
~~~

经典 RLHF 常见步骤：

1. SFT。
2. 收集 preference。
3. 训练 Reward Model。
4. 用 PPO 等 RL 算法继续优化 policy。

## 6. Reward Model 是什么

Reward Model 接收：

~~~text
prompt + answer
~~~

输出一个标量：

~~~text
reward = 3.7
~~~

它学习“人更喜欢什么回答”。

注意：

> Reward Model 也会有偏差。优化 reward 不等于真实世界一定更好，这叫 reward hacking / Goodhart 风险。

## 7. PPO 直觉

PPO 属于强化学习。

核心目标：

> 增大高 reward 行为的概率，同时限制策略不要一步变化太大。

LLM RLHF 里还常配合 reference model 与 KL penalty，防止模型偏离原模型过远。

PPO 工程复杂，因为可能同时涉及：

- policy model；
- reference model；
- reward model；
- value model / value head；
- rollout；
- advantage；
- 多模型显存和通信。

## 8. DPO

DPO 直接利用：

~~~text
chosen > rejected
~~~

优化模型，使：

~~~text
P(chosen) 相对上升
P(rejected) 相对下降
~~~

它避免了经典 RLHF 中显式 Reward Model + PPO 在线训练环的一部分复杂度。

更准确的面试说法：

> DPO 把偏好优化转写为直接优化语言模型的分类式目标，不需要在训练循环中单独运行显式 Reward Model。

## 9. DPO vs PPO

| | DPO | PPO-based RLHF |
|---|---|---|
| 输入 | preference pair | rollout + reward |
| 显式 Reward Model | 通常不需要 | 经典流程常需要 |
| 在线采样 | 不一定 | 常见 |
| 工程复杂度 | 较低 | 较高 |
| 与环境交互 | 相对弱 | 更自然 |
| 典型使用 | preference alignment | online RL、reasoning、agent reward |

## 10. GRPO 的直觉

GRPO 类方法的一条核心思路：

> 对同一个 prompt 采样一组答案，通过组内 reward 的相对差异构造 advantage，而不是依赖独立 value model。

~~~text
同一个问题
  ↓
生成多个回答
  ↓
每个回答得到 reward
  ↓
组内比较
  ↓
高于组基线的回答概率提高
~~~

它很适合：

- 数学；
- 代码；
- 有可验证 reward 的 reasoning 任务。

## 11. Verifiable Reward

例如数学：

~~~text
final answer == reference？
~~~

代码：

~~~text
unit tests pass？
~~~

SQL：

~~~text
结果集是否正确？
~~~

这类 reward 很重要，因为：

- 可规模化；
- 比主观 judge 更稳定；
- 可以自动形成 RL feedback。

## 12. Rejection Sampling

~~~text
一个 Prompt
   ↓
采样 N 个回答
   ↓
Judge / Reward / Tests
   ↓
挑最好的一部分
   ↓
加入下一轮训练数据
~~~

它不是 PPO/DPO 的同义词。

它更像“生成候选 → 筛选优质样本 → 再训练”。

## 13. Distillation

Teacher 是大模型/强推理模型，生成：

- answer；
- synthetic instruction；
- reasoning trajectory；
- preference。

Student 学这些数据。

作用：

- 把能力迁移到更小模型；
- 降推理成本；
- 构造高质量数据。

## 14. CoT 为什么可能有效

Chain-of-Thought 的直觉：

~~~text
复杂问题
  ↓
拆成多个中间状态
  ↓
逐步生成
  ↓
降低单步预测难度
~~~

对数学、逻辑、多步规划常有帮助。

## 15. CoT 的局限

- token 更多、成本更高；
- 中间文字不保证真实对应模型内部机制；
- 早期错误会传播；
- 简单任务可能没收益；
- “看起来推理很完整”不等于结论可靠。

因此实际工程还会配合：

- verifier；
- tool use；
- self-consistency；
- search；
- external execution。

## 16. Post-Training 总图

~~~text
Base Model
   │
   ▼
SFT
   │
   ├───────────────┐
   │               │
   ▼               ▼
Preference Data   Verifiable Tasks
   │               │
   ▼               ▼
DPO / RM+PPO      RL / GRPO-like
   │               │
   └───────┬───────┘
           ▼
  Aligned / Reasoning Model
           │
           ▼
Rejection Sampling / Distillation
           │
           ▼
      下一轮数据迭代
~~~

## 17. 面试标准回答：SFT、RLHF、DPO、GRPO 什么关系

可以这样答：

> SFT 首先让 Base Model 学会 instruction following；之后可通过 preference 或可验证 reward 做进一步后训练。经典 RLHF 常先训练 Reward Model，再用 PPO 优化 policy；DPO 则直接使用 chosen/rejected 偏好对优化模型，工程更简单；对于数学和代码等有可验证 reward 的任务，可以做在线强化学习，GRPO 类方法通过同一 prompt 的组内相对 reward 构造 advantage。拒绝采样则是生成多个候选后筛优质样本再训练，不等同于这些 RL 算法本身。

下一章：[推理与解码](04-inference-decoding.md)
