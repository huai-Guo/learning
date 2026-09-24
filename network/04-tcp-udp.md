# 04｜TCP / UDP：IP 只是尽力交付，TCP 为什么还能提供“可靠字节流”？

> 这一章只解决一个问题：
>
> **IP 不保证送达和顺序，TCP 到底靠什么向应用提供有序、可靠的字节流？UDP 又为什么故意不做这些事？**

上一章结束在：

~~~text
IP Packet
 ↓
Router / Internet
 ↓
Destination Host
~~~

这一章把镜头拉到传输层：

~~~text
Application
   ↓
Socket API
   ↓
TCP / UDP
   ↓
IP
~~~

贯穿例子：

~~~text
Client
192.168.1.20:53124

Server
203.0.113.20:443
~~~

经过 NAT 后，Server 侧可能看到：

~~~text
198.51.100.8:62001
        →
203.0.113.20:443
~~~

所以同一条逻辑连接，在不同观察点看到的 tuple 可以不同。

---

# 0. TCP 与 UDP 先建立最小模型

## TCP

TCP 可以先记成：

> **面向连接 + 有序 + 可靠传输语义 + 字节流 + 流量控制 + 拥塞控制。**

“可靠”不等于：

> 网络永久断开后，TCP 还能凭空把数据送过去。

更准确：

> TCP 使用序列号、确认、重传、窗口等机制，在连接可继续工作的条件下向应用提供有序、去重的字节流；如果最终无法继续通信，会向应用报告错误。

TCP 不保证：

- 对端应用已经处理业务；
- HTTP 请求一定成功；
- 数据已经写入数据库；
- 永久网络故障后还能送达。

## UDP

UDP 更接近：

> **保留报文边界、没有 TCP 式连接握手，协议本身不提供排序、重传、流量控制和拥塞控制。**

~~~text
TCP:
Application bytes
      ↓
byte stream

UDP:
Application datagram
      ↓
UDP datagram
~~~

这是两者最底层的语义差异。

---

# 1. 端口到底解决什么？

IP 地址回答：

> 数据到哪台主机 / 哪个接口？

端口继续回答：

> 到了这台主机后，应该交给哪个传输层 endpoint / socket？

例如：

~~~text
203.0.113.20:443
~~~

可以理解成：

~~~text
203.0.113.20
→ 找到 Server

443
→ 找到 Server 上对应的 TCP endpoint
~~~

但不要记成：

> 443 直接属于某个进程。

更准确：

~~~text
Process
  │
  │ fd / socket handle
  ▼
Kernel Socket
  │
  └─ bind / listen / connect 状态
~~~

端口由内核网络栈管理，进程通过 socket API 使用它。

---

# 2. TCP 四元组：为什么同一个 443 可以服务大量连接？

Server 监听：

~~~text
203.0.113.20:443
~~~

不同 Client：

~~~text
10.0.0.10:50001 → 203.0.113.20:443
10.0.0.11:50001 → 203.0.113.20:443
10.0.0.10:50002 → 203.0.113.20:443
~~~

TCP 常用四元组区分连接：

~~~text
src IP
src port
dst IP
dst port
~~~

于是：

~~~text
LISTEN socket
203.0.113.20:443
        │
        ├─ Connected socket A
        │  10.0.0.10:50001 ↔ 203.0.113.20:443
        │
        ├─ Connected socket B
        │  10.0.0.11:50001 ↔ 203.0.113.20:443
        │
        └─ Connected socket C
           10.0.0.10:50002 ↔ 203.0.113.20:443
~~~

所以：

> **一个监听端口不等于只能有一条连接。**

---

# 3. 客户端临时端口从哪里来？

客户端调用：

~~~text
connect(server_ip, 443)
~~~

如果没有显式绑定本地端口，OS 通常从可用 ephemeral port 范围选择，例如：

~~~text
192.168.1.20:53124
        →
203.0.113.20:443
~~~

临时端口范围：

- 由 OS 决定；
- 可以配置；
- 不同系统默认值不同。

因此不要把某个固定范围当成跨系统协议常量。

---

# 4. TCP 和 UDP 能不能使用同一个数字端口？

可以。

例如同一台主机可以同时存在：

~~~text
TCP 53
UDP 53
~~~

IP Header 会指出上层协议是 TCP 还是 UDP，内核先进入不同协议模块，再根据端口找 endpoint。

所以：

