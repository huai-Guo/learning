# 计算机网络扫盲：建设计划

> 目标：把 network 目录建设成一套**计算机小白能顺着读、后端开发能继续深入、面试前能复盘**的网络课程。

主线只保留一条：

> **电脑获得网络配置 → 输入 URL → DNS → 建连 → 路由转发 → TLS → HTTP → 响应返回。**

---

# 1. 当前状态

## Phase 0｜课程骨架

- [x] network 从空文件改成目录
- [x] README 总入口
- [x] HTML 视觉总览
- [x] 参考资料清单
- [x] 确立“参与者边界 + 因果链”教学原则

## Phase 1｜请求主线

- [x] 00：电脑入网前置（DHCP / IP / Gateway / DNS Server）
- [x] 01：URL → DNS → Socket → Route → ARP/NDP → NAT/PAT → TCP → TLS → HTTP
- [x] 第一轮架构 Review
- [x] 修正 Happy Eyeballs 与 connect 的关系
- [x] 修正 NAT/PAT 的参与者位置
- [x] 增加 IPv4 / IPv6 分支
- [x] 增加服务端 LISTEN / accept / connected socket
- [x] 修正 TLS 1.3 的证书验证时序
- [x] 明确 HTTP/3 不走 TCP

当前结论：

> Phase 0/1 已形成可继续扩展的“母图”，后续章节只放大母图中的节点，不重新发明流程。

---

# 2. 全仓库必须遵守的图形规范

以后至少区分四种图，不能混画。

## A. 参与者图：谁在做事

~~~text
Browser
 ↓
OS Kernel
 ↓
Home Router
 ↓
ISP / Internet
 ↓
Server Kernel
 ↓
Server Process
~~~

## B. 协议封装图：数据套了哪些头

~~~text
HTTP
 ↓
TLS
 ↓
TCP
 ↓
IP
 ↓
L2 Frame
~~~

## C. 时序图：谁先发什么

~~~text
Client                  Server
SYN -------------------->
    <------------- SYN+ACK
ACK -------------------->
~~~

## D. 状态/决策图：为什么走这个分支

~~~text
目标 IP
  ↓
Route
  ├─ 同子网 → 下一跳就是目标
  └─ 异网段 → 下一跳是 Gateway
~~~

一个图只回答一类问题。

---

# 3. 章节统一模板

每一章统一包含：

1. 这一章只解决一个问题
2. 先看它在母图中的位置
3. 为什么需要它
4. 最小模型
5. 真实执行流程
6. 参与者边界
7. 常见分支 / 异常
8. 放回 URL 主线
9. 本机实验
10. 最容易混淆的点
11. 一句话记忆
12. 自测
13. 延伸阅读

---

# 4. Phase 2｜网络分层与 OS 收发包

状态：**第一版已完成并落库**

- [x] Markdown 正文：02-network-model-and-packets.md
- [x] HTML 视觉版：02-network-model-and-packets.html
- [x] 四类图严格分离：协议层次 / 封装 / 本机实现 / 设备路径
- [x] 补齐 send → socket → TCP → IP → route → neighbor → qdisc → driver → ring/DMA → NIC
- [x] 补齐接收方向、NAPI、RX Ring、socket receive buffer
- [x] 补齐 MTU/MSS、IPv4 fragmentation、PMTU 与 GSO/TSO/GRO 的入门边界

文件：02-network-model-and-packets.md

核心问题：

> 应用调用 send()/recv() 后，数据究竟如何穿过用户态、内核、驱动和网卡？

必须覆盖：

- TCP/IP 四层与 OSI 七层
- “属于哪一层”到底是什么意思
- HTTP → TLS → TCP → IP → L2 封装
- 服务端反向解封装
- User Process / syscall / Socket
- TCP / IP / Route / Netfilter
- Neighbor subsystem
- qdisc
- Driver
- TX/RX Ring
- DMA
- NIC
- interrupt / softirq / NAPI（先建立概念，不深挖内核源码）
- MTU / MSS
- TCP segmentation 与 IP fragmentation 的区别

主要参考：

- CS-Base/network/1_base/tcp_ip_model.md
- CS-Base/network/1_base/how_os_deal_network_package.md
- CS-Base/network/1_base/what_happen_url.md

---

# 5. Phase 3｜IP、子网、路由、ARP/NDP、NAT

文件：03-ip-routing-arp-nat.md

核心问题：

> 已经知道目标 IP 后，包到底为什么能一跳一跳到目标？

必须覆盖：

- IPv4 / IPv6
- CIDR / 子网掩码
- 网络地址、主机地址
- 私网 / 公网
- 默认网关
- 路由表
- 最长前缀匹配
- 直连路由 / 默认路由
- ARP + ARP Cache
- IPv6 NDP
- MAC 只负责当前链路
- DHCP
- ICMP
- ping
- traceroute / tracert
- NAT / SNAT / DNAT
- PAT / NAPT
- Conntrack
- 为什么 NAT 返回包知道回哪台内网机器
- CGNAT 作为进阶
- NAT 穿透只做概览

---

# 6. Phase 4｜TCP / UDP

文件：04-tcp-udp.md

主线：

> IP 只负责“尽力送包”，TCP 为什么还能提供可靠字节流？

必须覆盖：

- Socket 与 TCP connection
- 四元组
- 临时端口
- LISTEN socket / connected socket
- SYN / ACK / FIN / RST
- 三次握手
- 为什么不能两次
- 四次挥手
- TIME_WAIT
- Seq / Ack
- 重传
- RTT / RTO
- Fast Retransmit
- Sliding Window
- Flow Control
- Congestion Control
- Keepalive
- 半连接队列 / accept queue
- TCP 字节流
- UDP 报文语义
- TCP/UDP 是否能用同一个端口
- MTU/MSS 的衔接

