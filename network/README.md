# 计算机网络扫盲

> 面向第一次系统学习网络的人，但目标不是只会背名词，而是最后能看懂后端网络、抓包和常见面试题。

本目录只维护一条母线：

> **从“电脑刚连上网络”开始，一直追踪到浏览器拿到 HTTPS 响应。**

详细知识都只是把这条母线中的一个框放大。

---

## 先看阅读版

- **GitHub 直接阅读：** 优先看 Markdown，本仓库的 Mermaid 图会直接渲染。
- **视觉课程：** [index.html](./index.html) 是统一课程首页；00～07 均提供视觉阅读版。HTML 目标是“可以独立学完”，Markdown 继续作为完整文字真源。
- **完整计划：** [PLAN.md](./PLAN.md)

> GitHub 文件页不会像 GitHub Pages 那样直接运行 HTML，所以仓库内以 Markdown 为“正文真源”，HTML 用作视觉总览。后续如果启用 GitHub Pages，可以直接把 HTML 作为在线阅读入口。

---

# 0. 母图：先区分“参与者”，再看协议

下面这张图故意不把所有协议塞进一根箭头。  
因为 **Browser、OS Kernel、家庭路由器、Internet、Server 是不同参与者**。

~~~mermaid
flowchart LR
    B["Browser / App<br/>URL · DNS · TLS · HTTP"]
    K["Client OS Kernel<br/>Socket · TCP/UDP · IP · Route · Neighbor"]
    N["NIC / Local Link"]
    R["Home / Access Router<br/>Routing · Conntrack · NAT/PAT · Firewall"]
    I["ISP / Internet<br/>逐跳 IP Forwarding"]
    E["Public Edge / Origin Entry<br/>CDN · WAF · L4/L7 LB · TLS · HTTP Routing"]
    A["Backend Network<br/>Gateway · Discovery · LB · RPC · mTLS"]
    D["Data / Infra<br/>Redis · MySQL · MQ"]

    DNS["DNS System<br/>Recursive / Authoritative"]
    CA["PKI / Trust<br/>CA · Certificate · Local Trust Store"]

    B --> K --> N --> R --> I --> E --> A --> D
    B -. 名称解析 .-> DNS
    B -. 证书验证 / TLS 身份 .-> CA
    E -. 证书部署 / TLS endpoint .-> CA
~~~

这张图是“角色 / 拓扑地图”，不是逐报文时序图，也不是说每一项能力都必须部署成独立设备。

尤其要避免一种错误理解：

~~~text
TLS 完成
 ↓
HTTP 完成
 ↓
然后才轮到 CDN / WAF / LB
~~~

现实中 CDN / Edge / Gateway 本身就是 TCP、TLS、HTTP 的参与者；一条业务请求经过代理边界时，还可能结束旧连接并重新建立下一段连接。

真正 TCP/TLS 的双向交互，会在章节里用时序图单独画。

---

# 1. 本目录采用的主线假设

第一条主线先讲最常见、最容易建立直觉的：

~~~text
HTTP/1.1 或 HTTP/2
        ↓
TLS 1.3
        ↓
TCP
        ↓
IP
        ↓
Ethernet / Wi-Fi
~~~

**HTTPS 不等于必须 TCP。**

HTTP/3 会走：

~~~text
HTTP/3
  ↓
QUIC
  ↓
UDP
  ↓
IP
~~~

它会在现代协议章节单独重走一次。

---

# 2. 学习顺序

0. [电脑刚连上网络时，先拿到了什么？](./00-network-bootstrap.md) · [HTML 视觉版](./00-network-bootstrap.html)  
   DHCP、本机 IP、子网、默认网关、DNS Server。

1. [从输入 URL 到网页返回](./01-url-to-webpage.md) · [HTML 视觉版](./01-url-to-webpage.html)  
   把 DNS、Socket、TCP、Route、ARP/NDP、NAT/PAT、TLS、HTTP 串成一条真实请求。

2. [网络分层、封装与 OS 收发包](./02-network-model-and-packets.md) · [HTML 视觉版](./02-network-model-and-packets.html)  
   网络分层、封装/解封装、用户态 → 内核 → 驱动 → 网卡、MTU/MSS。

