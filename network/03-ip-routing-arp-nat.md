# 03｜IP、CIDR、Route、ARP/NDP、ICMP、NAT：一个 IP 包为什么真的能找到另一台机器？

> 这一章只解决一个问题：
>
> **当操作系统已经知道目标 IP 后，它到底怎样判断“下一跳是谁”，并让数据包跨越一个又一个网络，最终到达目标主机？**

上一章把镜头放在一台电脑内部：

~~~text
Process
 ↓
Socket
 ↓
TCP
 ↓
IP
 ↓
Route
 ↓
Neighbor
 ↓
Driver / NIC
~~~

这一章从 IP / Route / Neighbor 开始，把镜头拉到整个网络。

本章继续沿用：

~~~text
Laptop
192.168.1.20/24

Default Gateway
192.168.1.1

目标 Server
203.0.113.20
~~~

203.0.113.0/24、198.51.100.0/24 是文档示例地址，不代表真实公网服务。

---

# 0. 先看母图：这一章放大哪一段？

~~~mermaid
flowchart LR
    A["Application / TCP"]
    IP["IP Packet<br/>dst=203.0.113.20"]
    RT["Route Lookup"]
    NH["Next Hop"]
    NB["ARP (IPv4)<br/>NDP (IPv6)"]
    L2["L2 Frame"]
    R["Router"]
    NAT["NAT/PAT<br/>典型家庭 IPv4"]
    I["Internet Routers"]
    S["Server Network"]

    A --> IP --> RT --> NH --> NB --> L2 --> R --> NAT --> I --> S
~~~

这一章真正区分四件事：

~~~text
IP：
最终目标是谁？

Route：
为了去最终目标，下一跳走谁？

ARP/NDP：
当前链路上，下一跳怎么真正找到？

NAT/PAT：
经过某些边界设备时，地址/端口是否被改写？
~~~

---

# 1. IP 地址更准确地说，是接口上的网络地址

初学时经常说：

> 一台电脑有一个 IP。

这只是简化。

真实机器可能同时有：

~~~text
Wi-Fi      192.168.1.20
Ethernet   10.0.0.8
VPN        172.20.0.5
Loopback   127.0.0.1
IPv6       2001:db8:...
~~~

所以更准确：

> **IP 地址通常配置在网络接口上；一台机器完全可以同时拥有多个 IP。**

路由器尤其明显：

~~~text
LAN interface    192.168.1.1
WAN interface    运营商/公网侧地址
其他 interface   ...
~~~

路由器能够连接多个网络，本质上就是：

> 它有多个接口，并根据路由信息决定包从哪个接口继续走。

---

# 2. IPv4 的 32 位和点分十进制

IPv4：

~~~text
192.168.1.20
~~~

本质是 32 bit：

~~~text
11000000 10101000 00000001 00010100
~~~

点分十进制只是方便人阅读。

真正做网络划分和路由匹配时，最重要的是：

> **前多少位是网络前缀。**

这就进入 CIDR。

---

# 3. CIDR：192.168.1.20/24 中的 /24 是什么？

~~~text
192.168.1.20/24
~~~

表示：

~~~text
前 24 bit = network prefix
后  8 bit = host/interface 部分
~~~

与 /24 mask 做 AND：

~~~text
IP:
11000000.10101000.00000001.00010100

Mask:
11111111.11111111.11111111.00000000

AND
───────────────────────────────────
11000000.10101000.00000001.00000000
=
192.168.1.0
~~~

所以网络前缀是：

~~~text
192.168.1.0/24
~~~

在最常见的传统 IPv4 /24 教学场景中：

~~~text
network address   192.168.1.0
host addresses    192.168.1.1 ~ 192.168.1.254
broadcast         192.168.1.255
~~~

但不要把“地址数永远减 2”当成所有 IPv4 前缀的绝对规则。点到点链路和特殊前缀存在不同语义。

---

# 4. /24、/25、/26 为什么大小不一样？

核心：

~~~text
host bits = 32 - prefix length
address count = 2 ^ host bits
~~~

例如：

~~~text
/24 → 2^8 = 256 addresses
/25 → 2^7 = 128
/26 → 2^6 = 64
/27 → 2^5 = 32
/28 → 2^4 = 16
/29 → 2^3 = 8
/30 → 2^2 = 4
~~~

192.168.1.0/24 如果切成 /26：