~~~text
TCP port 53
≠
UDP port 53
~~~

它们属于不同传输协议空间。

---

# 5. Server：socket → bind → listen → accept

经典 TCP Server：

~~~text
socket()
   ↓
bind(IP, port)
   ↓
listen()
   ↓
accept()
   ↓
read()/write()
~~~

含义：

- socket()：创建内核 socket 对象；
- bind()：绑定本地地址/端口；
- listen()：变成监听 socket；
- accept()：取出一个已完成握手、等待应用处理的连接，得到 connected socket。

所以：

> **LISTEN socket 和 connected socket 是不同角色。**

---

# 6. listen 之后为什么还会讨论两类连接队列？

Linux 的经典教学模型会讨论：

~~~text
SYN-related state
+
accept queue
~~~

简化：

~~~text
Client SYN
   ↓
LISTEN socket
   ↓
等待握手完成的连接状态
   ↓
SYN + ACK
   ↓
Client ACK
   ↓
握手完成
   ↓
accept queue
   ↓
accept()
   ↓
connected socket
~~~

“半连接队列 / 全连接队列”非常适合入门理解，但 Linux 内核具体数据结构、Syncookies、不同版本实现比两个普通 FIFO 更复杂。

---

# 7. listen 了但一直不 accept，会怎样？

关键结论：

> **三次握手不要求应用先 accept() 才能完成。**

~~~text
Server 已 listen
      ↓
Client SYN
      ↓
SYN + ACK
      ↓
Client ACK
      ↓
TCP handshake completed
      ↓
accept queue
      ↓
等待应用 accept()
~~~

因此应用暂时不 accept 时，一些 Client 仍可以 connect 成功。

真正的问题是：

~~~text
accept queue 越来越满
~~~

队列满后的行为和：

- backlog；
- OS 参数；
- Syncookies；
- overflow 策略；

有关。

所以：

> **connect 成功不等于服务端业务代码已经 accept 并处理。**

---

# 8. Server 根本没有 listen，会怎样？

假设：

- Server IP 可达；
- 目标 TCP port 没 listener；
- Firewall 没有静默丢包。

典型：

~~~text
Client                       Server

SYN ------------------------>

    <------------------- RST
~~~

客户端通常很快得到：

~~~text
Connection refused
~~~

而如果 Firewall 静默 drop：

~~~text
SYN ----X
~~~

客户端更可能：

~~~text
等待
重传 SYN
继续等待
最终超时
~~~

所以：

> **refused 和 timeout 往往指向不同故障方向。**

---

# 9. 三次握手：先看状态机

~~~mermaid
sequenceDiagram
    participant C as Client
    participant S as Server

    Note over S: LISTEN
    C->>S: SYN, seq=x
    Note over C: SYN-SENT
    S-->>C: SYN + ACK, seq=y, ack=x+1
    Note over S: SYN-RECEIVED
    C->>S: ACK, ack=y+1
    Note over C,S: ESTABLISHED
~~~

握手完成的关键事情：

- 双方交换初始序列号；
- 双方确认对方能收到相应握手信息；
- 建立连接状态；
- 降低旧重复连接请求造成错误初始化的风险；
- 协商 MSS、Window Scale、SACK Permitted 等 TCP options。

---

# 10. 为什么不是两次握手？

不要只背：

> 双方都要确认收发能力。

更完整：

~~~text
Client:
“我的初始序列号是 x”

Server:
“我收到了 x；
 我的初始序列号是 y”

Client:
“我也收到了 y”
~~~

第三步让 Server 得到 Client 对 Server SYN / 初始序列空间的确认。

同时 TCP 还必须应对：

~~~text
旧 SYN
重复报文
历史连接
~~~

所以：

> **三次握手是在 TCP 设计中完成双方序列空间确认与连接初始化的最小完整交互。**

---

# 11. SYN 和 FIN 为什么会让 ACK +1？

SYN 和 FIN 即使不承载普通应用数据，也各自消耗一个 sequence number。

例如：

~~~text
Client ISN = 1000

SYN:
seq = 1000

Server ACK:
ack = 1001
~~~

FIN 同理。

这是 TCP sequence space 的规则。

---

# 12. Sequence Number 编号的是“字节位置”

TCP 是字节流。

假设：

~~~text
seq = 1001
len = 500
~~~

表示承载：

~~~text
byte 1001 ... 1500
~~~

下一段连续字节通常从：

