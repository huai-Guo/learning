# 06｜HTTP/2、HTTP/3、QUIC、WebSocket、RPC：现代协议到底在解决什么问题？

> 这一章不按“协议名单”背知识，而沿着一条因果链：
>
> **HTTP/1.1 哪里不够 → HTTP/2 为什么引入 Frame / Stream → 为什么 TCP 仍会拖住多个 Stream → QUIC 为什么重做传输能力 → HTTP/3 如何建立在 QUIC 上 → WebSocket 和 RPC 又分别解决什么问题。**

---

# 0. 先看全景

~~~text
HTTP/1.1
  │
  │ 文本 framing、并发能力有限、重复 Header
  ▼
HTTP/2
  │
  │ Binary Frame
  │ Stream
  │ Multiplexing
  │ HPACK
  ▼
仍然跑在 TCP
  │
  │ TCP Byte Stream 必须有序交付
  │ 一处丢包可能拖住同连接的多个 HTTP/2 Stream
  ▼
QUIC
  │
  │ UDP 上重新实现：
  │ Reliability / ACK / Loss Recovery
  │ Congestion Control / Flow Control
  │ Independent Streams
  │ TLS 1.3 Integration
  │ Connection ID
  ▼
HTTP/3
~~~

旁边还有两条并非“HTTP 版本升级”的分支：

~~~text
WebSocket
→ 长时间双向消息通信

RPC
→ 把远程网络交互包装成方法调用
~~~

所以：

> **HTTP/2、HTTP/3 是 HTTP 的演进；WebSocket 是双向消息协议；RPC 是更高层的调用抽象。**

---

# 1. HTTP/1.1 到底哪里不够？

HTTP/1.1 已支持 Persistent Connection：

~~~text
一个 TCP Connection
  ├─ Request 1 / Response 1
  ├─ Request 2 / Response 2
  └─ Request 3 / Response 3
~~~

但同一连接仍围绕 Request/Response 顺序工作。HTTP pipelining 虽然存在，但 Response 顺序、部署兼容等问题使它长期没有成为浏览器主流并发方案。

因此浏览器历史上常通过：

~~~text
同一 Origin 建多个 TCP Connections
~~~

提高并发。

代价是更多 TCP/TLS Handshake、更多 Socket 与内存、多套独立拥塞控制状态，以及大量重复 Header。

HTTP/2 因此重写了 HTTP Message 的线上表达方式。

---

# 2. HTTP/2 保留语义，重写“语法”

HTTP/2 仍保留：

~~~text
GET / POST
Status Code
Header
Body
URL
Cookie
Cache-Control
~~~

但线上不再依赖 HTTP/1.1 的文本格式，而引入 Binary Framing Layer：

~~~text
HTTP Semantics
      ↓
Message
      ↓
Frame
      ↓
TCP
~~~

---

# 3. Frame：HTTP/2 的基本线上传输单位

一个 Response 可以拆成：

~~~text
HEADERS Frame
DATA Frame
DATA Frame
...
~~~

Frame Header 会携带 Length、Type、Flags、Stream Identifier 等信息。

HTTP/2 因此使用明确的二进制 Frame 组织通信，而不是把所有协议结构都建立在文本分隔符上。

---

# 4. Stream：HTTP/2 并发的关键

~~~text
1 TCP Connection
    │
    ├─ Stream 1
    │   ├─ HEADERS
    │   └─ DATA
    │
    ├─ Stream 3
    │   ├─ HEADERS
    │   └─ DATA
    │
    └─ Stream 5
        ├─ HEADERS
        └─ DATA
~~~

不同 Stream 的 Frame 可以交错发送：

~~~text
S1 HEADERS
S3 HEADERS
S1 DATA
S5 HEADERS
S3 DATA
S1 DATA
~~~

接收端依靠 Stream ID 归类。

> **Multiplexing = 多个逻辑 Stream 复用同一条底层 Connection。**

