# 01｜从输入 URL 到网页返回：一条 HTTPS 请求到底经历了什么？

> 这一章是整个网络目录的“母图章节”。  
> 后续每一章只是把这里的一个框放大。

本章先使用一个明确假设：

> **浏览器最终使用 HTTP/1.1 或 HTTP/2 over TCP + TLS 1.3。**

HTTP/3 不走 TCP，它使用 QUIC/UDP，会在后续章节单独展开。

另外，文中的 203.0.113.0/24、198.51.100.0/24 等地址是专门用于文档示例的 TEST-NET 地址，不代表真实网站。

---

# 0. 先看参与者：不要把所有步骤塞进一根箭头

一次访问至少横跨这些角色：

~~~mermaid
flowchart LR
    B["Browser / App"]
    K["本机 OS Kernel"]
    NIC["本机 NIC"]
    R["家庭 Router"]
    I["ISP / Internet"]
    SN["Server Network"]
    SK["Server Kernel"]
    SP["Server Process / TLS / HTTP"]
    DNS["DNS System"]
    CA["CA / Trust PKI"]

    B -->|"名称解析请求"| DNS
    DNS -->|"A / AAAA"| B
    B -->|"socket / connect"| K
    K --> NIC
    NIC --> R
    R --> I --> SN --> SK --> SP
    SP -->|"response"| SK
    SK --> SN --> I --> R --> NIC --> K --> B
    CA -. "事先签发证书 / Trust Anchor" .-> SP
    CA -. "Root CA 预置信任" .-> B
~~~

这张图回答的是：

> **“谁在做事？”**

而下面的封装图回答的是另一件事：

~~~text
HTTP
 ↓
TLS
 ↓
TCP
 ↓
IP
 ↓
Ethernet / Wi-Fi
~~~

不要把“协议层次”和“设备经过顺序”混成同一种图。

---

# 1. URL：浏览器先确定“我要谁、用什么协议、要什么资源”

输入：

~~~text
https://shop.example.com/products?lang=zh-CN#reviews
~~~

可以拆成：

~~~text
https://  shop.example.com  :443  /products  ?lang=zh-CN  #reviews
│         │                  │     │          │            │
scheme    hostname           port  path       query        fragment
~~~

浏览器此时已经能知道：

~~~text
scheme   = https
hostname = shop.example.com
port     = 443        ← URL 没显式写时，由 HTTPS 默认值确定
path     = /products
query    = lang=zh-CN
fragment = reviews
~~~

关键点：

- DNS 通常负责 hostname → 地址；
- 443 通常不是 DNS 查出来的；
- fragment 通常只在浏览器本地使用，不随普通 HTTP 请求发给服务器。

浏览器已经知道“请求意图”：

~~~text
目标站点：shop.example.com
目标资源：/products?lang=zh-CN
协议：HTTPS
~~~

但现在还不能真正把 HTTP 数据发出去，因为：

~~~text
shop.example.com
~~~

还只是一个名字。

---

# 2. DNS：把 hostname 变成地址候选

## 2.1 先把 Stub Resolver 换成人话

第一遍学习时，可以先记：

> **本机名称解析系统 = 应用向外部 DNS 世界提问的入口。**

Stub Resolver 是这个入口中的一个经典角色称呼，不必把它想成某个固定的独立进程。

典型模型：

~~~mermaid
flowchart LR
    A["Browser"]
    L["本机名称解析系统<br/>browser / OS resolver policy"]
    H["hosts / local config"]
    C["OS / Browser Cache"]
    R["Recursive Resolver"]
    D["Root → TLD → Authoritative"]

    A --> L
    L --> H
    L --> C
    L -->|"本地无答案"| R
    R -->|"resolver cache miss"| D
~~~

不同浏览器、Windows/Linux/macOS、DoH 配置下，具体顺序和实现可能不同。这里先抓角色，不把一种实现写成所有机器的固定顺序。

## 2.2 hosts 与 Cache 不是一回事

hosts：

~~~text
127.0.0.1      shop.test
192.168.1.50   api.dev.test
~~~

本质是：

> 本机静态 hostname → IP 映射。

