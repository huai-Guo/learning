# 计算机网络扫盲：建设计划

> 目标：把 `network` 从一个空占位文件改造成一个**面向计算机网络初学者、但最终能衔接后端开发与面试**的系统学习目录。
>
> 主线不从“协议定义”背起，而从一个真实问题贯穿全文：
>
> **“我在浏览器输入 `https://shop.example.com/products`，直到页面出现，中间到底发生了什么？”**

## 1. 内容原则

1. **因果优先**：先回答“为什么需要它”，再讲“它是什么、怎么实现”。
2. **只保持一条主链**：URL → DNS → 地址选择 → Socket → Route → ARP → Ethernet → NAT/PAT → Internet Routing → TCP → TLS → HTTP。
3. **严格区分角色与边界**：浏览器 / 用户态、OS 内核、网卡、家庭路由器、ISP、目标服务器、DNS、CA。
4. **严格区分“逻辑层次”和“真实时序”**：
   - TCP SYN 产生后，Route / ARP / NAT / Internet Routing 是在**运输这个 TCP 报文**，不是“TCP 之前另有一套流程”。
   - NAT 与 PAT 在常见家用 NAPT 场景中是一次连接映射，不机械画成两个串行设备。
   - CA 主要在连接前签发证书；浏览器访问时主要做本地证书链验证，不把 CA 画成每次实时审批者。
5. **小白友好但不失真**：可以简化，但简化处必须明确标注。
6. **每章都包含**：
   - 一张 ASCII/文字结构图；
   - 一个贯穿例子；
   - “最容易误解的地方”；
   - “一句话记忆”；
   - 3～5 个自测题；
   - 可选的本机实验。
7. **参考 xiaolincoder/CS-Base 的知识覆盖，不直接复制其正文**，使用自己的结构和表达重新组织。

## 2. 总目录设计

### Phase 0：入口与总地图

- [x] 把仓库根目录下的 `network` 空文件改为 `network/` 目录。
- [x] 建立本计划。
- [x] 建立总 README 与学习路线。
- [x] 建立“输入 URL 到页面返回”的主链章节。

### Phase 1：一条请求跑通全网

文件：`01-url-to-webpage.md`

目标：让初学者第一次把这些概念真正串起来：

```text
URL
 ↓
DNS
 ↓
A / AAAA
 ↓
Happy Eyeballs
 ↓
socket + 临时端口
 ↓
TCP SYN
 ↓
Route
 ↓
ARP / 下一跳 MAC
 ↓
Ethernet
 ↓
NAT/PAT
 ↓
Internet Routing
 ↓
Server
 ↓
TCP 建连
 ↓
TLS 1.3 + 证书验证
 ↓
HTTP
 ↓
响应返回
```

重点补齐：
- URL 中 scheme / host / port / path / query / fragment；
- HTTP/HTTPS 默认端口；
- Browser/OS cache、hosts、Stub Resolver、Recursive Resolver；
- Root → TLD → Authoritative；
- A/AAAA 与 Happy Eyeballs；
- 进程、fd、内核 socket、临时端口、TCP 四元组；
- 路由表为什么在 ARP 前；
- “最终目标 IP”与“下一跳 MAC”为什么不是一个东西；
- NAT/PAT 映射表；
- 互联网多跳转发与 BGP 的角色；
- TCP 三次握手；
- TLS 1.3：SNI、ALPN、ECDHE、Certificate、CertificateVerify、Finished；
- CA 的“事先签发”与浏览器“连接时验链”；
- HTTP Request/Response。

### Phase 2：网络分层与“包到底长什么样”

文件：`02-network-model-and-packets.md`

内容：
- TCP/IP 四层模型与 OSI 七层模型怎么对应；
- “协议属于哪一层”真正意味着什么；
- 应用数据如何经历 HTTP → TLS → TCP → IP → Ethernet 封装；
- 服务端收到后如何反向解封装；
- MTU、MSS、分片/分段的最小认知；
- 网卡、驱动、内核协议栈、用户进程之间的边界；
- Linux/Windows 网络收发的简化路径。