---

# 5. Connection、Stream、Message、Frame

~~~text
Connection
└─ Stream
   ├─ Request Message
   │  ├─ HEADERS Frame
   │  └─ DATA Frame(s)
   │
   └─ Response Message
      ├─ HEADERS Frame
      └─ DATA Frame(s)
~~~

可以记成：

- Connection：一条 HTTP/2 连接；
- Stream：连接里的逻辑双向流；
- Message：一个 Request 或 Response；
- Frame：线上传输的协议单位。

---

# 6. HTTP/2 为什么比 HTTP/1.1 更容易高并发？

HTTP/1.1 的历史并发方式更接近：

~~~text
Request A → TCP 1
Request B → TCP 2
Request C → TCP 3
~~~

HTTP/2：

~~~text
Request A → Stream 1
Request B → Stream 3
Request C → Stream 5
            │
            ▼
       One TCP Connection
~~~

这样减少连接与握手开销。

但限制也埋在这里：

> **HTTP/2 的多个 Stream 最后仍共享一条 TCP Byte Stream。**

---

# 7. HPACK：Header 为什么也需要压缩？

HTTP Header 很容易重复：

~~~text
User-Agent
Accept
Cookie
Authorization
Content-Type
~~~

HTTP/2 使用 HPACK：

~~~text
Static Table
+
Dynamic Table
+
Huffman Coding
~~~

第一次发送完整或压缩 Header 后，双方可建立动态表；后续更多使用索引或差异，减少重复内容。

但动态表也意味着双方必须维护一致的压缩状态。

---

# 8. HTTP/2 解决了哪一种 HOL？

HTTP/1.1 单连接 Request/Response 容易形成应用层顺序等待。

HTTP/2 中：

~~~text
Stream A 慢
≠
HTTP 层必须停止发送 Stream B 的 Frame
~~~

所以 HTTP/2 解决了大量 HTTP 层串行限制。

但是：

> **它没有改变 TCP 必须向应用交付有序连续 Byte Stream 的语义。**

---

# 9. 为什么 HTTP/2 仍有 TCP-level HOL？

~~~text
TCP bytes 1 ... 1000
TCP bytes 1001 ... 2000   ← 某段丢失
TCP bytes 2001 ... 3000   ← 已到达
~~~

TCP 不能把有缺口的后续 Byte Stream 直接交给上层。

于是：

~~~text
某一段 TCP 数据丢失
        ↓
TCP 等待恢复缺口
        ↓
同一 TCP Connection 上
其他 Stream 的后续 Frame
也不能及时交给 HTTP/2
~~~

这就是 TCP-level Head-of-Line Blocking。

---

# 10. 为什么不只继续改 TCP？

现实中 TCP 深度集成在 OS Kernel，大量中间设备依赖既有 TCP 行为，新特性部署周期长，而且原生只提供一条全局有序 Byte Stream。

QUIC 的工程策略是：

> **使用 UDP 提供的最小 Datagram 接口，在其上重新实现现代可靠传输。**

~~~text
UDP
仍然是不可靠 Datagram

QUIC
自己实现：
ACK
Loss Recovery
Reliability
Flow Control
Congestion Control
Streams
Security Handshake
~~~

---

# 11. QUIC 在协议栈中放哪里？

~~~text
HTTP/3
 ↓
QUIC
 ↓
UDP
 ↓
IP
~~~

实际实现经常是：

~~~text
Browser / Server Process
   ↓
QUIC Library
   ↓
UDP Socket
   ↓
Kernel UDP / IP
~~~

“常在用户态实现”不等于“QUIC 只是普通应用协议”。从职责上，它承担现代传输协议的核心工作。

---

# 12. QUIC Packet Number 与 Stream Offset 不要混

Packet Number 标识 QUIC Packet，用于 ACK、Loss Detection、RTT 等。

~~~text
Packet 100 丢失
      ↓