3. [IP、CIDR、Route、ARP/NDP、ICMP、NAT](./03-ip-routing-arp-nat.md) · [HTML 视觉版](./03-ip-routing-arp-nat.html)  
   IPv4/IPv6、CIDR、最长前缀匹配、ARP/NDP、ICMP、ping/traceroute、SNAT/DNAT/PAT、Conntrack、CGNAT。

4. [TCP / UDP：可靠传输与状态机](./04-tcp-udp.md) · [HTML 视觉版](./04-tcp-udp.html)  
   四元组、监听/连接 Socket、三次握手、Seq/Ack、重传、rwnd/cwnd、四次挥手、TIME_WAIT/CLOSE_WAIT、Keepalive、RST、故障场景。

5. [HTTP / HTTPS / TLS：业务语义、证书与安全握手](./05-http-https-tls.md) · [HTML 视觉版](./05-http-https-tls.html)  
   HTTP Request/Response、Host/:authority、Cookie/Session、缓存、TLS 1.2/1.3、ECDHE、HKDF、数字签名、证书链、SNI、ALPN、Session Resumption、0-RTT。

6. [HTTP/2、HTTP/3、QUIC、WebSocket、RPC](./06-modern-protocols.md) · [HTML 视觉版](./06-modern-protocols.html)  
   Binary Frame、Stream/Multiplexing、TCP HOL、QUIC Packet/Stream、Connection ID、QPACK、WebSocket、gRPC/Thrift、Deadline/Retry、服务发现与负载均衡。

7. [真实后端网络拓扑：公网入口到 Redis / MySQL](./07-backend-network-topology.md) · [HTML 视觉版](./07-backend-network-topology.html)  
   DNS → CDN/Edge → WAF → L4/L7 LB → TLS Termination → Nginx/Envoy/API Gateway → Backend → RPC → Redis/MySQL，并补齐 Forwarded、PROXY Protocol、连接池、Timeout/Retry、mTLS、Service Mesh 与排障。

> 当前课程主线到 07 结束。接下来不新增第 08 章，而是持续把 01～07 打磨成统一、易读、图文并茂的视觉化教学材料。

---

# 3. 整个课程永远追问四件事

遇到任何新名词：

~~~text
它为什么存在？
        ↓
它解决谁的问题？
        ↓
它运行在哪个参与者里？
        ↓
它在整条请求链中前后分别是谁？
~~~

例如 ARP 不是孤立背：

~~~text
IP → MAC
~~~

而是：

~~~text
目标 IP
   ↓
Route 决定下一跳
   ↓
下一跳是 IPv4 邻居
   ↓
ARP
   ↓
得到下一跳 MAC
   ↓
才能构造当前链路的 Ethernet Frame
~~~

---

# 4. 贯穿全仓库的六个“防误解”原则

### ① DNS 不负责普通 HTTPS 默认端口

~~~text
https
 ↓
默认 443

shop.example.com
 ↓ DNS
IP 地址候选
~~~

### ② Happy Eyeballs 本身包含多个 connect 尝试

不是：

~~~text
先选好一个 IP
↓
再 connect
~~~

而是：

~~~text
地址排序
 ↓
connect 候选 A
 ↓ 短延迟仍未成功
connect 候选 B
 ↓
谁先可用就采用谁
~~~

### ③ Route 决定下一跳，ARP/NDP 再解决邻居

~~~text
目标 IP
 ↓
Route
 ↓
下一跳
 ↓
ARP (IPv4) / NDP (IPv6)
~~~

### ④ NAT/PAT 属于路由器边界

不是客户端 TCP 之前的一个“协议步骤”。

~~~text
Laptop 已经产生 TCP/IP 包
      ↓
当前链路发到 Router
      ↓
Router 做连接跟踪 / NAT-PAT
      ↓
公网继续转发
~~~

### ⑤ CA 有两个时间轴

~~~text
网站部署前：
CA 签发证书

用户访问时：
Server 发证书链
Browser 本地验链 + 验证 CertificateVerify
~~~

### ⑥ 协议封装顺序 ≠ 网络空间中的设备顺序

~~~text
封装：
HTTP → TLS → TCP → IP → L2

设备：
Laptop → Router → ISP → Server
~~~

这两张图不能混成同一种箭头。

---

# 5. 参考来源

主要以 [xiaolincoder/CS-Base network](https://github.com/xiaolincoder/CS-Base/tree/main/network) 补齐知识覆盖面，同时用 RFC / 标准资料校对容易讲错的协议细节。

具体见 [SOURCES.md](./SOURCES.md)。