| 子网 | 地址块 |
|---|---|
| 192.168.1.0/26 | .0 ~ .63 |
| 192.168.1.64/26 | .64 ~ .127 |
| 192.168.1.128/26 | .128 ~ .191 |
| 192.168.1.192/26 | .192 ~ .255 |

前缀越长：

> 网络划得越细，每个网络包含的地址越少。

---

# 5. 同网段与异网段，决定“下一跳是谁”

本机：

~~~text
192.168.1.20/24
~~~

## 场景 A：访问 192.168.1.50

目标也属于：

~~~text
192.168.1.0/24
~~~

于是：

~~~text
Route
 ↓
directly connected
 ↓
next hop = 192.168.1.50
 ↓
ARP 192.168.1.50
~~~

## 场景 B：访问 203.0.113.20

目标不属于本地直连网段：

~~~text
Route
 ↓
找不到更具体直连路由
 ↓
default route
 ↓
next hop = 192.168.1.1
 ↓
ARP 192.168.1.1
~~~

所以真正记忆是：

> **ARP 找的是 Route 决定出来的 IPv4 下一跳，不是永远找默认网关。**

---

# 6. 路由表到底存什么？

先把路由表理解成：

> 去某个目标前缀时，从哪个接口、经哪个下一跳走。

示例：

~~~text
Destination       Next Hop       Interface
────────────────────────────────────────────
192.168.1.0/24    direct         Wi-Fi
10.0.0.0/8        192.168.1.254  Wi-Fi
0.0.0.0/0         192.168.1.1    Wi-Fi
~~~

目标如果是：

~~~text
10.2.3.4
~~~

既能匹配：

~~~text
10.0.0.0/8
0.0.0.0/0
~~~

但真正选择更具体的那一条。

---

# 7. 最长前缀匹配：为什么 /24 胜过 /16？

假设：

~~~text
10.0.0.0/8       → Router A
10.1.0.0/16      → Router B
10.1.2.0/24      → Router C
0.0.0.0/0        → Default Router
~~~

目标：

~~~text
10.1.2.99
~~~

它同时匹配四条。

最后选择：

~~~text
10.1.2.0/24
~~~

因为 /24 更具体。

流程：

~~~text
dst IP
 ↓
找到所有可匹配前缀
 ↓
选择 prefix length 最大的
 ↓
得到 next hop / egress interface
~~~

这就是 Longest Prefix Match。

---

# 8. 默认路由为什么是 0.0.0.0/0？

0.0.0.0/0 的意思是：

~~~text
要求匹配的前缀位数 = 0
~~~

所以任何 IPv4 都能匹配。

但 /0 是最不具体的路由。

因此：

~~~text
更具体路由优先
 ↓
都没有
 ↓
才用 default route
~~~

默认路由是：

> **兜底规则，不是优先级最高的规则。**

---

# 9. 主机并不知道“完整互联网路径”

主机做完 route lookup，可能只知道：

~~~text
next hop = 192.168.1.1
egress = Wi-Fi
~~~

它并不知道后面完整路径。

真实互联网：

~~~text
Client
 ↓ 只决定自己的下一跳
Router 1
 ↓ 再决定自己的下一跳
Router 2
 ↓ 再决定自己的下一跳
...
Server Network
~~~

这叫：

> **逐跳转发。**

---

# 10. BGP 和真正转发每个包，不是一回事

可以分成两个平面。

## Control Plane

负责学习：

~~~text
哪些 prefix 从哪里可达？
~~~

可能来自：

- BGP
- OSPF
- IS-IS
- static route
- SDN/controller
- 运营商策略

## Data Plane

真正一个包到来：

~~~text
dst IP
 ↓
查 FIB / forwarding table
 ↓
选 egress / next hop
 ↓
forward
~~~

一句话：

> **BGP 帮助形成地图，FIB 才是高速转发时真正查的路标表。**

---

# 11. TTL / Hop Limit：防止包永远绕圈

IPv4 有：

~~~text
TTL
~~~

每经过一个 Router：

~~~text
TTL = TTL - 1
~~~

变成 0 时：

~~~text
drop packet
 ↓
通常返回 ICMP Time Exceeded
~~~

核心意义：

> 防止路由环路让 packet 永远存在。

IPv6 对应字段叫：

~~~text
Hop Limit
~~~

---

# 12. ARP：Route 知道下一跳 IP，但 Ethernet 还不知道 MAC

当前：

~~~text
next hop = 192.168.1.1
~~~

Ethernet 还需要：

~~~text
dst MAC = ?
~~~

于是：