Windows 常见路径：

~~~text
C:\Windows\System32\drivers\etc\hosts
~~~

DNS Cache 则是：

> 以前查询到的 DNS Resource Record 临时保存。

例如：

~~~text
name  = shop.example.com
type  = A
value = 203.0.113.20
TTL   = 300
~~~

TTL 到期后，缓存不能永远继续当作当前答案。

## 2.3 Recursive Resolver 真正替客户端“查到底”

如果递归解析器也没缓存：

~~~text
Recursive Resolver
      │
      │ “shop.example.com 在哪？”
      ▼
Root
      │
      │ “.com 去问这些 TLD Server”
      ▼
.com TLD
      │
      │ “example.com 去问这些权威 DNS”
      ▼
example.com Authoritative DNS
      │
      ▼
A / AAAA / CNAME ...
~~~

注意：

- Root 主要负责顶层指路；
- TLD 继续指向域的权威 DNS；
- Authoritative DNS 才是这个 DNS zone 的权威记录来源；
- 现实中缓存命中很普遍，并不是每次请求都真的走完整 Root → TLD → Authoritative。

---

# 3. DNS 返回的可能不是一个 IP

假设结果中有：

~~~text
A     shop.example.com → 203.0.113.20
AAAA  shop.example.com → 2001:db8::20
~~~

所以现在不是：

~~~text
“DNS 给我一个 IP”
~~~

而更接近：

~~~text
“DNS 给我一组候选地址”
~~~

客户端还要决定：

> 哪个地址现在真的最适合建立连接？

---

# 4. 地址排序 + Happy Eyeballs：它本身就包含 connect 尝试

这里要特别纠正一个常见错误：

错误：

~~~text
地址排序
 ↓
Happy Eyeballs 先选出最终 IP
 ↓
socket/connect
~~~

更准确的是：

~~~mermaid
sequenceDiagram
    participant B as Browser
    participant K as OS / Network Stack
    B->>B: 对 A / AAAA 候选排序
    B->>K: connect(IPv6-A, 443)
    Note over B,K: 短延迟后仍未成功
    B->>K: connect(IPv4-A, 443)
    Note over B,K: 多个连接尝试可以短时间重叠
    K-->>B: IPv4-A 先成功
    B->>K: 采用 winning socket
    B->>K: 取消其余未完成尝试
~~~

所以 Happy Eyeballs 的核心不是：

> “无限同时连接所有 IP。”

而是：

> **候选地址排序后，错峰启动多个连接尝试，让不同地址族尽快获得竞争机会。**

假设最终 IPv4：

~~~text
203.0.113.20:443
~~~

先成功。

从这里开始，本章进入 **IPv4 主分支**。

---

# 5. IPv4 与 IPv6 从这里开始出现不同的邻居解析逻辑

整体：

~~~mermaid
flowchart TD
    H["Happy Eyeballs winning connection"]
    V4["IPv4 胜出"]
    V6["IPv6 胜出"]
    R4["Route"]
    A["ARP<br/>解析 IPv4 下一跳 MAC"]
    N["典型家庭 IPv4 可能经过 NAT/PAT"]
    R6["Route"]
    NDP["NDP / Neighbor Discovery"]
    I6["IPv6 Routing"]

    H --> V4 --> R4 --> A --> N
    H --> V6 --> R6 --> NDP --> I6
~~~

因此：

> **ARP 不是 IPv6 的邻居解析协议。**

后面主线为了讲清 NAT/PAT，继续使用 IPv4 分支。

---

# 6. socket 与临时端口：真正属于内核的是 Socket Object

浏览器网络组件请求：

~~~text
socket()
connect(203.0.113.20, 443)
~~~

概念关系：

~~~text
Browser Process
     │
     │ fd / socket handle
     ▼
Kernel Socket Object
     │
     ├─ local IP
     ├─ local port
     ├─ remote IP
     ├─ remote port
     ├─ send/receive buffers
     └─ TCP state
~~~

如果客户端没指定本地端口，OS 通常会选择一个临时端口：

~~~text
local  = 192.168.1.20:53124
remote = 203.0.113.20:443
~~~

