# 07｜真实后端网络拓扑：一次公网请求怎样进入业务服务？

> 这一章第一次把 DNS、TCP、TLS、HTTP、QUIC、RPC、服务发现放进同一张真实后端拓扑。
>
> 核心问题不是背 CDN、WAF、LB、Nginx、Gateway，而是：它们为什么存在、站在哪里、谁和谁通信、每一段跑什么协议？

---

# 0. 总图：先看职责，不要先数机器

~~~text
Browser
   ↓
DNS
   ↓
CDN / Edge
   ↓
WAF
   ↓
L4 / L7 Load Balancer
   ↓
TLS Termination
   ↓
Nginx / Envoy / API Gateway
   ↓
Backend Service
   ↓
Service Discovery + Load Balancing
   ↓
RPC
   ↓
Redis / MySQL / MQ
~~~

现实系统不一定把这些职责部署成很多独立机器。一个 Edge 进程就可能同时承担 TLS、WAF、Cache、HTTP Routing 与 Origin Proxy。

所以这首先是一张职责图，不是设备数量图。


---

# 1. DNS 返回的 IP 为什么常常不是业务服务器 IP？

假设用户访问：

~~~text
https://api.example.com
~~~

DNS 返回：

~~~text
api.example.com
       ↓
203.0.113.50
~~~

这个地址可能属于 CDN Edge、Anycast Edge、WAF、Public Load Balancer 或 Reverse Proxy。

真正业务服务可能只有私网地址：

~~~text
10.23.4.17
10.23.4.18
10.23.5.22
~~~

因此更真实：

~~~text
Browser
   ↓
203.0.113.50
Public Edge
   ↓
10.23.x.x
Backend
~~~

DNS 通常解决先进入哪个入口，不负责最终挑选哪台业务实例。

---

# 2. CDN 到底是什么？

CDN = Content Delivery Network。

最直观作用：

~~~text
Tokyo User
   ↓
Tokyo Edge
   │
   ├─ Cache Hit → 直接返回
   └─ Cache Miss → 回源 Origin
~~~

价值包括：降低 RTT、减少 Origin 带宽和 QPS、吸收突发流量、就近完成 TLS / HTTP；某些产品还同时提供 WAF、DDoS、Bot Management。

因此用户发出一次请求，不代表 Origin 一定收到。

---

# 3. Origin 是什么？

Origin 是 CDN 或 Proxy 后面的源站角色。

它可能是 Nginx、Cloud Load Balancer、API Gateway、Object Storage 或 Backend Service。

~~~text
Browser
 ↓
CDN
 ↓
Origin LB
 ↓
Nginx
 ↓
App
~~~

Origin 是拓扑角色，不是协议名。

---

# 4. WAF 与普通 Firewall 有什么区别？

传统 Network Firewall 更常依据：

~~~text
src IP
dst IP
src port
dst port
protocol
connection state
~~~

WAF 更关注 HTTP 应用内容：

~~~text
Method
Path
Header
Cookie
Query
Body
User-Agent
Request Rate
~~~

它可能做 SQL Injection Pattern、XSS Pattern、Bot Detection、Rate Limit 和 Application Rule Matching。

所以可以先记：

~~~text
Firewall
偏 L3 / L4

WAF
偏 L7
~~~

现实产品能力会有重叠。

---

# 5. L4 Load Balancer

L4 LB 主要按 IP、Port、Transport Protocol 和连接状态转发。

~~~text
Client
1.2.3.4:52001
        ↓
Public LB
203.0.113.50:443
        ↓
Backend A
10.23.4.17:443
~~~

它常关心 TCP / UDP、Five Tuple、Health Check、Connection Distribution、NAT / DSR / Proxying，而不必理解完整 HTTP Path。

---

# 6. L7 Load Balancer

L7 LB 可以理解 HTTP 等应用协议，根据 Host、Path、Method、Header、Cookie 决定后端。