~~~mermaid
sequenceDiagram
    participant C as Laptop
    participant LAN as Local LAN
    participant R as Router 192.168.1.1

    C->>LAN: ARP Request (broadcast)<br/>Who has 192.168.1.1?
    LAN->>R: 同广播域设备收到请求
    R-->>C: ARP Reply<br/>192.168.1.1 is AA:BB:CC:DD:EE:FF
~~~

最终：

~~~text
Ethernet
src MAC = Laptop MAC
dst MAC = Router MAC

IP
src IP = 192.168.1.20
dst IP = 203.0.113.20
~~~

最关键：

~~~text
dst MAC = 当前下一跳
dst IP  = 最终目标
~~~

它们可以完全不同。

---

# 13. ARP Cache：为什么不是每个包都广播？

第一次：

~~~text
ARP Request
 ↓
ARP Reply
 ↓
Neighbor / ARP Cache
~~~

后面：

~~~text
next hop
 ↓
查缓存
 ↓
有有效条目
 ↓
直接构造 L2 Frame
~~~

真实操作系统的邻居缓存通常有生命周期和状态机。

可能出现：

~~~text
reachable
stale
delay
probe
incomplete
~~~

具体状态名称和行为依 OS 而不同。

所以不要死背：

> ARP 一定缓存固定几分钟。

更准确：

> **系统维护有生命周期的邻居状态，必要时重新验证或重新解析。**

---

# 14. Switch 的 MAC Table 与 Route Table 不一样

Laptop 发出的 Frame：

~~~text
dst MAC = Router MAC
~~~

中间可能经过 Switch / AP。

交换机主要查：

~~~text
MAC Address Table
~~~

决定：

~~~text
这个 MAC 从哪个 switch port 发出去？
~~~

而主机/路由器的 Route Table 是：

~~~text
目标 IP prefix
 ↓
next hop / egress interface
~~~

所以：

~~~text
Route Table
≠
Switch MAC Table
~~~

如果交换机尚不知道某个目标 MAC 所在端口，可能对未知单播进行 flooding；随后通过源 MAC 学习更新表项。

---

# 15. 为什么每过一个 Router，L2 Header 都要换？

第一跳：

~~~text
Laptop MAC
  →
Router-1 MAC

IP:
192.168.1.20
  →
203.0.113.20
~~~

Router-1 收到：

~~~text
当前 L2 Header 使命完成
 ↓
解析 IP
 ↓
Route Lookup
 ↓
找到 Router-2
 ↓
重新构造下一条链路的 L2 Header
~~~

下一跳可能变成：

~~~text
Router-1-out MAC
  →
Router-2 MAC
~~~

因此在没有 NAT 的简单场景：

~~~text
IP src/dst：
通常端到端保持

L2/MAC：
逐跳变化
~~~

NAT 是 IP/port 也可能被改写的重要例外。

---

# 16. IPv6 为什么不用 ARP？

IPv6 使用 NDP / Neighbor Discovery。

典型邻居解析：

~~~text
IPv6 next hop
 ↓
Neighbor Solicitation
 ↓
Neighbor Advertisement
 ↓
得到 link-layer address
~~~

NDP 基于 ICMPv6，大量使用 multicast，不照搬 IPv4 ARP broadcast。

IPv6 还会通过 Router Advertisement 帮助主机：

- 发现路由器
- 获得前缀信息
- SLAAC 自动配置
- 了解其他链路参数

所以：

> **IPv6 不只是“地址变长的 IPv4”。**

---

# 17. ICMP：IP 世界为什么需要反馈通道？

网络中会出现：

~~~text
目标不可达
TTL 归零
路径异常
需要诊断连通性
~~~

ICMP 用于承载大量网络层控制与差错信息。

可以先记：

> **ICMP 是 IP 世界的反馈/诊断机制之一。**

但 ICMP 不是 TCP ACK，它们职责完全不同。

---

# 18. ping 到底做了什么？

经典 IPv4 ping：

~~~text
ICMP Echo Request
        ↓
target
        ↓
ICMP Echo Reply
~~~

~~~mermaid
sequenceDiagram
    participant A as Host A
    participant R as Routers
    participant B as Host B

    A->>R: ICMP Echo Request
    R->>B: forward
    B-->>R: ICMP Echo Reply
    R-->>A: forward
~~~

ping 可以观察：

- 是否收到 Echo Reply
- RTT
- 丢包

但是：

> **ping 不通，不等于 HTTPS 一定不通。**

因为 ICMP 可能被过滤，而 TCP/443 仍正常。

