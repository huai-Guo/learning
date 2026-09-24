# 01｜从输入 URL 到网页返回：先把整条链串起来

> 这一章只解决一个问题：
>
> **在浏览器输入 `https://shop.example.com/products` 后，为什么另一个网络里的服务器最终能把页面返回给我？**

这章是整个目录的“地图”。后面的 DNS、IP、TCP、TLS、HTTP 都会再单独深入，但先把它们放回正确的因果顺序。

---

## 0. 先看全局：不要把协议背成互不相关的名词

```text
用户输入 URL
https://shop.example.com/products
        │
        ▼
① URL 解析
        │
        ├─ scheme = https
        ├─ host   = shop.example.com
        ├─ port   = 443（默认）
        └─ path   = /products
        │
        ▼
② DNS：名字 → 地址候选
        │
        ├─ A     → IPv4
        └─ AAAA  → IPv6
        │
        ▼
③ 地址排序 + Happy Eyeballs
        │
        ▼
假设选中 203.0.113.20:443
        │
        ▼
④ socket() / connect()
        │
        ├─ OS 创建内核 socket
        └─ 分配客户端临时端口 53124
        │
        ▼
⑤ TCP 生成 SYN
        │
        ▼
⑥ IP：dst = 203.0.113.20
        │
        ▼
⑦ Route：这包下一跳给谁？
        │
        └─ next hop = 192.168.1.1
        │
        ▼
⑧ ARP：192.168.1.1 的 MAC 是谁？
        │
        ▼
⑨ Ethernet：发给默认网关 MAC
        │
        ▼
⑩ 家庭路由器 NAT/PAT
        │
        ├─ 192.168.1.20:53124
        │        ↓
        └─ 198.51.100.8:62001
        │
        ▼
⑪ Internet Routing
        │
        ▼
目标服务器 203.0.113.20:443
        │
        │ SYN / SYN-ACK / ACK
        ▼
⑫ TCP ESTABLISHED
        │
        ▼
⑬ TLS 1.3
        │
        ├─ ClientHello：SNI / ALPN / key_share
        ├─ ServerHello
        ├─ ECDHE 派生密钥
        ├─ Certificate
        ├─ CertificateVerify
        ├─ 浏览器验证证书链
        └─ Finished
        │
        ▼
⑭ HTTP Request
        │
        ▼
⑮ HTTP Response
        │
        ▼
浏览器解析 HTML / CSS / JS 并继续请求资源
```

先记住一个重要修正：

> Route、ARP、NAT、互联网路由并不是“TCP 之前才做完的准备工作”。  
> 当浏览器调用 `connect()` 后，客户端已经要发出 TCP SYN；这些网络机制是在**把这个 SYN 运送到服务器**。

---

# 1. URL：浏览器先确定“我要访问谁、用什么协议、要什么资源”

输入：

```text
https://shop.example.com/products?lang=zh-CN#reviews
```

可以拆成：

```text
https:// shop.example.com :443 /products ?lang=zh-CN #reviews
│        │                 │    │         │           │
scheme   hostname          port path      query       fragment
```

其中：

- `https`：决定协议语义，也给出默认端口 `443`；
- `shop.example.com`：hostname，后面需要解析成 IP；
- `443`：如果 URL 没显式写，HTTPS 使用默认值；
- `/products`：HTTP 请求路径；
- `query`：通常会进入 HTTP 请求；
- `fragment`：通常由浏览器本地处理，不随普通 HTTP 请求发给服务器。

所以浏览器在 DNS 前其实已经知道：

```text
hostname = shop.example.com
port     = 443
```

它缺的是：

```text
IP = ?
```

**DNS 通常不是用来告诉浏览器“443”的。**

---

# 2. DNS：把人类使用的名字变成网络可以使用的地址

## 2.1 Stub Resolver 到底是什么

不要把 Stub Resolver 想成另一台 DNS 服务器。

它更适合记成：

> **本机轻量 DNS 客户端 / 名称解析入口。**

概念流程：