~~~text
seq = 1501
~~~

开始。

Sequence Number 帮助：

- 排序；
- 去重；
- 判断缺失；
- 确认；
- 重传。

---

# 13. ACK Number 表示“下一步期待哪个字节”

Receiver 已连续收到：

~~~text
1001 ... 2000
~~~

那么：

~~~text
ACK = 2001
~~~

意思是：

> 2001 之前的连续字节我已经收到了，下一步期待 2001。

如果：

~~~text
1001~1500 到了
1501~2000 丢了
2001~2500 到了
~~~

Receiver 仍会强调：

~~~text
ACK = 1501
~~~

因为连续字节流在 1501 处断了。

---

# 14. TCP 为什么叫字节流？一次 send() 为什么不等于一次 recv()？

Client：

~~~text
send("HELLO")
send("WORLD")
~~~

Server 可能：

~~~text
recv() → "HELLOWORLD"
~~~

也可能：

~~~text
recv() → "HEL"
recv() → "LOWOR"
recv() → "LD"
~~~

因为 TCP 保证：

~~~text
有序字节流
~~~

而不是：

~~~text
应用消息边界
~~~

所以应用协议必须自己定义 framing，例如：

- fixed length；
- delimiter；
- length-prefix；
- HTTP/2 frame；
- WebSocket frame；
- Thrift / Protobuf framing。

所谓“TCP 粘包/拆包”，本质是：

> **TCP 没有义务保留应用层 write/send 的消息边界。**

---

# 15. UDP 为什么天然保留 Datagram 边界？

应用：

~~~text
sendto(datagram A)
sendto(datagram B)
~~~

接收方处理的是两个 UDP datagram。

UDP Header 主要包括：

~~~text
src port
dst port
length
checksum
~~~

所以：

~~~text
TCP = stream
UDP = datagram
~~~

是非常核心的语义差异。

---

# 16. 丢包后怎么发现？第一种：RTO 超时重传

Sender 发出数据后等待 ACK。

如果在 RTO 范围内没有收到足够的确认：

~~~text
RTO expires
 ↓
retransmit
~~~

RTO 会基于 RTT 测量和波动动态估计。

~~~text
RTT
=
一次往返大概多久

RTO
=
最多应该等多久再怀疑丢包
~~~

RTO 太小会误重传；RTO 太大又会让真实丢包恢复太慢。

---

# 17. 第二种：Duplicate ACK 与 Fast Retransmit

假设：

~~~text
A 到了
B 丢了
C 到了
D 到了
E 到了
~~~

Receiver 不断表示：

~~~text
“下一步仍然缺 B”
~~~

经典 TCP 模型中，Sender 收到若干重复 ACK 后可以不等 RTO，直接：

~~~text
Fast Retransmit
~~~

经典实现常以 3 个 duplicate ACK 作为触发信号。

现代实现还可能结合：

- SACK；
- RACK；
- timer；
- pacing；

等机制。

所以“3 dup ACK”是经典模型，不是所有现代 TCP 唯一的丢包判断逻辑。

---

# 18. SACK：为什么累计 ACK 还不够？

累计 ACK 只能告诉 Sender：

~~~text
连续收到哪里
~~~

SACK 可以进一步说：

~~~text
1501~2000 缺

但：
2001~3000 已收到
4001~5000 已收到
~~~

于是 Sender 能更精准重传缺失区间。

SACK 能力通常在握手 options 中协商。

---

# 19. Flow Control：保护 Receiver

Receiver 有 Socket Receive Buffer。

应用 read() 太慢：

~~~text
TCP 收数据
 ↓
Receive Buffer 越来越满
 ↓
剩余空间变小
~~~

Receiver 通过：

~~~text
rwnd
~~~

告诉 Sender：

> 我现在还能接多少数据。

所以：

> **Flow Control 保护接收端。**

---

# 20. Sliding Window：为什么不必发一个等一个 ACK？

如果每次都：

~~~text
发 1 个
 ↓
等 ACK
 ↓
再发 1 个
~~~

高 RTT 网络利用率会很差。

Sliding Window 允许多个未确认字节同时在路上：

~~~text
[已确认][已发未确认][允许继续发][暂时不能发]
~~~

这让 TCP 可以填满带宽延迟积，提高吞吐。

---

# 21. Zero Window：Receiver 真没空间了怎么办？

Receiver 可以通告：

~~~text
rwnd = 0
~~~