反过来也一样：

> ping 通只说明某种 ICMP 往返成功，不代表 Web 服务健康。

---

# 19. traceroute / tracert 为什么能看到每一跳？

核心利用 TTL / Hop Limit。

第一次：

~~~text
TTL = 1
 ↓
Router 1
 ↓
TTL = 0
 ↓
ICMP Time Exceeded
~~~

第二次：

~~~text
TTL = 2
 ↓
Router 1 → 1
 ↓
Router 2 → 0
 ↓
ICMP Time Exceeded
~~~

继续：

~~~text
TTL = 3
TTL = 4
...
~~~

就能逐步看到路径上的响应节点。

注意：

- Windows tracert 常用 ICMP Echo
- Unix/Linux 传统 traceroute 常见 UDP 探测
- 也可以有 TCP/ICMP 等不同模式

核心不是某一种探测报文，而是：

> **故意让 TTL 在第 N 跳耗尽，再用 ICMP Time Exceeded 推断这一跳。**

---

# 20. 私网地址为什么可以重复？

常见 IPv4 私网：

~~~text
10.0.0.0/8
172.16.0.0/12
192.168.0.0/16
~~~

你家：

~~~text
192.168.1.20
~~~

别人家也可以：

~~~text
192.168.1.20
~~~

因为这些地址只在各自私有网络内部有意义，并不作为普通全球互联网可路由地址使用。

那么：

> 私网主机怎么访问公网？

这就进入 NAT。

---

# 21. NAT：边界设备上的地址改写

出站前：

~~~text
src = 192.168.1.20
dst = 203.0.113.20
~~~

家庭 Router 公网地址假设：

~~~text
198.51.100.8
~~~

典型 Source NAT：

~~~text
192.168.1.20
      ↓
198.51.100.8
~~~

如果还使用端口复用：

~~~text
192.168.1.20:53124
        ↓
198.51.100.8:62001
~~~

家庭 IPv4 常见的是 NAPT/PAT 模型：

> **地址 + 端口共同参与映射，让大量内网连接共享有限公网 IPv4。**

---

# 22. NAT 与 PAT 不该画成两个机械串行盒子

错误：

~~~text
NAT
 ↓
PAT
 ↓
Internet
~~~

更准确：

~~~text
Router receives packet
        ↓
conntrack / NAT policy
        ↓
建立或复用映射状态
        ↓
inside
192.168.1.20:53124
        ↕
outside
198.51.100.8:62001
        ↓
forward
~~~

外部端口如何选择、能否复用、映射是否和远端 endpoint 有关，取决于设备实现和 NAT 行为。

所以：

> **不要把一个教学例子里的公网端口规则，当成所有 NAT 的全球统一算法。**

---

# 23. 返回包为什么知道回哪台内网电脑？

出站时 Router 已保存连接/NAT 状态：

~~~text
protocol = TCP

inside:
192.168.1.20:53124

outside:
198.51.100.8:62001

remote:
203.0.113.20:443
~~~

Server 返回：

~~~text
203.0.113.20:443
        →
198.51.100.8:62001
~~~

Router：

~~~text
查 conntrack / NAT state
 ↓
reverse translation
 ↓
192.168.1.20:53124
 ↓
LAN route / neighbor
 ↓
Laptop
~~~

所以服务器通常根本不知道：

~~~text
192.168.1.20
~~~

这个私网地址。

它看到的是 NAT 后的公网表示。

---

# 24. SNAT、DNAT、PAT 分别是什么？

## SNAT

Source NAT：

~~~text
修改 source address
~~~

典型：

~~~text
192.168.1.20
 ↓
198.51.100.8
~~~

常用于内部访问外部。

## DNAT

Destination NAT：

~~~text
修改 destination address
~~~

例如：

~~~text
198.51.100.8:8443
        ↓
192.168.1.100:443
~~~

常见于端口转发/把公网入口映射到内部服务。

## PAT / NAPT

端口也参与映射：

~~~text
192.168.1.20:53124
        ↓
198.51.100.8:62001
~~~

---

# 25. NAT 和 Firewall 是一回事吗？

不是。

NAT：

> **改地址/端口。**

Firewall：

> **根据规则允许、拒绝或处理流量。**

家庭路由器常把很多能力放在同一个盒子里：

~~~text
Routing
NAT
Conntrack
Stateful Firewall
DHCP
DNS Forwarder
Wi-Fi AP
Switch
~~~

所以看起来容易混。