相关可靠 Frame 信息重发
      ↓
New Packet Number = 108
~~~

Stream Offset 标识某条 Stream 中的字节位置：

~~~text
Stream 7
Offset 0~999

Stream 7
Offset 1000~1999
~~~

因此：

~~~text
Packet Number
→ Packet-level recovery

Stream ID + Offset
→ Stream-level reassembly
~~~

---

# 13. QUIC 为什么能避免一个 Stream 拖住其他 Stream？

~~~text
QUIC Connection
  ├─ Stream 1
  ├─ Stream 3
  └─ Stream 5
~~~

如果 Stream 1 的某个 Offset 区间丢失，而 Stream 3 已完整到达，Stream 3 可以继续向 HTTP/3 交付，Stream 1 单独等待缺口恢复。

> **QUIC 的有序性按 Stream 独立维护，而不是把所有 Stream 强制压进一条全局有序 Byte Stream。**

但同一个 QUIC Stream 内仍然有顺序要求。

---

# 14. QUIC 的 ACK 与 Loss Recovery

QUIC 自己实现 ACK、RTT estimation、loss detection、可靠信息重传和 congestion control。

Packet Number 持续前进，重传相关信息进入新的 Packet，而不是原样复用旧 Packet Number，这让 ACK 与 RTT 判断更明确。

---

# 15. QUIC 也必须做 Flow Control

~~~text
Stream-level Flow Control
+
Connection-level Flow Control
~~~

Stream Level 防止单条 Stream 无限占用接收预算；Connection Level 限制所有 Streams 合计的数据量，避免撑爆整个 Connection 的接收资源。

---

# 16. QUIC 也必须做 Congestion Control

UDP 自身没有 Congestion Control，不代表基于 UDP 的协议可以无视网络。

QUIC 仍需根据 loss、ECN、RTT 和 ACK feedback 调整拥塞窗口、发送速率和 pacing。

常见优势之一是：QUIC 经常在用户态实现，新拥塞控制与 Loss Recovery 算法可以比内核 TCP 更快迭代。

---

# 17. QUIC 如何和 TLS 1.3 协同？

HTTP/2 over TLS：

~~~text
TCP Handshake
      ↓
TLS Handshake
      ↓
HTTP/2
~~~

QUIC：

~~~text
QUIC Transport Handshake
        +
TLS 1.3 Handshake
        ↓
协同进行
~~~

TLS 1.3 提供 Server Authentication、Key Establishment 与 Traffic Secrets。

QUIC 自己负责 Packet Number、ACK / Loss Recovery、Streams、Flow Control、Congestion Control 和 Connection ID。

> **QUIC 不是把 TCP 上的 TLS Record 模型原样搬到 UDP 上，而是把 TLS 1.3 Handshake 集成进 QUIC。**

---

# 18. 1-RTT 与 0-RTT

新 QUIC Connection 通常可以在约 1 RTT 后建立受保护的应用数据通信。

如果已有恢复状态，可以尝试 0-RTT Early Data。

但：

> **0-RTT 有 Replay 风险。**

因此：

~~~text
HTTP/3
≠
永远 0 RTT
~~~

更准确：

~~~text
New Connection
→ 通常约 1-RTT 建立

Resumption
→ 满足条件时可尝试 0-RTT Early Data
~~~

---

# 19. Connection ID 为什么重要？

TCP 强绑定：

~~~text
src IP
src port
dst IP
dst port
~~~

手机从 5G 切到 Wi-Fi，源 IP / Port 可能变化。

QUIC 使用 Connection ID，让 Connection Identity 不完全依赖当前四元组。

~~~text
Path Changed
 ↓
CID 仍关联原 QUIC Connection
 ↓
Path Validation
 ↓
更新路径 / 拥塞状态
 ↓
继续 Connection
~~~

这就是 Connection Migration 的核心。

---

# 20. Connection Migration 不是“IP 变了无脑继续”