Sender 停止正常发送。

但如果之后 Receiver 恢复窗口，而窗口更新报文丢了，就可能死等。

因此 TCP 有 Persist / Zero Window Probe 一类机制，让 Sender 继续确认：

> 你的窗口打开了吗？

注意：

> **Zero Window Probe 不等于 TCP Keepalive。**

---

# 22. Congestion Control：保护网络

Receiver 可能很能收：

~~~text
rwnd = 10 MB
~~~

但中间网络可能拥堵。

于是 Sender 还有：

~~~text
cwnd
=
congestion window
~~~

实际在途数据通常受到：

~~~text
min(rwnd, cwnd)
~~~

等因素约束。

一句话：

~~~text
rwnd
→ 保护 Receiver

cwnd
→ 保护 Network
~~~

---

# 23. Slow Start / Congestion Avoidance 在控制什么？

都围绕：

> cwnd 应该多大？

简化：

~~~text
刚建立连接
 ↓
不知道网络容量
 ↓
从相对谨慎的发送量开始
 ↓
根据 ACK 较快增长
 ↓
进入更谨慎的增长阶段
 ↓
遇到 loss / ECN / 其他拥塞信号
 ↓
调整 cwnd / pacing
~~~

现代系统可能使用：

- CUBIC；
- BBR；
- Reno 系列；

等不同算法。

不要把某一种拥塞窗口曲线当成 TCP 协议唯一实现。

---

# 24. 为什么关闭通常画成四次挥手？

TCP 是全双工：

~~~text
Client → Server
Server → Client
~~~

FIN 表示：

> **我这个发送方向以后没有更多数据。**

它不强迫对方同时结束发送。

典型流程：

~~~mermaid
sequenceDiagram
    participant C as Active Closer
    participant S as Passive Closer

    C->>S: FIN
    Note over C: FIN-WAIT-1
    S-->>C: ACK
    Note over S: CLOSE-WAIT
    Note over C: FIN-WAIT-2
    S-->>C: FIN
    Note over S: LAST-ACK
    C->>S: ACK
    Note over C: TIME-WAIT
    Note over S: CLOSED
~~~

---

# 25. 四次挥手一定恰好四个 Packet 吗？

不一定。

被动关闭方如果：

~~~text
收到 FIN
 ↓
自己的应用也马上 close
~~~

可能把：

~~~text
ACK + FIN
~~~

合在同一个 TCP segment。

所以：

> **四次挥手是逻辑阶段，不保证抓包永远恰好四个 Packet。**

---

# 26. CLOSE_WAIT 为什么经常是应用问题信号？

收到对端 FIN：

~~~text
Kernel ACK
 ↓
本端 CLOSE_WAIT
~~~

含义：

> 对方不再发送，但我本地应用还没关闭自己的 socket。

如果大量连接长期停在 CLOSE_WAIT，常见排查方向：

- 忘记 close；
- 异常路径未释放；
- 线程卡住；
- 连接泄漏。

所以：

> **CLOSE_WAIT 多，首先查本机应用关闭路径。**

---

# 27. TIME_WAIT 为什么不能直接删除？

主动关闭方在收到对方 FIN 后：

~~~text
发送最终 ACK
 ↓
TIME_WAIT
~~~

主要价值：

1. 最终 ACK 如果丢失，对端会重传 FIN，本机仍能再次 ACK；
2. 给旧连接迟到 segment 时间消失，减少污染后续相同四元组连接的风险。

经典模型：

~~~text
TIME_WAIT ≈ 2 × MSL
~~~

但不同 OS 实际时长不同。

不要把某个 Linux 版本的 60 秒当成 TCP 全球固定值。

---

# 28. TIME_WAIT 多一定有问题吗？

不一定。

短连接很多、主动关闭很多，本来就会出现很多 TIME_WAIT。

需要结合：

- 谁主动 close；
- connection creation rate；
- 临时端口范围；
- remote endpoint 是否高度集中；
- 是否应连接复用；
- 连接池；
- 系统资源；

分析。

优化通常优先考虑：

~~~text
减少无意义短连接
连接池
HTTP persistent connection
~~~

而不是先暴力消灭 TIME_WAIT。

---

# 29. TCP Keepalive：空闲连接怎么发现对端死亡？

如果 Socket 启用了 TCP Keepalive：

~~~text
长时间无活动
 ↓
发送 keepalive probes
 ↓