NAT 可能让外部主动连接内部更困难，但：

> **不要把 NAT 本身当成安全策略。**

真正安全控制应该看 firewall / ACL / policy。

---

# 26. 为什么从公网直接访问家里服务比较麻烦？

外部来了一个：

~~~text
dst = 198.51.100.8:62001
~~~

如果 Router 没有现成映射，也没有 DNAT 规则，它不知道：

~~~text
转给 192.168.1.20？
还是 192.168.1.30？
~~~

因此可能需要：

- port forwarding
- DNAT
- UPnP / NAT-PMP / PCP
- NAT traversal
- reverse tunnel
- VPN
- 公网 IPv6

这就是 P2P、音视频、游戏联机经常碰到 NAT traversal 的原因之一。

---

# 27. CGNAT：你家的 WAN IP 也可能不是公网 IPv4

现实中：

~~~text
Laptop
192.168.1.20
 ↓
Home Router NAT
 ↓
100.64.x.x
 ↓
Carrier-Grade NAT
 ↓
Public IPv4
 ↓
Internet
~~~

这就是 CGNAT 类场景。

影响：

- 入站端口映射更困难
- P2P 更复杂
- 多个用户共享公网 IPv4
- 运营商需要维护更大量映射状态

所以：

> “路由器 WAN 口有 IP”不等于“我拥有独享公网 IPv4”。

---

# 28. IPv6 为什么通常不需要 IPv4 那样依赖 NAPT？

IPv6 地址空间巨大。

典型设计：

~~~text
Client Global IPv6
 ↓
Router
 ↓
Internet
 ↓
Server Global IPv6
~~~

因此不需要因为地址短缺而像家庭 IPv4 那样依赖 NAPT。

但：

- 仍需要 routing
- 仍需要 firewall
- 仍可能存在 NAT66 等特定部署

最重要：

> **没有 NAT，不代表没有安全边界。**

---

# 29. NAT 前后，抓包看到的四元组为什么不同？

Laptop 内侧：

~~~text
192.168.1.20:53124
        →
203.0.113.20:443
~~~

Router WAN / Server 侧：

~~~text
198.51.100.8:62001
        →
203.0.113.20:443
~~~

所以同一条逻辑会话：

> 在不同抓包点看到的 L3/L4 tuple 可以不同。

这也是学习 Wireshark 时非常重要的“观察点”概念。

---

# 30. 整条出站链再走一次

~~~text
【Client】

TCP SYN
src 53124
dst 443
 ↓
IP
src 192.168.1.20
dst 203.0.113.20
 ↓
Route
 ↓
next hop 192.168.1.1
 ↓
ARP / cache
 ↓
Router MAC
 ↓
L2 Frame

────────────────────────

【Home Router】

receive
 ↓
route / conntrack / policy
 ↓
NAT/PAT
 ↓
src 198.51.100.8:62001
dst 203.0.113.20:443
 ↓
WAN forwarding

────────────────────────

【Internet Routers】

dst 203.0.113.20
 ↓
FIB lookup
 ↓
next hop
 ↓
TTL - 1
 ↓
repeat

────────────────────────

【Destination Network】

route says direct
 ↓
neighbor resolution
 ↓
Server
~~~

---

# 31. 返回链再走一次

~~~text
Server
203.0.113.20:443
 ↓
198.51.100.8:62001

Internet
 ↓

Home Router
 ↓
conntrack / NAT lookup
 ↓
reverse NAT
 ↓
192.168.1.20:53124
 ↓
neighbor
 ↓

Laptop
 ↓
TCP socket lookup
 ↓
Browser
~~~

两个关键状态：

~~~text
Router:
conntrack / NAT state

Laptop:
TCP socket state
~~~

分别解决：

~~~text
公网返回包应该进哪台内网主机？

到达本机的 TCP 数据应该给哪个 socket？
~~~

---

# 32. ping、traceroute、curl 测的不是一回事

| 工具 | 更接近测试什么 |
|---|---|
| ping | ICMP Echo 往返 |
| tracert / traceroute | TTL/Hop Limit 与路径反馈 |
| nslookup / dig | DNS |
| curl | HTTP/HTTPS |
| Test-NetConnection | Windows TCP 端口与网络诊断 |
| arp / ip neigh | 邻居缓存 |
| route / ip route | 本机路由 |

所以排障不能写：

~~~text
ping 不通
=
网站挂了
~~~

而应该按层继续确认。

---

# 33. Windows 实验

## 看 IP / Gateway / DNS