Connection ID 很重要，但新路径仍需安全验证，以减少地址欺骗、放大攻击或错误导流。

> **CID 保留连接身份，Path Validation 确认新路径可安全使用。**

---

# 21. HTTP/3 到底负责什么？

~~~text
HTTP/3
 ↓
QUIC Streams
 ↓
QUIC Packets
 ↓
UDP Datagrams
 ↓
IP
~~~

HTTP/3 负责 HTTP 语义、HTTP/3 Frames、Control Streams 和 Header Compression。

QUIC 负责 Stream abstraction、reliable delivery、ACK / Loss Recovery、Flow Control、Congestion Control、Crypto transport 和 Migration。

---

# 22. 为什么 HTTP/3 使用 QPACK？

HTTP/2 HPACK 的动态表依赖有序传输。

HTTP/3 不同 QUIC Streams 可以独立到达，如果 Header Compression 仍强依赖前面的动态表更新，就可能重新制造跨 Stream 阻塞。

QPACK 为 QUIC Stream 模型重新设计，通过 Encoder / Decoder Streams 等机制同步动态表并控制阻塞风险。

> **QPACK 不是 HPACK 改名，而是适配 QUIC 多 Stream 独立交付。**

---

# 23. HTTP/1.1、HTTP/2、HTTP/3 栈对比

~~~text
HTTP/1.1
  ↓
TLS
  ↓
TCP
  ↓
IP

HTTP/2
  ↓
TLS
  ↓
TCP
  ↓
IP

HTTP/3
  ↓
QUIC + TLS 1.3 integration
  ↓
UDP
  ↓
IP
~~~

HTTP/3 不是“HTTP/2 + UDP”，而是 HTTP Semantics + HTTP/3 Framing + QUIC Transport。

---

# 24. HTTP/2 Server Push 为什么不再当核心卖点？

HTTP/2 定义过 PUSH_PROMISE，让 Server 主动推资源。

但现代浏览器实践中，Server Push 没成为主流 Web 性能路线，主要浏览器已弱化或移除相关使用支持。

因此要区分：

~~~text
协议曾支持
≠
今天生态仍广泛依赖
~~~

HTTP/2 的核心记忆应该放在 Binary Framing、Streams、Multiplexing、HPACK、Flow Control 与 TCP HOL。

---

# 25. WebSocket 解决的不是“HTTP 太慢”

WebSocket 解决：

> **Client 与 Server 需要长期双向消息通道。**

典型场景：

- 即时聊天；
- 实时行情；
- 游戏；
- 协作编辑；
- Server Event Push。

---

# 26. WebSocket 之前：Polling 与 Long Polling

Polling：

~~~text
Client → 有新消息吗？
Server ← 没有

1 秒后重复
~~~

Long Polling：

~~~text
Client Request
      ↓
Server 暂时不返回
      ↓
有事件 / 超时
      ↓
Response
      ↓
Client 立即再发下一次 Long Poll
~~~

Long Polling 减少空请求，但本质仍是 Client 发起 HTTP Request。

---

# 27. 经典 WebSocket 如何建立？

HTTP/1.1 主模型：

~~~text
Client:

GET /chat HTTP/1.1
Host: example.com
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Key: ...
Sec-WebSocket-Version: 13

              ↓

Server:

HTTP/1.1 101 Switching Protocols
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Accept: ...
~~~

成功后，同一底层连接开始使用 WebSocket Frame / Message 语义。

---

# 28. WebSocket 为什么是 Full-Duplex？

~~~text
Client ───────────────→ Server
Client ←─────────────── Server
~~~

连接建立后，双方都可以主动发送 Message，而不要求 Server 每发一条业务消息都先等新的 HTTP Request。

---

# 29. WebSocket Frame 与 TCP Stream

~~~text
WebSocket Message
    ↓
WebSocket Frame(s)
    ↓
TCP Byte Stream
~~~