所以不是：

~~~text
一个 Chrome 进程 = 一个端口
~~~

而是：

~~~text
一个进程
  ↓
可以持有很多 fd / socket
  ↓
每条 TCP 连接有自己的连接状态
~~~

TCP 连接常用四元组描述：

~~~text
源 IP
源端口
目的 IP
目的端口
~~~

---

# 7. connect() 之后，第一个 TCP SYN 已经开始产生

这是整条链最容易被画错的地方。

客户端内核准备：

~~~text
TCP Header
────────────────
src port = 53124
dst port = 443
SYN      = 1

IP Header
────────────────
src IP = 192.168.1.20
dst IP = 203.0.113.20
~~~

此时 TCP SYN 已经存在。

后面的：

~~~text
Route
ARP
Ethernet
NAT/PAT
Internet Routing
~~~

都是在想办法：

> **把这个 TCP SYN 真正运输到目标。**

不是“这些全部完成后才开始 TCP”。

---

# 8. Route：先决定下一跳

本机先查路由表。

例如：

~~~text
192.168.1.0/24    directly connected
0.0.0.0/0         via 192.168.1.1
~~~

目标：

~~~text
203.0.113.20
~~~

不在本地网段，于是：

~~~text
next hop = 192.168.1.1
~~~

必须区分：

~~~text
最终目标 IP：
203.0.113.20

当前下一跳：
192.168.1.1
~~~

## 8.1 如果目标就在本地子网呢？

假如：

~~~text
本机   192.168.1.20/24
目标   192.168.1.50
~~~

那么：

~~~text
Route
 ↓
目标属于本地直连网段
 ↓
下一跳就是 192.168.1.50 本身
~~~

因此：

> **ARP 不是永远找默认网关。ARP 找的是当前 IPv4 下一跳。**

---

# 9. ARP：把“下一跳 IPv4”变成当前以太网需要的 MAC

当前例子中：

~~~text
next hop = 192.168.1.1
~~~

如果 ARP/neighbor cache 没有答案，就需要在当前广播域询问：

~~~text
“谁是 192.168.1.1？”
~~~

得到：

~~~text
192.168.1.1
→ AA:BB:CC:DD:EE:FF
~~~

于是这一跳的 Frame 可以形成：

~~~text
Ethernet
────────────────
src MAC = Laptop MAC
dst MAC = Router LAN MAC

IP
────────────────
src IP = 192.168.1.20
dst IP = 203.0.113.20

TCP
────────────────
src port = 53124
dst port = 443
SYN      = 1
~~~

一句话：

~~~text
Route：
目标 IP → 下一跳

ARP：
IPv4 下一跳 → 下一跳 MAC
~~~

---

# 10. 包离开 Laptop，进入家庭路由器

这里必须画参与者边界：

~~~text
┌──────────── Laptop ────────────┐

TCP SYN
  ↓
IP
  ↓
Route
  ↓
ARP
  ↓
Ethernet Frame

└──────────────┬─────────────────┘
               │
               ▼
┌────────── Home Router ─────────┐

LAN 口收到 Frame
  ↓
处理 IP 包
  ↓
Routing / Conntrack
  ↓
可能执行 NAT/PAT
  ↓
选择 WAN 出口
  ↓
构造下一链路发送形式

└──────────────┬─────────────────┘
               ▼
            Internet
~~~

所以 NAT/PAT 不是：

> “Browser 或 Laptop 在 TCP 之前执行的步骤。”

它属于中间路由/NAT 设备处理已经存在的包。

---

# 11. NAT/PAT：一次状态化连接映射

原始连接：

~~~text
192.168.1.20:53124
        →
203.0.113.20:443
~~~

典型家庭 IPv4 NAPT/PAT 可能建立：

~~~text
inside:
192.168.1.20:53124

        ↕

outside:
198.51.100.8:62001
~~~

然后公网侧看到：

~~~text
198.51.100.8:62001
        →
203.0.113.20:443
~~~

不要机械画成：

~~~text
NAT
 ↓
PAT
~~~

更准确是：

> **同一次连接映射里，设备可能同时重写源地址和源端口。**