```text
Chrome
  │
  │ “帮我解析 shop.example.com”
  ▼
本机名称解析系统（Stub Resolver 角色）
  │
  ├─ 本地配置 / hosts
  ├─ OS DNS Cache
  │
  └─ 本地没有
        │
        ▼
通过网络询问 Recursive Resolver
```

不同浏览器和操作系统实现可能不同；现代浏览器还可能使用自己的解析器或 DoH。这里先掌握角色关系。

## 2.2 缓存可能在哪里

不是只有一个“DNS Cache”。

常见层次：

```text
Browser 自己的缓存
        ↓
OS DNS Cache
        ↓
本地网络设备可能存在的缓存/转发
        ↓
Recursive Resolver Cache
        ↓
真正查询 DNS 层级
```

缓存的本质是 DNS Resource Record，例如：

```text
name  = shop.example.com
type  = A
value = 203.0.113.20
TTL   = 300
```

TTL 表示这条记录可以缓存多久。

## 2.3 hosts 是什么

Windows 常见路径：

```text
C:\Windows\System32\drivers\etc\hosts
```

例如：

```text
127.0.0.1    shop.test
192.168.1.50 api.dev.test
```

hosts 是：

> **本机人工维护的 hostname → IP 静态映射。**

它不是普通 DNS Cache，也不能写：

```text
1.2.3.4:8080 test.com
```

因为 hosts 解决的是 hostname → IP，不负责端口。

## 2.4 Recursive Resolver 才是替你“查到底”的角色

如果本地没有：

```text
Laptop
   │
   │ DNS Query
   ▼
Recursive Resolver
   │
   ├─ 自己缓存里有 → 直接返回
   │
   └─ 没有
        ↓
       Root
        ↓ “.com 去问这些服务器”
     .com TLD
        ↓ “example.com 去问它的权威 DNS”
Authoritative DNS
        ↓
A / AAAA 最终记录
```

Root 和 TLD 更多是在**指路**。

Authoritative DNS 才是某个域名区域记录的权威来源。

---

# 3. A / AAAA 与 Happy Eyeballs：DNS 可能给你不止一个 IP

DNS 可能返回：

```text
A     → 203.0.113.20
AAAA  → 2001:db8::20
```

其中：

- A = IPv4；
- AAAA = IPv6。

客户端会先根据地址选择策略得到候选顺序，再使用类似 Happy Eyeballs 的策略避免“IPv6 看起来可用但实际很慢”导致长时间等待。

它不是：

```text
所有地址一次性无限并发 connect()
```

更接近：

```text
IPv6-A  ───────────────► 尝试
            │
            │ 短延迟后仍未成功
            ▼
IPv4-A      ───────────► 加入竞争
                 │
                 ├─ 谁先成功就采用谁
                 └─ 其他尝试取消
```

假设最终：

```text
203.0.113.20
```

胜出。

再加上 URL 中已经确定的：

```text
port = 443
```

最终远端目标是：

```text
203.0.113.20:443
```

---

# 4. socket 与临时端口：端口不是“进程自己暴露的一根线”

浏览器的网络组件会调用类似：

```text
socket()
connect(203.0.113.20, 443)
```

概念关系：

```text
浏览器进程
    │
    │ fd / socket handle
    ▼
内核 Socket Object
    │
    ├─ local IP
    ├─ local port
    ├─ remote IP
    ├─ remote port
    └─ TCP state
```

客户端如果没有主动指定本地端口，OS 通常会分配临时端口，例如：

```text
local  = 192.168.1.20:53124
remote = 203.0.113.20:443
```

因此不是：

```text
Chrome 一个进程固定占一个端口
```

而是：

```text
一个进程
  ↓
可以持有很多 fd / socket
  ↓
每条连接都有自己的地址与状态
```

TCP 连接常用四元组区分：

```text
源 IP
源端口
目标 IP
目标端口
```

---

# 5. TCP SYN 已经产生，接下来 Route / ARP 是在帮它出门

客户端准备第一个 TCP 握手报文：

```text
TCP Header
────────────────
src port = 53124
dst port = 443
SYN = 1

IP Header
────────────────
src IP = 192.168.1.20
dst IP = 203.0.113.20
```

现在有一个问题：

> 网卡第一跳究竟把这个 IP 包交给谁？