WebSocket 自己建立 Message / Frame 边界。

但底层如果使用 TCP，TCP 的可靠、有序和 HOL 特性仍然存在。

---

# 30. WebSocket Ping/Pong、TCP Keepalive、业务 Heartbeat

~~~text
TCP Keepalive
→ Kernel TCP 层
→ 探测连接是否仍可达

WebSocket Ping/Pong
→ WebSocket Protocol 层
→ 探测 WebSocket Peer 是否响应

Application Heartbeat
→ 业务层
→ 检查 Session / Room / Game State
~~~

三者不能混。

---

# 31. WebSocket 只能通过 HTTP/1.1 Upgrade 吗？

不是。

现代标准还支持：

- WebSocket over HTTP/2：Extended CONNECT；
- WebSocket over HTTP/3：Extended CONNECT / HTTP/3 bootstrap。

所以“WebSocket 必须独占一条 HTTP/1.1 TCP Connection”不是现代协议的绝对规则。

---

# 32. RPC 到底是什么？

RPC = Remote Procedure Call。

它不是一个固定传输协议名，而是一种编程模型。

~~~text
user = userService.getUser(42)
~~~

背后：

~~~text
Caller
 ↓
Serialize Arguments
 ↓
Network Request
 ↓
Remote Service
 ↓
Execute getUser(42)
 ↓
Serialize Result
 ↓
Network Response
 ↓
Caller
~~~

目标是把远程网络交互包装成类似本地函数调用的开发体验。

---

# 33. 一次 RPC 包含哪些层？

~~~text
Application Method
getUser(42)
      ↓
IDL / Generated Stub
      ↓
Serialization
Protobuf / Thrift Binary / JSON ...
      ↓
RPC Protocol
Method / Metadata / Status / Deadline ...
      ↓
Transport
HTTP/2 / TCP / QUIC / custom transport
      ↓
Network
~~~

RPC 往往是一套调用抽象、编码、协议、传输和工具链的组合。

---

# 34. Client Stub / Server Stub 在干什么？

~~~text
Client Code
userService.getUser(42)
       ↓
Client Stub
       ↓
Serialize + RPC Request
       ↓
Network
       ↓
Server Stub / Handler
       ↓
Deserialize
       ↓
Business Method
~~~

应用开发者看到 Method Call，网络里真正传的是 Bytes。

---

# 35. IDL 为什么重要？

例如：

~~~text
service UserService {
  GetUser(GetUserRequest) returns (GetUserResponse)
}
~~~

IDL 可以生成 Client Stub、Server Interface、Message Types 和 Serialization Code。

价值：

> **把接口契约变成机器可读定义，减少手写协议和两端不一致。**

---

# 36. gRPC 是什么组合？

~~~text
Application Method
      ↓
gRPC
      ↓
Protocol Buffers
      ↓
HTTP/2
      ↓
TLS
      ↓
TCP
~~~

所以：

> **gRPC 不等于 HTTP/2。**

HTTP/2 提供 Stream、Multiplexing、Flow Control 与 Header Compression。

gRPC 自己定义 RPC Method、Metadata、Status、Deadline、Cancellation、Message Framing 与 Streaming Model。

---

# 37. gRPC 四种调用形态

~~~text
Unary
Client → one Request
Server → one Response

Server Streaming
Client → one Request
Server → many Responses

Client Streaming
Client → many Requests
Server → one Response

Bidirectional Streaming
Client ↔ Server
both send message streams
~~~

---

# 38. Thrift 到底是什么？

Apache Thrift 不只是一个序列化格式。

~~~text
Thrift IDL
   ↓
Generated Client / Server
   ↓
Protocol
Binary / Compact / ...
   ↓
Transport
Socket / Framed / ...
~~~

所以：

> **Thrift、gRPC 属于 RPC Framework 家族；HTTP 是应用层协议；TCP/QUIC 是传输协议。**