增加“故障理解状态机”模块：

- 服务端没 listen 会怎样
- listen 了但没 accept 会怎样
- SYN 丢了会怎样
- 进程崩溃 vs 主机断电
- 拔网线后连接是否还存在
- TIME_WAIT 为什么存在
- 长时间空闲如何发现对端失效

---

# 7. Phase 5｜HTTP / HTTPS / TLS

文件：05-http-https-tls.md

HTTP：

- Request / Response
- method
- status code
- header / body
- Host / :authority
- Cookie / Session
- HTTP Keep-Alive
- 缓存
- Content-Length / chunked
- HTTP/1.1 连接复用

TLS：

- TLS 1.2 vs TLS 1.3
- 对称加密
- 非对称密码
- Hash
- MAC / AEAD
- 数字签名
- ECDHE
- HKDF
- 前向保密
- ClientHello
- SNI
- ALPN
- ServerHello
- Certificate
- Intermediate CA / Root CA
- Trust Store
- CertificateVerify
- Finished
- CRL / OCSP
- Session Resumption
- 0-RTT（进阶）
- ECH（进阶）

必须坚持两个时间轴：

~~~text
证书签发：
Site → CA → Certificate → 部署

运行时 TLS：
Browser ↔ Server
~~~

---

# 8. Phase 6｜HTTP/2、HTTP/3、QUIC、WebSocket、RPC

文件：06-modern-protocols.md

- HTTP/1.1 应用层队头阻塞
- HTTP/2 frame / stream / multiplexing
- TCP 层队头阻塞
- QUIC 为什么建立在 UDP 上
- QUIC connection ID
- QUIC stream
- TLS 1.3 如何集成进 QUIC
- HTTP/3
- 网络迁移
- WebSocket Upgrade / 双向长连接
- RPC 是什么
- HTTP 与 RPC 的关系
- 服务发现
- DNS / CoreDNS / Consul / etcd

---

# 9. Phase 7｜真实后端网络拓扑

文件：07-backend-network-topology.md

贯穿：

~~~text
Browser
 → DNS
 → CDN
 → WAF
 → L4/L7 Load Balancer
 → Nginx / API Gateway
 → Backend Service
 → RPC
 → Redis / MySQL
~~~

重点：

- 域名最终可能先指向 Edge/CDN，而不是业务机器
- CDN
- WAF
- 正向代理 / 反向代理
- L4 / L7 Load Balancer
- TLS termination
- X-Forwarded-For
- Proxy Protocol
- API Gateway
- 内网 DNS / 服务发现
- 连接池
- 长连接
- 超时
- 重试
- 幂等

---

# 10. Phase 8｜动手实验

文件：08-labs.md

Windows 为第一路线，同时给 Linux 对照。

## DNS

- nslookup
- ipconfig /displaydns
- ipconfig /flushdns
- hosts

## IP / Route / ARP

- ipconfig /all
- route print
- arp -a
- ping
- tracert

Linux 对照：

- ip addr
- ip route
- ip neigh
- dig
- traceroute

## TCP / TLS / HTTP

- netstat / ss
- curl -v
- openssl s_client
- 浏览器 DevTools
- Wireshark

每个实验必须写：

~~~text
执行什么
 ↓
看哪一列
 ↓
它证明了母图里的哪一步
 ↓
看到异常意味着什么
~~~

---

# 11. Phase 9｜面试与复盘

文件：09-review-and-interview.md

不做孤立八股题库，按因果链组织：

- 域名为什么不是 IP + Port
- DNS 为什么分层
- Stub Resolver / Recursive Resolver
- 为什么先 Route 后 ARP
- 为什么 ARP 不一定找网关
- 为什么 MAC 每一跳会变
- NAT 与 PAT 的关系
- 为什么公网返回包能回到正确内网进程
- 临时端口属于谁管理
- TCP 四元组
- 三次握手为什么三次
- TIME_WAIT
- TCP Keepalive vs HTTP Keep-Alive
- TLS 中 ECDHE key share 与证书公钥区别
- CA 为什么不每次实时审批
- SNI / Host / :authority 区别
- HTTP/2 与 HTTP/3
- WebSocket 与 HTTP
- RPC 与 HTTP

---

# 12. 准确性红线

后续任何章节都不得违反：

- DNS 地址解析与 URL 端口来源分开讲。
- Stub Resolver 作为角色解释，不伪装成固定独立进程。
- Happy Eyeballs = 排序 + 错峰 connect 竞争。
- TCP SYN 已存在后，才被 Route / ARP / NAT / Internet transport。
- Route 先决定下一跳，ARP/NDP 再解决当前链路邻居。
- ARP 只用于 IPv4；IPv6 使用 NDP 等机制。
- NAT/PAT 画在 NAT Router 中，不画进 Browser/OS protocol stack。
- NAPT/PAT 作为一次状态化映射解释，不机械拆成 NAT → PAT。
- TLS 1.2 / TLS 1.3 分开。
- ECDHE 临时密钥与证书身份公钥分开。
- 数字签名 = 私钥签名、公钥验证。
- CA 的事前签发与运行时验证分两个时间轴。
- HTTP/3 = QUIC/UDP，不强行套 TCP 主线。
- 任何简化必须显式写“这里为了入门省略了什么”。

---

# 13. 参考策略

以 xiaolincoder/CS-Base/network 作为知识覆盖参考，但不照抄章节结构。

本项目自己的组织原则：

> **先因果链 → 再协议细节 → 再 OS 实现 → 再真实后端 → 最后面试复盘。**

详细来源见 SOURCES.md。