收到响应
 → 继续

连续多次无响应
 → 最终向应用报告错误
~~~

Linux 有类似：

~~~text
tcp_keepalive_time
tcp_keepalive_intvl
tcp_keepalive_probes
~~~

的默认参数。

但：

> **Socket 通常需要启用 SO_KEEPALIVE 才会使用 TCP Keepalive。**

应用还可能自己实现 heartbeat / timeout。

所以：

~~~text
TCP Keepalive
≠
HTTP Keep-Alive
≠
Application Heartbeat
~~~

---

# 30. 拔网线后为什么 Socket 可能仍显示 ESTABLISHED？

因为 TCP 状态是两端内核维护的逻辑状态。

拔线瞬间：

> 对端不会自动收到一个“网线拔了”的 TCP 报文。

如果双方此刻都不发送数据，也没有探测机制：

~~~text
ESTABLISHED
~~~

可能继续保留。

之后可能因为：

- 应用发送数据后重传失败；
- Keepalive 超时；
- 应用 heartbeat 超时；
- 本机链路/路由错误被 OS 明确报告；

才发现连接不可用。

具体行为依 OS、路由变化、配置和业务流量而异。

---

# 31. 对端进程崩溃 vs 整机断电

## 进程退出 / 崩溃，但 OS 仍运行

OS 知道 fd 被关闭，会执行 socket teardown。

正常 descriptor 关闭路径中，已建立 TCP 通常进行 FIN 型有序关闭；某些 abortive close 或错误场景也可能出现 RST。

核心：

> **OS 还活着，所以有机会主动发 TCP 控制报文。**

## 整台机器断电

OS 直接消失：

~~~text
没有正常 FIN
没有正常 close
~~~

对端只能依赖：

- 数据重传最终失败；
- TCP Keepalive；
- 应用 heartbeat；
- 对端重启后收到旧连接 segment 时返回 RST；

等方式发现。

---

# 32. RST 到底是什么？

RST 表达：

> **当前 TCP 状态无法按正常连接继续。**

常见场景：

- SYN 打到没有 listener 的端口；
- 一端没有这条 connection state，却收到旧连接 segment；
- abortive close；
- 某些异常协议状态。

对比：

~~~text
FIN
=
“我的发送方向正常结束”

RST
=
“连接立即异常终止”
~~~

应用常见：

~~~text
Connection reset by peer
~~~

---

# 33. SYN 丢了会怎样？

~~~text
Client SYN
   ↓
X 丢失
~~~

Client 不会立即知道。

~~~text
等待计时器
 ↓
重传 SYN
 ↓
继续失败
 ↓
最终 connect timeout / error
~~~

具体重传次数和时长由 OS 实现和配置决定，不是 TCP 标准规定一个全球统一默认值。

---

# 34. SYN-ACK 丢了会怎样？

~~~text
Client             Server

SYN --------------->

     <--- SYN+ACK X
~~~

可能发生：

- Client 重传 SYN；
- Server 重传 SYN+ACK；
- 在超时前恢复后仍可完成握手。

---

# 35. 第三次 ACK 丢了会怎样？

~~~text
Client                        Server

SYN ------------------------->

    <---------------- SYN+ACK

ACK --------X
~~~

此时可能：

~~~text
Client:
已进入 ESTABLISHED

Server:
仍 SYN-RECEIVED
~~~

Server 会重传 SYN+ACK。

Client 后续发送带有效 ACK 的数据时，Server 也可能据此完成状态推进。

所以：

> **TCP 两端状态不是要求在同一纳秒同步变化。**

---

# 36. Listen Queue 满了为什么故障表现复杂？

如果 accept queue 满，新完成握手请求的处理可能依 OS 和参数发生不同表现：

- 丢弃；
- 等待/重试；
- 某些配置下发送 RST。

SYN 压力大时，SYN-related state 也可能成为瓶颈。

Linux 还可能启用 SYN cookies 缓解 SYN flood。

因此高并发 Server 需要关注：

~~~text
backlog
somaxconn
syncookies
accept rate
queue overflow
~~~

---

# 37. TCP Flow Control 与业务 Backpressure 是一回事吗？

不是。

~~~text
TCP:
Receive Buffer 快满
 ↓
rwnd 变小
 ↓
对端降低发送量
~~~

它只知道 socket buffer。

它不知道：

- 线程池满了；
- DB 慢了；
- RPC downstream 爆了；
- Redis 延迟高；
- 业务队列堆积。