不能把 Thrift vs TCP 当成同层方案比较。

---

# 39. REST 与 RPC 怎么区分？

REST 风格更围绕：

~~~text
Resource
URI
HTTP Method
Representation
Status Code
~~~

例如：

~~~text
GET /users/42
~~~

RPC 更围绕：

~~~text
Service
Method
Arguments
Return Value
~~~

例如：

~~~text
UserService.GetUser(42)
~~~

现实边界可以混合：HTTP JSON API 可以设计得很 RPC；RPC Framework 可以运行在 HTTP 上；gRPC 本身就建立在 HTTP/2 上。

所以：

> **REST = HTTP，RPC = TCP 是错误的。**

---

# 40. Deadline、Timeout、Cancellation 为什么重要？

后端调用链：

~~~text
Gateway
 ↓
Order Service
 ↓
Inventory Service
 ↓
DB
~~~

如果每层都无限等待，一个慢依赖会拖住整个上游。

RPC 常传播 Deadline：

~~~text
Gateway 总预算 500 ms
      ↓
Order 剩余 400 ms
      ↓
Inventory 只剩 120 ms
~~~

Deadline 到达后及时 Cancel，可以停止无意义工作并释放资源。

这比单纯 TCP Timeout 更接近业务语义。

---

# 41. Retry 为什么必须和 Idempotency 一起想？

~~~text
Client
 ↓ Request
Server
执行成功
 ↓
Response 丢失
~~~

Client 只看到 Timeout，不知道 Server 是没执行，还是执行成功但 Response 丢了。

盲目 Retry：

~~~text
扣款
 ↓ timeout
 ↓ retry
 ↓
可能重复扣款
~~~

所以真实 RPC 要考虑：

- Idempotency Key；
- Request ID；
- Deduplication；
- Retry Policy；
- Deadline Budget。

网络层不能替业务自动判断是否重复执行。

---

# 42. 为什么 Service Discovery 跟在 RPC 后面？

代码只知道：

~~~text
UserService
~~~

网络真正需要：

~~~text
10.23.4.12:8080
10.23.4.19:8080
10.23.5.31:8080
~~~

实例会扩缩容、重启、换 IP、跨 Zone。

因此需要：

> **Service Name → Current Endpoint Set**

这就是 Service Discovery。

---

# 43. DNS-based Service Discovery

~~~text
user-service.internal
        ↓ DNS
10.23.4.12
10.23.4.19
10.23.5.31
~~~

优点是通用、客户端天然兼容。

需要考虑：

- TTL / Cache；
- Health State；
- Endpoint Metadata；
- Load Balancing；
- 变更实时性。

Kubernetes 常见：

~~~text
Service Name
 ↓
CoreDNS
 ↓
ClusterIP / Headless Service Records
~~~

---

# 44. Registry-based Discovery

Consul / etcd 类系统可抽象为：

~~~text
Service Instance
    ↓ register / lease
Service Registry
    ↓
Endpoint / health / metadata
    ↓
Client / Proxy / LB
~~~

关键仍是两层：

~~~text
Control Plane
→ 谁维护有哪些实例？

Data Plane
→ 一个真实 Request 最终发给哪个 Endpoint？
~~~

这与前面 BGP / FIB 的控制面和数据面思维相似。

---

# 45. Client-side 与 Server-side Load Balancing

Client-side：

~~~text
Client
 ↓ Discovery
A / B / C
 ↓
Client 选择 B
 ↓
RPC → B
~~~

Server-side：

~~~text
Client
 ↓
Load Balancer / Proxy
 ↓
Backend A / B / C
~~~

Service Mesh / Sidecar 还可以代替应用处理 Discovery、LB、mTLS、Retry 和 Telemetry。

---

# 46. WebSocket 与 RPC 是什么关系？

WebSocket 解决长期双向 Message Channel。

RPC 解决 Remote Method Invocation Model。

因此可以：

