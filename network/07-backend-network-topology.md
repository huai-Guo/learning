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