所以后端还需要：

- queue limit；
- timeout；
- concurrency limit；
- load shedding；
- circuit breaker。

TCP flow control 是底层背压，不是完整业务背压。

---

# 38. Congestion Control 为什么会影响 p99？

网络拥塞或丢包：

~~~text
loss / ECN / RTT change
 ↓
TCP 调整 cwnd / pacing
 ↓
吞吐和完成时间变化
 ↓
应用 p99 变化
~~~

所以后端延迟高不一定只有：

- CPU；
- GC；
- DB。

还可能有：

- RTT；
- queueing；
- retransmission；
- congestion；
- packet loss。

---

# 39. UDP 为什么不是“低级版 TCP”？

UDP 选择的是另一种抽象：

~~~text
TCP:
Kernel 提供 connection + reliable byte stream

UDP:
Kernel 提供 lightweight datagram transport
~~~

应用完全可以在 UDP 上重新实现：

- reliability；
- ordering；
- retransmission；
- congestion control；
- multiplexed streams。

QUIC 就是典型：

~~~text
HTTP/3
 ↓
QUIC
 ↓
UDP
 ↓
IP
~~~

所以 UDP 的简单是：

> **给上层更多协议设计空间。**

---

# 40. TCP 与 UDP 对比

| 维度 | TCP | UDP |
|---|---|---|
| 建连 | 有连接状态和握手 | 无 TCP 式握手 |
| 数据抽象 | Byte stream | Datagram |
| 消息边界 | 不保留 | 保留 |
| 顺序 | 提供有序字节流 | 不保证 |
| 丢包恢复 | TCP 自己处理 | UDP 本身不处理 |
| Flow Control | 有 | 无内建 |
| Congestion Control | 有 | UDP 本身无内建 |
| Header | 基础头较大且可有 Options | 8 bytes |
| 常见上层 | HTTP/1.1、HTTP/2、SSH | DNS、QUIC、实时媒体等 |

不要背成：

~~~text
视频 = UDP
HTTP = TCP
~~~

现代协议会在更高层重新组合能力。

---

# 41. TCP Keepalive、HTTP Keep-Alive、应用 Heartbeat

## TCP Keepalive

~~~text
Kernel TCP
 ↓
检测长时间空闲 connection 是否仍可达
~~~

## HTTP persistent connection / Keep-Alive

~~~text
HTTP
 ↓
在同一 TCP connection 上复用多个请求
~~~

## Application Heartbeat

~~~text
业务协议
 ↓
判断对端应用 / session 是否健康
~~~

例如 WebSocket Ping/Pong。

三者不是一个东西。

---

# 42. 看 TCP 状态时，快速判断方向

| 状态 | 优先思考 |
|---|---|
| SYN-SENT 很多 | 对端/路径没有完成握手 |
| SYN-RECEIVED 很多 | 握手未完成、SYN 压力、队列问题 |
| ESTABLISHED 很多 | 不一定异常，结合业务并发 |
| CLOSE-WAIT 很多 | 本机应用可能没及时 close |
| FIN-WAIT-2 很多 | 对端迟迟未结束发送方向 |
| TIME-WAIT 很多 | 主动关闭/短连接多，检查复用与连接速率 |

这些只是：

> **排障入口，不是看到状态就直接下结论。**

---

# 43. Windows 实验

查看连接：

~~~powershell
netstat -ano
~~~

重点：

~~~text
Local Address
Foreign Address
State
PID
~~~

PowerShell：

~~~powershell
Get-NetTCPConnection
Get-NetTCPConnection -State Established
Get-NetTCPConnection -State TimeWait
~~~

测试 TCP 443：

~~~powershell
Test-NetConnection example.com -Port 443
~~~

---

# 44. Linux 实验

Listener：

~~~bash
ss -lnt
~~~

连接：

~~~bash
ss -nt
~~~

状态汇总：

~~~bash
ss -s
~~~

筛状态：

~~~bash
ss -nt state time-wait
ss -nt state close-wait
~~~

查看某端口：

~~~bash
ss -lntp | grep :443
~~~

---

# 45. Wireshark 实验

过滤：

~~~text
tcp
~~~

重点观察：

~~~text
SYN
SYN, ACK
ACK
Seq
Ack
Len
Window
TCP Options
Retransmission
Duplicate ACK
SACK
FIN
RST
~~~