~~~text
RPC over WebSocket
RPC over HTTP/2
RPC over QUIC
RPC over raw TCP
~~~

WebSocket 更像通信通道；RPC 更像调用语义和框架。

---

# 47. HTTP/2 Stream 与 WebSocket Connection 是一个东西吗？

不是。

HTTP/2 Stream 是一条 HTTP/2 Connection 内的逻辑 Stream。

WebSocket 是有自己 Frame、Message、Ping/Pong、Close 语义的应用层协议。

现代 WebSocket 即使通过 HTTP/2 Extended CONNECT 建立，建立后的 WebSocket Protocol 语义仍然存在。

---

# 48. QUIC Stream 与 HTTP/3 Request

HTTP/3 直接使用 QUIC Stream：

~~~text
HTTP/3 Request
        ↓
QUIC Bidirectional Stream
        ↓
HTTP/3 HEADERS / DATA Frames
~~~

另外还有 Control Stream、QPACK Encoder Stream、QPACK Decoder Stream 等单向 Streams。

---

# 49. 从 URL 到 HTTP/3，主线怎么变化？

HTTP/2：

~~~text
URL
 ↓
DNS
 ↓
Address Selection
 ↓
TCP connect
 ↓
TLS 1.3
ALPN = h2
 ↓
HTTP/2
~~~

HTTP/3：

~~~text
URL
 ↓
DNS / Protocol Discovery
 ↓
UDP
 ↓
QUIC + TLS 1.3 Handshake
 ↓
ALPN = h3
 ↓
HTTP/3 Streams
~~~

现实 Browser 还可能参考 DNS HTTPS/SVCB Records、Alt-Svc、已有 Connection History、UDP 可达性与 Fallback。

所以现代 HTTPS 不能绝对画成：

~~~text
https
→ 一定 TCP
~~~

---

# 50. Connection ID 为什么仍需要 IP + UDP？

QUIC 底层仍通过 UDP Socket 发 Datagram：

~~~text
Client UDP ephemeral port
        →
Server UDP 443
~~~

Connection ID 不是替代 IP/UDP 寻址，而是让 QUIC Connection Identity 不必完全绑定当前四元组。

Packet 仍要靠 IP + UDP 才能被网络送到目标。

---

# 51. UDP 443 与 TCP 443 可以同时存在吗？

可以。

~~~text
TCP 443
→ TLS
→ HTTP/1.1 / HTTP/2

UDP 443
→ QUIC
→ HTTP/3
~~~

TCP 与 UDP 的端口空间独立。

---

# 52. 一个现代 HTTPS Edge 可能有两套入口

~~~text
                  ┌─ TCP 443
Client ─ Internet ┤   ↓
                  │ TLS
                  │   ↓
                  │ HTTP/1.1 / HTTP/2
                  │
                  └─ UDP 443
                      ↓
                    QUIC
                      ↓
                    HTTP/3
~~~

两条入口最终可以进入同一业务路由：

~~~text
CDN / Nginx / Envoy / Gateway
        ↓
Backend Service
~~~

---

# 53. 最容易混淆的 20 个点

1. HTTP/2 保留 HTTP 语义，但重写线上 Framing。
2. HTTP/2 Stream 是一条 Connection 内的逻辑 Stream。
3. Multiplexing 不代表底层有多条 TCP。
4. HTTP/2 解决 HTTP 层并发问题，但不能消灭 TCP HOL。
5. TCP HOL 来自整条 TCP Byte Stream 的有序交付。
6. QUIC 不是 UDP 自动可靠，可靠性是 QUIC 实现的。
7. QUIC 即使常在用户态实现，也承担 Transport 职责。
8. Packet Number 不等于 Stream Offset。
9. 一个 QUIC Stream 丢包不会因全局有序 Byte Stream 阻塞其他 Stream。
10. 同一个 QUIC Stream 内仍有顺序要求。
11. QUIC 仍需要 Flow Control 与 Congestion Control。
12. QUIC 集成 TLS 1.3，不是简单复制 TCP+TLS 栈。
13. Connection ID 不取代 IP/UDP。
14. Connection Migration 还需要 Path Validation。
15. HTTP/3 使用 QPACK 适配独立 Stream。
16. WebSocket 是双向消息协议，不是 HTTP/2 替代品。
17. RPC 是编程模型，不是固定传输协议。
18. gRPC 不等于 HTTP/2。
19. Thrift 不应和 TCP 放在同一层比较。
20. Service Discovery 解决 Name → Endpoint Set，Load Balancing 解决从 Endpoint Set 中选谁。