而且端口不一定每次都必须变化，具体映射取决于 NAT 实现和当前映射冲突情况。

## 11.1 为什么 PAT 有价值

私网中：

~~~text
192.168.1.10:50000
192.168.1.20:50000
~~~

并不天然冲突，因为源 IP 不同。

但它们都共享一个公网 IP 后，如果公网表示完全相同：

~~~text
198.51.100.8:50000
~~~

设备就难以维持不同连接的映射。

于是可以：

~~~text
192.168.1.10:50000 → 198.51.100.8:62001
192.168.1.20:50000 → 198.51.100.8:62002
~~~

PAT 的核心是：

> **让多个内部连接共享有限公网地址时仍能被区分和反向映射。**

---

# 12. Internet Routing：目标 IP 让包逐跳靠近目标网络

公网包大致：

~~~text
src = 198.51.100.8
dst = 203.0.113.20
~~~

路径可能：

~~~text
Home Router
   ↓
ISP Access Router
   ↓
ISP Core
   ↓
其他 AS
   ↓
目标网络
   ↓
Server / Edge
~~~

BGP 可以先记成：

> **自治系统之间传播“哪些 IP 前缀通过哪里可以到达”的路由信息。**

真正某个数据包到了路由器时，核心动作更接近：

~~~text
读取 dst IP
   ↓
查本地转发表 / FIB
   ↓
确定下一跳和出接口
   ↓
继续转发
~~~

MAC/L2 头是逐链路的；跨路由后会重新形成下一段链路所需的 L2 信息。

---

# 13. 服务端：443 不是“一个抽象号码”，它对应内核里的监听状态

包到达 Server 后：

~~~mermaid
flowchart TD
    N["Server NIC"]
    IP["Kernel IP"]
    TCP["Kernel TCP"]
    L["443 LISTEN Socket"]
    SYNQ["SYN / 半连接状态"]
    AQ["Accept Queue"]
    A["accept()"]
    C["Connected Socket"]
    P["Nginx / Server Process"]

    N --> IP --> TCP --> L --> SYNQ
    SYNQ -->|"三次握手完成"| AQ
    AQ --> A --> C --> P
~~~

服务端程序事先做了类似：

~~~text
socket()
bind(..., 443)
listen()
~~~

于是内核知道：

> 发给本机 TCP 443 的新连接请求，可以匹配这个 LISTEN socket。

三次握手完成后，内核维护一条已建立连接；服务端程序通过 accept() 获得一个用于这条连接的 connected socket。

真实生产环境里，443 可能终止在 CDN、负载均衡器、Nginx 或网关，而不是最终业务进程；后端拓扑章节会再展开。

---

# 14. TCP 三次握手：Route/ARP/NAT 一直在搬运这些报文

~~~mermaid
sequenceDiagram
    participant C as Client Kernel
    participant R as Router / Internet
    participant S as Server Kernel

    C->>R: SYN
    R->>S: 转发后的 SYN
    S->>R: SYN + ACK
    R->>C: 返回 SYN + ACK
    C->>R: ACK
    R->>S: 转发后的 ACK
    Note over C,S: TCP ESTABLISHED
~~~

所以：

~~~text
TCP SYN
  ↓
Route / ARP / NAT / Internet
  ↓
Server
~~~

而不是：

~~~text
Route / NAT 全部结束
  ↓
TCP 才开始
~~~

---

# 15. TLS 与 CA：一定要分两个时间轴

## 15.1 时间轴 A：用户访问网站之前，证书已经签发

~~~mermaid
sequenceDiagram
    participant Site as 网站运营方
    participant CA as CA / Intermediate CA
    participant Server as Server
    participant Trust as Browser / OS Trust Store

    Site->>CA: 申请证书 + 域名控制验证
    CA-->>Site: 签发 Server Certificate
    Site->>Server: 部署 Certificate + Private Key
    CA-->>Trust: Root CA 通过系统/浏览器机制预置信任
~~~

所以 CA 不是：

~~~text
每次用户打开网站
↓
浏览器实时问：
“CA，这网站今天能访问吗？”
~~~