---

# 6. Route：先决定下一跳是谁

OS 查本机路由表。

例如：

```text
192.168.1.0/24   直接连接
0.0.0.0/0        via 192.168.1.1
```

目标：

```text
203.0.113.20
```

不属于本地 `192.168.1.0/24`，于是使用默认路由：

```text
next hop = 192.168.1.1
```

因此必须区分：

```text
最终目标：
203.0.113.20

当前下一跳：
192.168.1.1
```

---

# 7. ARP：知道下一跳 IP 后，再找下一跳 MAC

在 IPv4 Ethernet 场景中，当前链路发帧需要目标 MAC。

所以才进行：

```text
“谁是 192.168.1.1？”
```

ARP 请求通常在当前广播域广播。

假设得到：

```text
192.168.1.1
→ AA:BB:CC:DD:EE:FF
```

于是第一跳可以构造：

```text
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
SYN = 1
```

一句话：

```text
Route：
最终 IP → 下一跳 IP

ARP：
下一跳 IPv4 → 下一跳 MAC
```

**ARP 不是去找远端服务器的 MAC。**

---

# 8. NAT/PAT：路由器把“私网连接”映射成“公网连接”

家庭路由器收到第一跳 Ethernet Frame 后，会处理其中的 IP/TCP 报文。

出站前可能建立一次状态化映射：

```text
转换前：

192.168.1.20:53124
        →
203.0.113.20:443


NAT/PAT 映射：

192.168.1.20:53124
        ↕
198.51.100.8:62001


转换后：

198.51.100.8:62001
        →
203.0.113.20:443
```

这里不要机械理解为：

```text
先经过一个 NAT 步骤
↓
再经过一个 PAT 步骤
```

家用场景更常见的理解是 NAPT/PAT：

> 在同一次连接映射中，同时可能重写源 IP 和源端口。

而且 PAT 不保证每次都必须修改源端口；如果能够安全保留，也可能保留原端口。

为什么要使用端口映射？

因为很多内网设备：

```text
192.168.1.10:50000
192.168.1.20:50000
192.168.1.30:50000
```

都可能共享：

```text
198.51.100.8
```

公网侧需要继续区分这些连接，所以可以映射成：

```text
198.51.100.8:62001
198.51.100.8:62002
198.51.100.8:62003
```

PAT 不是用来修补“私网 TCP 自己会冲突”的问题。

---

# 9. Internet Routing：之后是一跳一跳把 IP 包送向目标网络

公网侧：

```text
198.51.100.8:62001
        →
203.0.113.20:443
```

可能经历：

```text
家庭 Router
    ↓
ISP 接入路由器
    ↓
运营商骨干
    ↓
其他 AS
    ↓
目标网络
    ↓
203.0.113.20
```

BGP 的核心角色可以先记成：

> 大型自治系统之间传播“哪些 IP 前缀可以从哪里到达”的路由信息。

真正的数据包转发时，路由器通常基于已经形成的转发表决定下一跳。

每经过一个 L2 链路：

```text
MAC Header 会变化
```

而：

```text
最终目标 IP 通常仍然指向 203.0.113.20
```

NAT 是“源 IP 可能变化”的典型例外。

---

# 10. TCP 三次握手：前面的 Route / ARP / NAT 都是在搬运这些 TCP 报文

正确时序：

```text
Client                                      Server
  │                                            │
  │ SYN                                        │
  ├───────────────────────────────────────────►│
  │   中间经过 Route / ARP / NAT / Internet   │
  │                                            │
  │ SYN + ACK                                  │
  │◄───────────────────────────────────────────┤
  │                                            │
  │ ACK                                        │
  ├───────────────────────────────────────────►│
  │                                            │
  │              ESTABLISHED                   │
```

所以不能画成：

```text
NAT
↓
Internet
↓
TCP 才开始
```

真正是：

```text
TCP SYN
↓
通过网络被运过去
↓
Server 收到
```

---

# 11. TLS 与 CA：必须分成两个时间轴

## 11.1 时间轴 A：网站上线前，CA 事先签发证书