~~~text
/api/users/*
      ↓
User Service

/api/orders/*
      ↓
Order Service
~~~

一句话：

> L4 主要按连接分发，L7 可以按 Request 分发。

---

# 7. L4 与 L7 对比

| 维度 | L4 LB | L7 LB |
|---|---|---|
| 主要依据 | IP / Port / Protocol | Host / Path / Header / Cookie 等 |
| 是否理解 HTTP | 不必 | 通常需要 |
| 粒度 | Connection | Request |
| TLS | 可直接透传 | 要看 HTTPS 内容时通常要终止或解密 |
| 常见职责 | Connection Distribution | Routing / Auth / Rate Limit / Rewrite |

---

# 8. TLS Termination

假设：

~~~text
Browser
 ↓ HTTPS
Nginx
 ↓ HTTP
Backend
~~~

Nginx 持有证书和对应 Private Key，并在这里结束外部 TLS Session，所以 Nginx 是 TLS Termination Point。

但是终止 TLS 后不一定必须明文。

三种常见模式：

~~~text
A. Terminate then HTTP
Client → TLS → Edge → HTTP → Backend

B. Terminate then Re-encrypt
Client → TLS A → Edge → TLS B → Backend

C. TLS Passthrough
Client → TLS → L4 LB → Backend
~~~

所以使用 LB 不等于一定在那里解 TLS。


---

# 9. 为什么 L7 Routing 经常要先解 TLS？

HTTPS 里的：

~~~text
GET /orders
Host: api.example.com
Header: ...
~~~

都在 TLS 保护内。要根据 Path、Host、Header 做 L7 Routing，就需要先解密并解析 HTTP。

因此 L7 Proxy / Gateway 经常同时承担 TLS Termination。

---

# 10. Nginx、Envoy、API Gateway 怎么区分？

能力有重叠，侧重点不同。

Nginx 常见职责：Reverse Proxy、TLS、Static File、HTTP Routing、Load Balancing、Cache。

Envoy 常见职责：L7 Proxy、HTTP/2 / gRPC、Dynamic Discovery、Retry / Timeout、mTLS、Observability、Service Mesh Data Plane。

API Gateway 更强调：外部 API 入口、Authentication / Authorization、Rate Limit、Routing、API Policy、Protocol Translation、Aggregation、Tenant / Quota。

所以它们不是严格互斥的类别。

---

# 11. Reverse Proxy 与 Forward Proxy

Reverse Proxy：

~~~text
Client
 ↓
Reverse Proxy
 ↓
Backend
~~~

代表 Server 一侧，隐藏真实 Backend。

Forward Proxy：

~~~text
Client
 ↓
Forward Proxy
 ↓
Internet Server
~~~

更像代表 Client 出网。

---

# 12. 为什么 Backend 经常看不到真实 Client IP？

~~~text
Client
1.2.3.4
 ↓
Proxy
10.0.0.5
 ↓
Backend
10.0.0.20
~~~

如果 Proxy 重新建立 TCP Connection，那么 Backend 的 TCP Peer 本来就只是 10.0.0.5。这不是信息丢错了，而是连接拓扑真的改变了。

原始 Client IP 需要通过额外可信元数据传递。

---

# 13. X-Forwarded-For 与 Forwarded

常见：

~~~text
X-Forwarded-For: 1.2.3.4
X-Forwarded-Proto: https
X-Forwarded-Host: api.example.com
~~~

标准化 Forwarded 形式可以表达：

~~~text
Forwarded: for=192.0.2.60;proto=https;host=example.com
~~~

但客户端也能伪造这些 Header。

因此 Backend 不能无条件信任，而要结合 Trusted Proxy List、Edge 清洗和追加策略。

---

# 14. PROXY Protocol 为什么存在？

X-Forwarded-For 属于 HTTP 层。如果后端接的是 raw TCP、TLS Passthrough、SMTP、MySQL Protocol 或其他 L4 Protocol，就没有 HTTP Header 可用。

PROXY Protocol 的思路：

~~~text
L4 LB
 ↓
PROXY metadata
 ↓
original src / dst
 ↓
real application bytes
~~~

所以：

~~~text
X-Forwarded-For
→ HTTP 层

PROXY Protocol
→ 更通用的连接级代理元数据
~~~

---

# 15. 一次公网 HTTPS 请求怎样进入服务？

~~~text
Browser
 ↓
DNS
 ↓
Public Edge IP
 ↓
TCP 443 或 QUIC UDP 443
 ↓
CDN / Edge
 ↓
TLS
 ↓
WAF
 ↓
HTTP Routing
 ↓
Origin LB
 ↓
Nginx / Envoy / API Gateway
 ↓
Backend Service
~~~

这时才真正进入业务逻辑。

---

# 16. 公网协议和内网协议可以不同

例如：

~~~text
Browser → Gateway
HTTP/2 + JSON

Gateway → Order Service
gRPC + Protobuf
~~~

Gateway 可能完成：

~~~text
Auth
 ↓
Rate Limit
 ↓
Route Match
 ↓
Protocol Translation
 ↓
Internal RPC
~~~

所以一个用户 HTTP Request 可以在内部变成 RPC。


---

# 17. Service Discovery 与 Load Balancing

代码只知道：

~~~text
inventory-service
~~~

真实网络需要：

~~~text
10.20.1.7:9000
10.20.1.8:9000
10.20.2.3:9000
~~~

因此：

~~~text
Service Name
 ↓
Service Discovery
 ↓
Endpoint Set
 ↓
Load Balancing
 ↓
Pick One Endpoint
 ↓
Connect or Reuse
 ↓
RPC
~~~

一句话：

~~~text
Discovery
= 有哪些实例？

Load Balancing
= 这一次选哪个？
~~~

---

# 18. Client-side、Server-side、Sidecar LB

Client-side：

~~~text
Service A
 ↓ Discovery
A / B / C
 ↓
自己选 B
 ↓
RPC → B
~~~

Server-side：

~~~text
Service A
 ↓
Stable VIP / Proxy
 ↓
A / B / C
~~~

Sidecar：

~~~text
Service A
 ↓ localhost
Sidecar
 ↓ Discovery + LB + mTLS
 ↓
Remote Sidecar
 ↓
Service B
~~~

---

# 19. 为什么需要 Connection Pool？

如果每次调用都：

~~~text
socket
connect
TLS
request
close
~~~

成本很高。

因此会维护长期连接：

~~~text
Service A
  ├─ Conn A → Service B1
  ├─ Conn B → Service B2
  └─ Conn C → Service B3
~~~

HTTP/2 / gRPC 中，一条 Connection 还可以复用多个 Streams。

---

# 20. Keepalive、Idle Timeout、Max Age、Drain

~~~text
Keepalive
→ 探测连接是否仍可用

Idle Timeout
→ 太久无流量就释放

Max Connection Age
→ 连接不能永久存在

Drain
→ 不再接新请求，让旧请求完成后关闭
~~~

所以 Connection closed by peer 不一定是网络故障，也可能只是 Proxy 的连接生命周期策略。

---

# 21. Timeout 有很多层

~~~text
Browser Timeout
CDN Timeout
LB Timeout
Gateway Timeout
RPC Deadline
Service Timeout
Redis Timeout
DB Query Timeout
~~~

它们不是同一个 Timeout。

常见预算思想：

~~~text
User Budget 1000ms
 ↓
Gateway 900ms
 ↓
Service A 700ms
 ↓
Service B 500ms
 ↓
DB 300ms
~~~

下层先失败，上层才还有时间做 fallback、cleanup 或返回错误。

---

# 22. Retry 为什么可能制造事故？

服务已经过载：

~~~text
Normal 1000 QPS
 ↓
Timeout 增多
 ↓
每层都 Retry
 ↓
额外流量继续放大
 ↓
更慢
~~~

这就是 Retry Storm。

Retry 必须和 Backoff、Jitter、Retry Budget、Idempotency、Circuit Breaker、Load Shedding 一起考虑。

---

# 23. Circuit Breaker 与 Load Shedding

Circuit Breaker：

~~~text
持续失败
 ↓
OPEN
 ↓
暂时不真实调用
 ↓
快速失败 / fallback
 ↓
HALF-OPEN
 ↓
试探恢复
~~~

Load Shedding 是系统超过容量时主动拒绝一部分请求，保护剩余请求。

---

# 24. Redis / MySQL 为什么通常在私网？

数据库通常只允许 Private Network 和 Trusted Services 访问。

原因包括 Attack Surface、Credential Exposure、Internet Scanning、DDoS、Misconfiguration、Access Control 和 Compliance。

真实拓扑通常是：

~~~text
Internet
 ↓
Gateway
 ↓
Backend
 ↓ Private Network
Redis / MySQL
~~~


---

# 25. Backend 到 Redis / MySQL 仍然是网络请求

~~~text
Application
 ↓
DB / Redis Driver
 ↓
Socket
 ↓
TCP
 ↓
IP
 ↓
Private Network
 ↓
Database Server
~~~

所以数据库访问也可能遇到 connect timeout、read timeout、pool exhaustion、connection reset、DNS failure、route failure 和 packet loss。

数据库问题不一定只是 SQL。

---

# 26. 数据库为什么也需要 Connection Pool？

MySQL 建连可能包含 TCP、TLS、Authentication、Session Initialization。

每条 SQL 都重建连接会非常浪费。

~~~text
App
 ↓
DB Connection Pool
 ├─ Conn 1
 ├─ Conn 2
 └─ Conn 3
 ↓
MySQL
~~~

Redis Client 同样常维护长连接或连接池。

---

# 27. Connection Pool 为什么也会成为故障源？

如果 Pool Size 固定，而每个请求持有连接时间变长，Pool 很快耗尽。

~~~text
Pool Exhausted
 ↓
Wait for Connection
 ↓
Pool Timeout
~~~

表面像数据库慢，根因可能是：

- Pool 太小；
- SQL 太慢；
- Connection Leak；
- 下游抖动；
- 上游并发过高。

---

# 28. 一次业务 Request 可能有很多独立连接

~~~text
Browser → CDN            Connection A
CDN → Gateway            Connection B
Gateway → Feed Service   Connection C
Feed → User Service      Connection D
Feed → Recommend         Connection E
Feed → Redis             Connection F
Feed → MySQL             Connection G
~~~

所以：

> **一次业务 Request 不等于一条端到端 TCP Connection。**

每个 Proxy / Service 边界都可能结束上一条连接并新建下一条。

---

# 29. NAT、L4 LB、L7 Proxy 为什么都会改变对端？

~~~text
Client
1.2.3.4:52001
 ↓
Home NAT
198.51.100.8:62001
 ↓
CDN
10.0.0.10:43000
 ↓
Gateway
10.0.1.20:51000
 ↓
Backend
~~~

Backend 的 TCP Peer 可能只是 Gateway。

本质差异：

~~~text
NAT
→ 改地址 / 端口并维护映射

L4 LB
→ 按 Transport Connection 分发

L7 Proxy
→ 解析应用协议并按 Request 路由
~~~

---

# 30. Health Check、Readiness、Liveness

L4 Health Check 可能只是 TCP connect。

L7 Health Check 可能是：

~~~text
GET /health
→ 200
~~~

但 Port 能连不等于业务健康；健康页 200 也不一定代表所有依赖都健康。

Readiness 回答：

> 现在能不能接新流量？

Liveness 回答：

> 进程是否坏到应该重启？

因此服务可以：

~~~text
Alive
but
Not Ready
~~~

---

# 31. Deploy 为什么需要 Connection Draining？

直接 Kill Backend：

~~~text
In-flight Request
 ↓
Reset / Error
~~~

更合理：

~~~text
LB 停止给它新流量
 ↓
Existing Requests drain
 ↓
等待完成
 ↓
关闭连接
 ↓
停止进程
~~~

这就是 Graceful Shutdown / Connection Draining。

---

# 32. mTLS 与 Service Mesh

公网 TLS 常见是 Client 验证 Server。

内部 Service-to-Service 可以：

~~~text
Service A
⇄ mTLS ⇄
Service B
~~~

双方都具有身份材料，从而同时获得 Encryption、Integrity、Server Identity 和 Client Identity。

Service Mesh 常把 mTLS、Certificate Rotation、Discovery、Retry、Telemetry 等从业务代码中抽出去。


---

# 33. API Gateway 与 Service Mesh

API Gateway 更偏 North-South：

~~~text
External Client
 ↓
Internal System
~~~

Service Mesh 更偏 East-West：

~~~text
Service
 ↔
Service
~~~

前者常管 Auth、Rate Limit、Routing、API Policy；后者常管 mTLS、Discovery、Retry、Timeout、Traffic Policy、Telemetry。

现实产品功能可以重叠，但治理对象不同。

---

# 34. Trace ID 为什么存在？

~~~text
Gateway
 ↓
Service A
 ↓
Service B
 ↓
Redis
 ↓
DB
~~~

如果每层日志没有共同标识，很难追踪一次用户请求。

因此会传播：

~~~text
Trace ID
Span ID
~~~

但它们与连接标识完全不同：

~~~text
TCP Connection
→ 传输连接

QUIC Connection ID
→ QUIC 连接身份

Trace ID
→ 业务调用链
~~~

一条 Trace 可以跨很多连接。

---

# 35. 一次请求的角色图

~~~text
[User Device]
Browser
   │ HTTPS
   ▼
[Public Edge]
DNS → CDN / Anycast
        ├─ Cache
        ├─ DDoS
        ├─ WAF
        └─ TLS
   │
   ▼
[Ingress]
L4 / L7 Load Balancer
   ↓
Nginx / Envoy / API Gateway
        ├─ Auth
        ├─ Rate Limit
        ├─ Routing
        └─ Observability
   │
   ▼
[Application Network]
Backend Service
   ├─ RPC → Other Service
   ├─ Redis Client → Redis
   ├─ DB Driver → MySQL
   └─ MQ Client → Message Queue
~~~

---

# 36. 一次请求的协议图

~~~text
Browser → Edge
HTTP/2 over TLS over TCP
or
HTTP/3 over QUIC over UDP

Edge → Gateway
HTTP/1.1 or HTTP/2
TLS depends on architecture

Gateway → Backend
HTTP / gRPC / Thrift / custom RPC

Backend → Redis
Redis Protocol over TCP

Backend → MySQL
MySQL Protocol over TCP
~~~

角色图和协议图不能混成一张箭头。

---

# 37. 一次请求的身份图

~~~text
DNS Name
api.example.com

TLS Identity
Certificate SAN = api.example.com

TCP Peer
可能是 Proxy / LB

Original Client IP
来自可信 forwarding metadata

Application User
Cookie / Token / Session

Service Identity
mTLS / Workload Identity

Trace Identity
Trace ID / Span ID
~~~

所以“你是谁”在不同层有不同答案。

---

# 38. 502、503、504 在真实拓扑中怎么理解？

502 Bad Gateway 常见于 Proxy / Gateway 无法从 Upstream 获得有效响应，例如 Connection Reset、Protocol Error 或 Invalid Response。

503 Service Unavailable 常见于没有健康 Backend、过载、Maintenance、Circuit Open 或 Load Shedding。

504 Gateway Timeout 常见表示 Gateway 等 Upstream 超时。

但具体含义仍以系统实现为准。

---

# 39. 域名 + 端口不通，但 IP + 端口通，怎么排？

~~~text
DNS 是否解析到正确 Edge / LB？
 ↓
IPv4 / IPv6 是否走不同路径？
 ↓
TLS SNI 是否依赖 hostname？
 ↓
Certificate 是否匹配 hostname？
 ↓
HTTP Host / :authority 是否用于虚拟路由？
 ↓
CDN / WAF 是否按 Host 做策略？
 ↓
Gateway 是否按 Host / Path 路由？
~~~

IP:port 能通只证明可以到某个 Endpoint，不证明完整 hostname 链路正确。

---

# 40. ping 通为什么不能证明 HTTPS 可用？

~~~text
ping
=
ICMP

HTTPS
=
TCP 443
or
QUIC UDP 443
~~~

Ping 成功不代表 TCP 443 开放、UDP 443 开放、TLS 正常、HTTP 正常，或 Gateway 有健康 Backend。

如果 TCP connect 已经成功但接口仍超时，就继续往 TLS、HTTP、Gateway、Backend、RPC、Redis、DB 排。

---

# 41. 最容易混淆的 20 个点

1. DNS 返回的 IP 常是 Edge / LB，不一定是业务 Server。
2. CDN 不只是缓存，它是 Edge 网络角色。
3. WAF 与 Network Firewall 关注层次不同。
4. L4 LB 主要按连接分发，L7 LB 可按 Request 路由。
5. Load Balancer 不一定终止 TLS。
6. TLS Termination 后也可以 Re-encrypt。
7. Reverse Proxy 与 Forward Proxy 站位不同。
8. Backend TCP Peer 常是 Proxy，而非真实 Client。
9. X-Forwarded-For 不能无条件信任。
10. Forwarded / X-Forwarded-* 属于应用层代理元数据。
11. PROXY Protocol 更适合通用 L4 场景。
12. API Gateway 与 Nginx / Envoy 能力有重叠但侧重点不同。
13. 公网 HTTP 与内网 RPC 可以用不同协议。
14. Service Discovery 与 Load Balancing 是两个步骤。
15. 一次业务 Request 可能对应很多独立连接。
16. Timeout 有很多层，不能笼统说网络超时。
17. Retry 可能制造 Retry Storm。
18. Database 访问仍然是网络 I/O。
19. API Gateway 更偏 North-South，Service Mesh 更偏 East-West。
20. Trace ID、TCP Connection、QUIC CID 属于不同标识层次。

---

# 42. 一句话记忆

> **真实后端网络不是 Browser 直接连业务进程，而是 DNS 先把用户送到 Edge；Edge/WAF/LB/Gateway 负责安全、连接和路由；内部再通过 Service Discovery + Load Balancing + RPC 访问服务，服务通过独立网络连接访问 Redis/MySQL 等基础设施。**

---

# 43. 自测

1. DNS 返回的 IP 为什么可能不是业务 Server IP？
2. CDN Cache Hit 时 Origin 会不会收到请求？
3. WAF 和 Firewall 有什么区别？
4. L4 LB 和 L7 LB 分别根据什么转发？
5. TLS Termination、Re-encrypt、Passthrough 有什么区别？
6. 为什么 L7 Routing 经常需要先解 TLS？
7. Reverse Proxy 为什么让 Backend 看不到真实 Client TCP Peer？
8. X-Forwarded-For 为什么不能无脑信任？
9. Forwarded Header 与 PROXY Protocol 有什么区别？
10. API Gateway 常做哪些事情？
11. 为什么公网 HTTP 和内网 RPC 可以使用不同协议？
12. Service Discovery 和 Load Balancing 分别解决什么？
13. Connection Pool 为什么存在？
14. Timeout 为什么通常按调用链预算递减？
15. Retry Storm 是怎样形成的？
16. Circuit Breaker 与 Load Shedding 分别做什么？
17. Redis / MySQL 为什么通常不暴露公网？
18. 一次用户 Request 为什么会产生很多连接？
19. API Gateway 与 Service Mesh 治理方向有何区别？
20. Trace ID 为什么不等于 Connection ID？

---

# 44. 下一章

下一章进入实验：

> **08｜Windows / Linux / curl / OpenSSL / Wireshark / DevTools：把前面所有概念在真实机器上验证出来。**

每个实验统一回答：

~~~text
执行什么？
 ↓
看哪一列？
 ↓
它对应母图里的哪一步？
 ↓
异常时说明什么？
~~~

---

# 45. 延伸阅读

本章主要是工程拓扑整合，后续在 SOURCES.md 中补充：

- RFC 7239 · Forwarded HTTP Extension
- HAProxy PROXY Protocol Specification
- Nginx Reverse Proxy / Load Balancing
- Envoy Architecture / xDS
- Kubernetes Service / CoreDNS / Readiness / Liveness
- gRPC Deadlines / Keepalive / Retry
- MySQL / Redis connection and pooling references

具体链接见 [SOURCES.md](./SOURCES.md)。
