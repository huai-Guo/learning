# 11｜大模型系统设计：三个案例贯穿全部知识

系统设计题考的是：

> 能不能把模型知识变成可运行服务。

# Case 1：企业内部知识库 RAG

需求：

- 100 万份内部文档；
- 每天增量更新；
- 用户只能看自己权限资料；
- 回答必须带引用；
- P95 < 3 秒。

## 架构

~~~mermaid
flowchart LR
    A[Document Sources] --> B[Ingestion]
    B --> C[Parse/Clean]
    C --> D[Chunk]
    D --> E[Embedding]
    E --> F[Vector Index]
    D --> G[BM25 Index]
    U[User Query] --> Q[Query Rewrite]
    Q --> F
    Q --> G
    F --> H[Candidates]
    G --> H
    H --> I[ACL Filter]
    I --> J[Reranker]
    J --> K[Context Builder]
    K --> L[LLM]
    L --> M[Answer + Citations]
~~~

## 为什么 ACL 必须在 LLM 前

错误：

~~~text
先把机密文档召回给 LLM
→ 再让 LLM “不要泄漏”
~~~

秘密已经进入 context。

正确：

> Retrieval/Context Builder 阶段就做权限过滤。

## 延迟拆分

~~~text
Total
=
Rewrite
+ Retrieve
+ Rerank
+ Prefill
+ Decode
~~~

先定位瓶颈，再优化。

## Cache

可缓存：

- embedding；
- retrieval；
- rerank；
- system prompt prefix；
- 热门回答（注意 ACL）。

## Eval

Retrieval：

- Recall@K；
- MRR。

Generation：

- correctness；
- groundedness；
- citation precision；
- no-answer correctness。

---

# Case 2：高并发 Chat API

需求：

- 70B；
- 数千并发；
- streaming；
- 32K context；
- 首 token 敏感。

## 架构

~~~mermaid
flowchart LR
    C[Clients] --> G[Gateway]
    G --> R[Rate Limit]
    R --> Q[Queue]
    Q --> S[Scheduler]
    S --> W1[GPU Worker]
    S --> W2[GPU Worker]
    S --> W3[GPU Worker]
    W1 --> T[Token Stream]
    W2 --> T
    W3 --> T
~~~

## Queue 为什么必须有

不能无限请求直接塞 GPU。

Scheduler 需要根据：

- token budget；
- KV capacity；
- priority；
- SLA；

做 admission。

## 为什么 Continuous Batching

请求长度不同，完成一个就移出并塞新请求，减少 GPU 空洞。

## Prefix Cache

共享的 system prompt / tool schema 可以复用 KV，降低 TTFT。

## 长 Prompt

可用：

- chunked prefill；
- 限 max prompt；
- RAG；
- prompt compression；
- PD disaggregation。

## 多卡

- 单模型太大：TP。
- 层很深：可能 PP。
- MoE：EP。
- 多副本扩容：DP/replica。

## 监控

- queue depth；
- QPS；
- active requests；
- TTFT P50/P95/P99；
- TPOT；
- tokens/s；
- GPU utilization；
- KV utilization；
- OOM；
- cancellation；
- error rate。

---

# Case 3：Coding Agent

需求：

> 给 GitHub issue，Agent 自动读仓库、改代码、跑测试、输出 patch。

## 架构

~~~mermaid
flowchart TD
    U[Issue] --> A[Agent Runtime]
    A --> M[LLM]
    M --> D{Next Action}
    D -->|Search| S[Code Search]
    D -->|Read| R[Read File]
    D -->|Edit| E[Edit]
    D -->|Test| T[Test Runner]
    S --> A
    R --> A
    E --> A
    T --> A
    A --> V[Verifier]
    V --> O[Patch / Result]
~~~

## 为什么 Sandbox

Agent 能 shell 就相当于有远程代码执行能力。

要限制：

- filesystem；
- network；
- process；
- secrets；
- CPU/memory；
- timeout。

## Agent State

至少：

~~~text
task_id
workspace
base_commit
messages
tool_calls
patch
test_results
budget
status
~~~

这样才能 resume / debug / replay / eval。

## Context 太长怎么办

不要把整个仓库永远放 prompt。

用：

- search；
- selective read；
- summary；
- recent turns；
- structured state；
- tool result compression。

## 怎么判定完成

不能只信模型说“修好了”。

必须用：

- build；
- tests；
- hidden tests；
- lint；
- regression。

## Retry 与幂等

例如：

~~~text
create_pr()
~~~

如果请求超时，不知道服务端是否已经成功。

重试要考虑：

- idempotency key；
- operation state；
- read-before-retry。

Agent 工程和传统后端并没有割裂。

---

# Case 4：模型选型

面试官：

> 为什么选模型 A？

不要答：

> 排行榜最高。

正确流程：

~~~text
定义业务任务 + SLA
 ↓
固定 Prompt / Tools / Context
 ↓
多模型离线 Eval
 ↓
质量阈值筛选
 ↓
测 TTFT / TPOT / QPS / Cost
 ↓
灰度 A/B
 ↓
选更合适的 Pareto 点
~~~

## 选型表

| 指标 | 说明 |
|---|---|
| Task Success | 业务真正成功 |
| JSON Valid | 结构化输出 |
| Tool Success | 工具参数可靠性 |
| RAG Groundedness | 基于证据 |
| TTFT | 首 token |
| TPOT | 后续 token |
| Throughput | 并发吞吐 |
| Cost | 单任务成本 |
| Context | 长上下文 |
| Deployment | 目标硬件支持 |

# 最终链路

~~~text
数据
↓
Tokenizer
↓
Pretraining
↓
Transformer Decoder
↓
SFT / RL
↓
Model
↓
Quantization
↓
Serving Engine
↓
KV Cache / Batching / Scheduling
↓
RAG / Agent
↓
Verifier / Eval
↓
Production Metrics
~~~

能沿这条链解释问题，就不再只是背八股。