```text
网站运营方
    │
    │ 生成/准备服务器密钥材料
    ▼
申请证书
    │
    ▼
CA 验证域名控制权
    │
    ▼
CA / Intermediate CA 签发
    │
    ▼
Server Certificate
```

服务器提前保存：

```text
Server Private Key
Server Certificate
Intermediate Certificate(s)
```

而浏览器 / OS 的 Trust Store 里提前存在受信任 Root CA。

所以 CA 一般不是：

```text
每次用户访问网站
→ 浏览器实时问 CA“这个服务器能不能放行？”
```

吊销检查（OCSP/CRL 等）属于额外机制，后续章节再展开。

## 11.2 时间轴 B：真正建立 TLS 1.3 连接

TCP 建立后：

```text
Browser                                      Server
   │                                            │
   │ ① ClientHello                              │
   │───────────────────────────────────────────►│
   │ TLS 版本                                   │
   │ cipher suites                              │
   │ SNI = shop.example.com                     │
   │ ALPN = h2, http/1.1                        │
   │ key_share = Client ECDHE Public Key        │
   │                                            │
   │ ② ServerHello                              │
   │◄───────────────────────────────────────────│
   │ selected version / cipher                  │
   │ Server ECDHE Public Key                    │
   │                                            │
   │ 双方通过 ECDHE 派生共享密钥材料             │
   │                                            │
   │ ③ EncryptedExtensions                      │
   │◄───────────────────────────────────────────│
   │                                            │
   │ ④ Certificate                              │
   │◄───────────────────────────────────────────│
   │ Server Cert + Intermediate Cert(s)         │
   │                                            │
   │ ⑤ CertificateVerify                        │
   │◄───────────────────────────────────────────│
   │ Server 用证书对应私钥签握手 transcript      │
   │ Browser 用证书公钥验证                      │
   │                                            │
   │ ⑥ Finished                                 │
   │◄───────────────────────────────────────────│
   │                                            │
   │ ⑦ Browser 本地验证证书链并发送 Finished     │
   │───────────────────────────────────────────►│
   │                                            │
   │          TLS secure channel                │
```

## 11.3 SNI 是干什么的

很多域名可以共享：

```text
同一个 IP:443
```

所以服务器在 TLS 握手早期需要知道：

```text
你到底访问哪个 hostname？
```

ClientHello 中：

```text
SNI = shop.example.com
```

帮助服务器选择对应虚拟主机、证书和配置。

## 11.4 ALPN 是干什么的

ClientHello 可以声明：

```text
我支持：
h2
http/1.1
```

服务器通过 ALPN 协商最终应用层协议。

## 11.5 证书到底证明什么

浏览器主要检查：

```text
Server Certificate
        │
        │ 被 Intermediate CA 签名
        ▼
Intermediate CA Certificate
        │
        │ 最终链到
        ▼
Root CA
        │
        ▼
本机 Trust Store
```

同时检查：

- SAN 是否匹配 `shop.example.com`；
- 证书是否在有效期；
- 签名链是否有效；
- CertificateVerify 是否证明服务器确实持有对应私钥；
- 其他策略与可选吊销检查。

重要：

> HTTPS 大量业务数据通常使用 TLS 协商出来的**对称密钥**加密，不是拿证书公钥逐个 HTTP 包做非对称加密。

---

# 12. HTTP：终于开始发送“我要哪个资源”

TLS 建立后，HTTP 请求进入加密通道。

HTTP/1.1 示例：

```http
GET /products HTTP/1.1
Host: shop.example.com
User-Agent: ...
Accept: ...
```

如果使用 HTTP/2，则语法和帧结构不同，但逻辑上仍然是在表达：

```text
我要 shop.example.com 的 /products
```

服务器返回：

```http
HTTP/1.1 200 OK
Content-Type: text/html
...
```

线上传输时，这些内容位于 TLS Application Data 中，旁路中间设备通常不能直接看到 HTTP 明文内容。

---

# 13. 返回方向：不是“原样倒放”，但核心状态会帮助它回来

例如公网服务器返回：

```text
203.0.113.20:443
        →
198.51.100.8:62001
```

家庭 NAT Router 根据已有映射：

```text
198.51.100.8:62001
        ↕
192.168.1.20:53124
```