~~~powershell
ipconfig /all
~~~

## 看路由表

~~~powershell
route print
~~~

重点找：

~~~text
0.0.0.0
0.0.0.0
Gateway ...
~~~

## 看 Neighbor / ARP

~~~powershell
arp -a
~~~

或者：

~~~powershell
Get-NetNeighbor
~~~

## 看路径

~~~powershell
tracert 1.1.1.1
~~~

第一跳通常很值得观察：

> 是不是你的家庭网关？

中间出现星号不一定代表断网，也可能是设备不响应该探测。

## 测 TCP 443

~~~powershell
Test-NetConnection example.com -Port 443
~~~

这样能看到：

> ICMP 连通性和 TCP 端口连通性不是同一个东西。

---

# 34. Linux 对照

~~~bash
ip addr
ip route
ip neigh
ping 1.1.1.1
traceroute 1.1.1.1
ss -nt
~~~

典型 route：

~~~text
default via 192.168.1.1 dev wlan0
192.168.1.0/24 dev wlan0
~~~

它几乎直接翻译成：

~~~text
同网段
→ direct

其他目标
→ default gateway
~~~

---

# 35. 本章最容易混淆的 16 个点

1. IP 更准确是接口地址，一台机器可有多个。
2. /24 表示前 24 位是网络前缀。
3. 路由表不等于“只有一个默认网关”。
4. 最长前缀匹配意味着更具体路由优先。
5. 默认路由只是兜底。
6. 主机只决定下一跳，不需要知道完整 Internet 路径。
7. BGP 主要帮助形成路由信息，FIB 才用于快速转发。
8. ARP 找的是 IPv4 下一跳，不一定是网关。
9. ARP Cache 有状态和生命周期。
10. Switch MAC Table 和 Route Table 不是一回事。
11. L2 Header 每跳变化；无 NAT 时 IP src/dst 通常保持。
12. IPv6 不使用 ARP，而使用 NDP 等机制。
13. ping 不通不能直接证明 TCP/HTTPS 不通。
14. traceroute 的核心是 TTL/Hop Limit，探测报文类型依实现。
15. NAT 与 Firewall 是两个概念。
16. PAT 映射行为依实现，不要把教学端口映射当成全局铁律。

---

# 36. 一句话记忆

> **IP 负责“最终去哪里”，Route 负责“下一跳走哪里”，ARP/NDP 负责“当前链路怎么找到下一跳”，Router 逐跳转发，而 NAT/PAT 可能在边界上改写地址/端口并保存状态。**

---

# 37. 自测

1. 192.168.1.20/24 的网络前缀是什么？
2. 10.1.2.99 同时匹配 /8、/16、/24 时为什么选 /24？
3. default route 为什么是 0.0.0.0/0？
4. 同子网通信时 ARP 应该问谁？
5. 为什么公网 Server 的 IP 是最终目标，但第一跳 MAC 是家庭 Router？
6. 为什么 Router 每转发一跳都需要新的 L2 Header？
7. BGP 和 FIB 分别做什么？
8. ping 不通为什么不能直接说明 HTTPS 不通？
9. traceroute 为什么递增 TTL 能逐跳发现节点？
10. NAT 与 PAT 的关系是什么？
11. 返回包为什么知道回 192.168.1.20:53124？
12. SNAT 与 DNAT 分别改什么？
13. 为什么 NAT 不等于 Firewall？
14. CGNAT 为什么让入站端口映射更困难？
15. IPv6 为什么通常不依赖 IPv4 家庭网络那种 NAPT？

---

# 38. 下一章

下一章进入传输层：

> **04｜TCP / UDP：IP 只是尽力交付，TCP 为什么还能提供“可靠字节流”？**

会从：

~~~text
Socket
四元组
SYN / ACK
Sequence Number
Receive Window
Retransmission
Congestion Control
TIME_WAIT
Keepalive
Listen / Accept Queue
~~~

一直讲到真实故障：

~~~text
SYN 丢了怎么办？
服务端没有 listen 会怎样？
listen 但长期不 accept 呢？
拔网线后连接为什么可能还存在？
服务器断电和进程崩溃有什么区别？
~~~

---

# 39. 延伸阅读

主要参考知识覆盖：

- xiaolincoder/CS-Base · IP 基础知识全家桶
- xiaolincoder/CS-Base · ping 的工作原理
- xiaolincoder/CS-Base · 键入网址到网页显示

具体链接见 [SOURCES.md](./SOURCES.md)。