参考：
- `network/1_base/tcp_ip_model.md`
- `network/1_base/how_os_deal_network_package.md`

### Phase 3：IP、子网、路由、ARP、NAT

文件：`03-ip-routing-arp-nat.md`

内容：
- IPv4/IPv6；
- 子网掩码/CIDR；
- 私网地址与公网地址；
- 默认网关；
- 路由表、最长前缀匹配；
- ARP 与 ARP cache；
- IPv6 下的 NDP；
- MAC 为什么只负责一跳；
- NAT、SNAT、DNAT、PAT/NAPT；
- 为什么 PAT 能让大量内网连接共享一个公网 IPv4；
- ICMP、ping、traceroute；
- DHCP 如何拿到 IP / 网关 / DNS。

参考：
- `network/4_ip/ip_base.md`
- `network/4_ip/ping.md`
- `network/1_base/what_happen_url.md`

### Phase 4：TCP / UDP：从“能发包”到“可靠传输”

文件：`04-tcp-udp.md`

内容：
- socket 与 TCP 连接的关系；
- 四元组；
- SYN / ACK / FIN / RST；
- 三次握手为什么是三次；
- 四次挥手与 TIME_WAIT；
- 序列号与 ACK；
- 超时重传、快速重传；
- 滑动窗口、流量控制；
- 拥塞控制；
- Keepalive；
- 半连接队列 / accept 队列；
- 客户端临时端口；
- TCP 字节流 vs UDP 报文；
- 什么情况下选 UDP。

参考：
- `network/3_tcp/tcp_interview.md`
- `network/3_tcp/tcp_feature.md`
- `network/3_tcp/tcp_queue.md`
- `network/3_tcp/port.md`

### Phase 5：HTTP / HTTPS / TLS

文件：`05-http-https-tls.md`

内容：
- HTTP request / response；
- method、status code、header、body；
- Host / :authority；
- Cookie / Session；
- Keep-Alive；
- HTTP/1.1、HTTP/2、HTTP/3 的主要差异；
- HTTPS 为什么不是“HTTP 加一个证书”；
- TLS 1.2 与 TLS 1.3 的核心差异；
- 对称加密、非对称加密、哈希、数字签名分别解决什么；
- ECDHE 与前向保密；
- SNI 与 ALPN；
- Server Certificate / Intermediate CA / Root CA；
- Trust Store；
- CertificateVerify；
- 证书吊销（CRL/OCSP）作为进阶内容。

参考：
- `network/2_http/http_interview.md`
- `network/2_http/https_rsa.md`
- `network/2_http/https_ecdhe.md`
- `network/2_http/https_optimize.md`

### Phase 6：现代网络：HTTP/2、HTTP/3、QUIC、WebSocket、RPC

文件：`06-modern-protocols.md`

内容：
- HTTP/1.1 队头阻塞；
- HTTP/2 多路复用；
- TCP 层队头阻塞；
- QUIC 为什么建立在 UDP 上；
- HTTP/3；
- WebSocket 为什么不是“更快的 HTTP”；
- RPC 与 HTTP 的关系；
- 服务发现与 DNS/CoreDNS 的联系。

参考：
- `network/2_http/http2.md`
- `network/2_http/http3.md`
- `network/2_http/http_websocket.md`
- `network/2_http/http_rpc.md`
- `network/3_tcp/quic.md`

### Phase 7：真实后端网络拓扑

文件：`07-backend-network-topology.md`

用一条真实后端链路解释：

```text
Browser
 → Home Router
 → Internet
 → CDN / WAF
 → L4/L7 Load Balancer
 → Nginx / Gateway
 → Backend Service
 → RPC
 → Redis / MySQL
```

重点：
- 域名到底指向谁；
- CDN、反向代理、网关、负载均衡器区别；
- L4 与 L7；
- TLS termination；
- X-Forwarded-For；
- 内网 DNS / 服务发现；
- 长连接与连接池。

### Phase 8：动手验证，不只背概念