转换并送回：

```text
192.168.1.20:53124
```

本机 TCP 协议栈根据连接信息定位相应 socket，把数据放到 socket 接收缓冲区，浏览器网络组件再读取。

---

# 14. 一张“参与者地图”

```text
┌──────────────────────────── 本机 ────────────────────────────┐
│                                                              │
│ Browser                                                      │
│   │ URL / HTTP / TLS                                         │
│   ▼                                                          │
│ OS Socket / TCP / IP / Route                                 │
│   │                                                          │
│   ├─ DNS Resolver                                            │
│   ├─ TCP state                                               │
│   ├─ Route table                                             │
│   └─ ARP / neighbor cache                                    │
│   ▼                                                          │
│ NIC                                                          │
└───┬──────────────────────────────────────────────────────────┘
    │ Ethernet / Wi-Fi
    ▼
Home Router
    │
    ├─ Routing
    ├─ NAT/PAT
    └─ WAN
    │
    ▼
ISP / Internet Routers / BGP
    │
    ▼
Server Network
    │
    ▼
Web Server
    │
    ├─ TCP
    ├─ TLS cert + private key
    └─ HTTP
```

DNS Authoritative Server 和 CA 并不等于 Web Server，它们分别参与：

```text
DNS：
“这个名字对应哪些地址？”

CA：
“这个证书与公钥经过可信签发链背书。”
```

---

# 15. 最容易混淆的 10 个点

1. **域名 ≠ IP + 端口**：域名是名字；DNS 通常把名字解析到地址；端口通常来自 URL/protocol。
2. **客户端临时端口不是 listen 端口**：客户端主动 connect，服务端通常固定 listen 443。
3. **端口不直接“属于进程”**：OS 管理 socket；进程通过 fd/socket handle 使用。
4. **DNS 不是每次都查 Root**：大量查询会在各层缓存命中。
5. **Stub Resolver 不是全球 DNS 查询器**：它是本机轻量解析角色。
6. **Happy Eyeballs 不是无限并发所有 IP**：是排序后的错峰竞争。
7. **ARP 找的是下一跳 MAC**：远端目标不在当前广播域时，不会 ARP 最终服务器。
8. **PAT 不是因为私网 TCP 本来会冲突**：是为了让多个内网连接共享公网 IP 后仍可区分。
9. **TCP SYN 在 Route/ARP/NAT 前已经存在**：后者是在把 SYN 送出去。
10. **CA 通常不在每次 TLS 主握手中实时批准**：证书提前签发，浏览器主要在本地验链。

---

# 16. 一句话记忆

```text
URL 告诉浏览器“我要谁的什么资源”
DNS 把名字变成地址候选
Happy Eyeballs 选出可用地址
Socket 给应用一个使用内核网络能力的入口
TCP 建连接并提供可靠字节流
IP 决定最终目标
Route 决定下一跳
ARP 找下一跳 MAC
Ethernet/Wi-Fi 完成当前链路传输
NAT/PAT 把私网连接映射为公网连接
互联网路由让包逐跳接近目标
TLS 建立机密性、完整性与身份认证
HTTP 表达真正的业务请求
```

---

# 17. 自测

1. 访问 `https://example.com` 时，443 是 DNS 查出来的吗？
2. 为什么已经知道 `203.0.113.20`，还不能立刻把 Ethernet Frame 的目标 MAC 写成远端服务器 MAC？
3. 两台内网电脑都使用源端口 50000，为什么在私网里不会天然冲突？经过一个公网 NAT 后又为什么可能需要 PAT？
4. TCP SYN、ARP、NAT 三者的真实时序是什么？
5. TLS 1.3 中，证书公钥、ECDHE key share、最终对称业务密钥分别解决什么问题？
6. 为什么 CA 不需要在每次用户访问网站时实时“批准”一次？

---

# 18. 下一章

下一章会暂时停止继续加协议名词，先回答一个更基础的问题：

> **HTTP、TLS、TCP、IP、Ethernet 到底是怎么一层一层套起来的？所谓“网络分层”究竟是在分什么？**

见后续：`02-network-model-and-packets.md`。