吊销检查、OCSP/CRL 等属于额外机制，后续 TLS 章节再展开。

---

# 16. TLS 1.3：密钥协商与身份认证是两条不同逻辑

先记住两类密钥材料。

## 16.1 ECDHE 临时 key share

解决：

> **这一次连接如何建立共享秘密并派生对称密钥？**

~~~text
Client ephemeral key_share
            +
Server ephemeral key_share
            ↓
ECDHE Shared Secret
            ↓
HKDF 等派生
            ↓
Handshake / Application Traffic Keys
~~~

## 16.2 证书中的身份公钥

解决：

> **对面是否真的持有这个证书对应的私钥？**

~~~text
Server Private Key
        │
        │ 签名 handshake transcript
        ▼
CertificateVerify
        │
        │ Browser 用证书中的 Server Public Key 验证
        ▼
证明服务器持有对应私钥
~~~

不要把：

~~~text
ECDHE key_share
~~~

和：

~~~text
Certificate Public Key
~~~

混成同一个“服务器公钥”。

---

# 17. TLS 1.3 运行时流程

~~~mermaid
sequenceDiagram
    participant B as Browser
    participant S as Server

    B->>S: ClientHello<br/>versions / cipher_suites / SNI / ALPN / key_share
    S-->>B: ServerHello<br/>selected version / cipher / server key_share
    Note over B,S: 双方可基于 ECDHE 派生握手密钥
    S-->>B: EncryptedExtensions
    S-->>B: Certificate
    S-->>B: CertificateVerify
    S-->>B: Finished
    Note over B: 验证 hostname/SAN、有效期、证书链<br/>CertificateVerify、Server Finished
    B->>S: Finished
    Note over B,S: TLS 1.3 secure channel established
~~~

这里要注意：

> Browser 不是“等 Server Finished 到了之后才突然开始想起验链”。

更准确地说，它在处理服务器这组握手消息时，完成证书链、服务器私钥持有证明和握手完整性验证；通过后才发送客户端 Finished。

---

# 18. SNI 和 ALPN 分别解决什么

## SNI

ClientHello 中：

~~~text
SNI = shop.example.com
~~~

解决：

> 同一个 IP:443 上可能有多个 HTTPS 站点，服务器需要知道你想访问哪个 hostname。

经典 TLS 1.3 中 SNI 位于 ClientHello 扩展里；ECH 属于后续进阶内容。

## ALPN

客户端声明：

~~~text
h2
http/1.1
~~~

服务端选择支持的应用协议。

所以 TLS 不只在“加密”，它也帮助确定：

> TLS 上面最终跑 HTTP/2 还是 HTTP/1.1 等协议。

---

# 19. 浏览器怎么验证证书链

服务器通常发送：

~~~text
Server Certificate
Intermediate Certificate(s)
~~~

Root CA 通常不需要由服务器发送，因为浏览器/OS Trust Store 已经有信任锚。

逻辑：

~~~text
Server Certificate
       │
       │ issuer / signature
       ▼
Intermediate CA
       │
       │ 最终构造到
       ▼
Trusted Root CA
       │
       ▼
Local Trust Store
~~~

浏览器还要检查：

- SAN/hostname 是否匹配 shop.example.com；
- 当前时间是否在有效期；
- 证书链签名与策略是否可接受；
- CertificateVerify 是否正确；
- Server Finished 是否正确；
- 其他实现相关策略和可选吊销信息。

---

# 20. HTTP：现在业务请求才真正通过安全通道发送

HTTP/1.1 的逻辑示例：

~~~http
GET /products?lang=zh-CN HTTP/1.1
Host: shop.example.com
User-Agent: ...
Accept: ...
~~~

但在线路上，旁路设备看到的主要是 TLS Application Data，而不是这些 HTTP 明文。

如果 ALPN 选择 h2，那么实际使用 HTTP/2 帧，不是 HTTP/1.1 文本格式；业务语义仍然是：

> 请求 shop.example.com 的某个资源。

---

# 21. 返回方向：NAT 映射和 Socket 状态让数据找到原来的应用

公网响应来到：

~~~text
dst = 198.51.100.8:62001
~~~