文件：`08-labs.md`

Windows + Linux 双路线：
- `nslookup` / `dig`
- `ipconfig /displaydns`
- hosts 实验
- `route print` / `ip route`
- `arp -a` / `ip neigh`
- `netstat` / `ss`
- `curl -v`
- `openssl s_client`
- `ping`
- `tracert` / `traceroute`
- Wireshark 抓 DNS、TCP、TLS
- 浏览器 DevTools Network

每个实验都写：
“执行什么 → 应该看到什么 → 它证明了主链中的哪一步”。

### Phase 9：面试与复盘

文件：`09-review-and-interview.md`

不是纯八股题库，而是按“因果链”复盘：
- 为什么 DNS 不能直接给端口；
- 为什么先 Route 后 ARP；
- 为什么目标服务器在公网，ARP 却问的是默认网关；
- 为什么端口不是“一个进程只能有一个”；
- 为什么 PAT 不是 TCP 冲突的补丁；
- 为什么 NAT 后服务器还能把包回给正确电脑；
- 为什么 TLS 证书不用于加密整个业务流；
- 为什么 CA 不需要每次在线审批；
- TCP Keepalive 与 HTTP Keep-Alive；
- HTTPS 中 TCP/TLS 的真实时序。

## 3. 章节统一模板

每个章节统一采用：

```text
# 章节标题

## 0. 这一章只解决一个问题
## 1. 先看全局位置
## 2. 为什么需要它
## 3. 最小模型
## 4. 真实执行流程
## 5. 放回“输入 URL”主线
## 6. 容易混淆的概念
## 7. 本机实验
## 8. 一句话记忆
## 9. 自测题
## 10. 延伸阅读
```

## 4. 准确性约束

后续内容必须遵守：

- DNS 返回地址记录，端口通常来自 URL scheme 或显式端口，不写成“DNS 返回 IP:443”。
- Stub Resolver 是角色/本机解析接口，不强行等价为一个独立进程。
- Happy Eyeballs 是错峰竞争，不写成“把所有 IP 无限制同时连接”。
- 客户端临时端口由 OS 管理并关联内核 socket；进程通过 fd/socket handle 使用连接。
- TCP 四元组用于标识连接；端口本身不等于进程。
- Route 决定下一跳；ARP 在 IPv4 以太网中把下一跳 IPv4 地址解析为 MAC。
- MAC 是逐链路概念；跨路由后 L2 头会变化。
- NAT/PAT 在常见 NAPT 中作为一次状态化映射描述。
- TCP SYN 从客户端发出后才经过路由、ARP、NAT、互联网转发；不能把这些画成“TCP 建立之前的独立串行协议”。
- TLS 1.3 与旧版 TLS 不混画；需要指出会话恢复、0-RTT 属于进阶分支。
- CA 的证书签发与浏览器连接时的证书验证分成两个时间轴。
- 数字签名是“私钥签名、公钥验证”，不写成“私钥加密、公钥解密”。
- HTTPS 业务流量主要使用协商出的对称密钥，而不是证书公钥逐包加密。

## 5. 参考来源

主要结构参考：

- https://github.com/xiaolincoder/CS-Base/tree/main/network
- https://github.com/xiaolincoder/CS-Base/blob/main/network/1_base/what_happen_url.md
- https://github.com/xiaolincoder/CS-Base/blob/main/network/1_base/tcp_ip_model.md
- https://github.com/xiaolincoder/CS-Base/blob/main/network/1_base/how_os_deal_network_package.md
- https://github.com/xiaolincoder/CS-Base/blob/main/network/2_http/http_interview.md
- https://github.com/xiaolincoder/CS-Base/blob/main/network/2_http/https_ecdhe.md
- https://github.com/xiaolincoder/CS-Base/blob/main/network/3_tcp/tcp_interview.md
- https://github.com/xiaolincoder/CS-Base/blob/main/network/4_ip/ip_base.md

本仓库将重新组织知识顺序、重新举例和重新作图，不直接复制参考仓库正文。
