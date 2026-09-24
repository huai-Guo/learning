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