家庭 NAT 设备查已有映射：

~~~text
198.51.100.8:62001
        ↕
192.168.1.20:53124
~~~

于是把包送回内部主机。

本机收到后：

~~~text
NIC
 ↓
IP
 ↓
TCP
 ↓
根据连接状态定位 Socket
 ↓
Receive Buffer
 ↓
Browser fd / socket handle
 ↓
Browser
~~~

所以“包回来”不是靠猜：

> NAT 有映射状态，TCP 有连接状态，内核有 socket 对象。

---

# 22. 最终把整条链压缩成一张母图

~~~text
【上网前置】
DHCP / 静态配置
 ↓
本机 IP / Subnet / Gateway / DNS Server

【Browser】
URL
 ↓
名称解析
 ↓
A / AAAA
 ↓
地址排序
 ↓
Happy Eyeballs
 ├─ connect IPv6
 └─ connect IPv4
 ↓
winning socket

【Client Kernel】
TCP SYN
 ↓
IP
 ↓
Route
 ↓
ARP (IPv4) / NDP (IPv6)
 ↓
NIC

【Home Router：典型 IPv4】
L2 Receive
 ↓
Routing / Conntrack
 ↓
NAT/PAT
 ↓
WAN

【Internet】
ISP / AS / forwarding
 ↓
Server Network

【Server Kernel】
NIC
 ↓
IP
 ↓
TCP 443 LISTEN
 ↓
握手完成
 ↓
Connected Socket

【TLS】
ClientHello
 ↓
ServerHello / ECDHE
 ↓
Certificate
 ↓
CertificateVerify
 ↓
Finished
 ↓
Browser 验证通过
 ↓
Client Finished

【HTTP】
Request
 ↓
Response
~~~

---

# 23. 最容易混淆的 12 个点

1. 域名不是 IP + 端口。
2. HTTPS 默认 443 通常不是 DNS 返回的。
3. Stub Resolver 是角色，不必等价成独立进程。
4. hosts 是静态映射，不是普通 DNS Cache。
5. Happy Eyeballs 本身就在发起多个错峰 connect 尝试。
6. 客户端临时端口由 OS 管理并关联 socket，不是“Chrome 固定暴露一个端口”。
7. TCP SYN 在 Route / ARP / NAT 之前已经产生。
8. Route 决定下一跳；ARP 解析当前 IPv4 下一跳，不是永远找网关。
9. IPv6 不用 ARP，而使用 NDP 等邻居发现机制。
10. NAT/PAT 属于中间路由/NAT 设备，不属于 Browser 的“下一层协议”。
11. CA 主要事先签发；TLS 运行时主要由 Browser 与 Server 完成握手和本地验链。
12. HTTPS 不代表必须 TCP；HTTP/3 使用 QUIC/UDP。

---

# 24. 自测

1. 为什么 Happy Eyeballs 不能画成“选完 IP → 再 connect”？
2. TCP SYN 已经生成后，Route 和 ARP 分别解决什么问题？
3. 如果目标是 192.168.1.50，而本机是 192.168.1.20/24，ARP 应该问谁？
4. 为什么 NAT/PAT 必须画在 Home Router 的参与者边界里？
5. Server 的 LISTEN socket 和三次握手完成后的 connected socket 是什么关系？
6. TLS 1.3 中 ECDHE key share 与证书公钥分别解决什么问题？
7. 为什么 Root CA 通常不需要服务器每次都发给浏览器？
8. 为什么 HTTPS 不能简单记成 HTTP → TLS → TCP 的唯一实现？

---

# 25. 下一步怎么学

如果你还不知道：

> 为什么 HTTP、TLS、TCP、IP、Ethernet 可以一层套一层？  
> 用户进程调用 send() 后，数据究竟怎么进入内核、驱动和网卡？

下一章应该进入：

> **02｜网络分层、封装与 OS 收发网络包**

在那里再展开：

~~~text
User Process
 ↓ syscall
Socket
 ↓
TCP
 ↓
IP / Route / Netfilter
 ↓
Neighbor
 ↓
qdisc / Driver
 ↓
TX Ring / DMA
 ↓
NIC
~~~