尝试回答：

1. Client ephemeral port 是多少？
2. Server port 是多少？
3. SYN / FIN 为什么消耗 sequence number？
4. 握手协商了哪些 Options？
5. ACK 到底确认到哪个 byte？
6. 是否发生重传？
7. 谁主动 close？
8. 谁进入 TIME_WAIT？

---

# 46. 最容易混淆的 18 个点

1. TCP 可靠不等于网络永远不会失败。
2. Port 不是直接属于进程，而是内核 socket 地址的一部分。
3. 一个 443 listener 可以服务大量 connected sockets。
4. NAT 前后观察到的 TCP tuple 可能不同。
5. TCP 与 UDP 可以使用相同数字端口。
6. accept() 不是三次握手完成的必要动作。
7. listen 但不 accept 时，一些握手仍可完成直到队列/资源出问题。
8. 没 listener 和 Firewall drop 的故障表现不同。
9. Sequence Number 主要编号 Byte，不是 Packet。
10. ACK Number 表示下一期待 Byte。
11. TCP 不保存应用消息边界。
12. RTO 与 Fast Retransmit 是不同触发路径。
13. rwnd 保护 Receiver，cwnd 保护 Network。
14. Zero Window Probe 不等于 TCP Keepalive。
15. 四次挥手是逻辑阶段，实际报文可能合并。
16. CLOSE_WAIT 多通常先查应用 close 路径。
17. TIME_WAIT 有协议价值，不应无脑消灭。
18. TCP Keepalive、HTTP Keep-Alive、业务 Heartbeat 是不同层机制。

---

# 47. 一句话记忆

> **TCP 用连接状态、序列号、ACK、重传、rwnd 和 cwnd，把不可靠 IP 上的 Segment 组织成应用可使用的有序字节流；UDP 则保留 Datagram 边界，把更复杂的可靠性和控制留给上层。**

---

# 48. 自测

1. 为什么一个 Server 的 443 可以同时服务大量 Client？
2. fd、socket、port、TCP connection 有什么关系？
3. listen 和 accept 分别做什么？
4. 为什么 listen 了但不 accept，Client 仍可能 connect 成功？
5. 没有 listener 时为什么常见 RST，而 Firewall drop 更像 timeout？
6. TCP 为什么要交换双方 ISN？
7. Sequence Number 为什么是字节位置？
8. ACK=2001 表示什么？
9. 为什么一次 send 不等于一次 recv？
10. RTO 和 Fast Retransmit 分别什么时候发挥作用？
11. SACK 解决什么？
12. rwnd 和 cwnd 分别保护谁？
13. 为什么关闭通常需要双方向分别 FIN？
14. 主动关闭方为什么通常进入 TIME_WAIT？
15. CLOSE_WAIT 多时为什么先查应用？
16. 拔网线后连接为什么可能不会立即消失？
17. 对端进程崩溃和整机断电为什么表现不同？
18. TCP Keepalive 与 HTTP Keep-Alive 有什么区别？
19. TCP 和 UDP 为什么能使用同一个数字端口？
20. QUIC 为什么可以在 UDP 上重新实现可靠传输？

---

# 49. 下一章

下一章进入应用层和安全层：

> **05｜HTTP / HTTPS / TLS：浏览器到底发了什么，TLS 又如何保证“别人看不懂、改不了、冒充不了”？**

将拆解：

~~~text
HTTP Request / Response
Method / Status / Header / Body
Host / :authority
Cookie / Session
HTTP persistent connection

TLS 1.2 vs TLS 1.3
Symmetric Crypto
Public-key Crypto
Hash / AEAD
Digital Signature
ECDHE / HKDF
SNI / ALPN
Certificate Chain
CertificateVerify
Finished
Session Resumption
0-RTT
~~~

并继续坚持：

~~~text
证书签发时间线
≠
用户运行时 TLS 握手时间线
~~~

---

# 50. 延伸阅读

主要参考：

- xiaolincoder/CS-Base · TCP 三次握手与四次挥手
- xiaolincoder/CS-Base · TCP 重传 / 滑动窗口 / 流量控制 / 拥塞控制
- xiaolincoder/CS-Base · TCP 半连接队列与全连接队列
- xiaolincoder/CS-Base · TCP / UDP 端口
- xiaolincoder/CS-Base · TCP 抓包实战

具体链接见 [SOURCES.md](./SOURCES.md)。