---

# 54. 一句话记忆

> **HTTP/2 在一条 TCP Connection 上用 Frame + Stream 多路复用；QUIC 在 UDP 上重做可靠传输、独立 Stream、拥塞控制、TLS 1.3 和 Connection ID；HTTP/3 使用 QUIC；WebSocket 提供长期双向消息通道；RPC 把远程通信包装成方法调用。**

---

# 55. 自测

1. HTTP/2 为什么要引入 Binary Frame？
2. Stream、Message、Frame 分别是什么？
3. HTTP/2 Multiplexing 为什么仍会被 TCP 丢包拖住？
4. HTTP 层 HOL 与 TCP 层 HOL 有什么区别？
5. QUIC 为什么选择 UDP 作为底层接口？
6. QUIC 自己实现了哪些 TCP 类能力？
7. Packet Number 与 Stream Offset 分别解决什么？
8. 为什么 QUIC Stream A 丢包不会必然阻塞 Stream B？
9. QUIC 为什么仍需要 Congestion Control？
10. QUIC 与 TLS 1.3 如何协同？
11. 0-RTT 为什么不能随便用于所有业务？
12. Connection ID 为什么帮助网络迁移？
13. Connection ID 为什么不能替代 IP/UDP？
14. HTTP/3 为什么使用 QPACK？
15. HTTP/2 Server Push 为什么不应作为今天的核心卖点？
16. Polling、Long Polling、WebSocket 有什么本质差异？
17. WebSocket Ping/Pong 与 TCP Keepalive 区别是什么？
18. RPC 为什么不是固定网络协议？
19. gRPC、Protobuf、HTTP/2、TCP 分别是什么角色？
20. Deadline 为什么比 TCP Timeout 更贴近业务？
21. Retry 为什么必须考虑 Idempotency？
22. Service Discovery 与 Load Balancing 分别解决什么？

---

# 56. 下一章

下一章把协议课放进真实后端：

> **07｜真实后端网络拓扑：DNS → CDN → WAF → L4/L7 LB → Nginx/Gateway → Service → RPC → Redis/MySQL**

重点回答：

~~~text
用户访问的 IP 为什么经常不是业务服务器 IP？
CDN / WAF / LB / Nginx / API Gateway 各是谁？
TLS 到底在哪终止？
L4 与 L7 Load Balancer 有什么区别？
X-Forwarded-For 为什么存在？
Proxy Protocol 又是什么？
一次请求怎样从公网进入内网服务？
RPC discovery 与 load balancing 在哪里发生？
~~~

---

# 57. 延伸阅读

主要参考：

- xiaolincoder/CS-Base · HTTP/2
- xiaolincoder/CS-Base · HTTP/3
- xiaolincoder/CS-Base · QUIC
- xiaolincoder/CS-Base · WebSocket
- xiaolincoder/CS-Base · HTTP 与 RPC
- RFC 9113 · HTTP/2
- RFC 9114 · HTTP/3
- RFC 9000 · QUIC
- RFC 9204 · QPACK
- RFC 6455 · WebSocket
- RFC 8441 · WebSocket over HTTP/2
- RFC 9220 · WebSocket over HTTP/3

具体链接见 [SOURCES.md](./SOURCES.md)。
