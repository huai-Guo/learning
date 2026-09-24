# 计算机网络扫盲

> 面向第一次系统学习网络的人，但目标不是只会背名词，而是最后能看懂后端网络、抓包和常见面试题。

本目录只维护一条母线：

> **从“电脑刚连上网络”开始，一直追踪到浏览器拿到 HTTPS 响应。**

详细知识都只是把这条母线中的一个框放大。

---

## 先看阅读版

- **GitHub 直接阅读：** 优先看 Markdown，本仓库的 Mermaid 图会直接渲染。
- **视觉总览：** [index.html](./index.html) 是自包含 HTML 阅读版，clone/downloading 后可以直接用浏览器打开。
- **完整计划：** [PLAN.md](./PLAN.md)

> GitHub 文件页不会像 GitHub Pages 那样直接运行 HTML，所以仓库内以 Markdown 为“正文真源”，HTML 用作视觉总览。后续如果启用 GitHub Pages，可以直接把 HTML 作为在线阅读入口。

---

# 0. 母图：先区分“参与者”，再看协议

下面这张图故意不把所有协议塞进一根箭头。  
因为 **Browser、OS Kernel、家庭路由器、Internet、Server 是不同参与者**。

~~~mermaid
flowchart LR
    subgraph B["Browser / App"]
      B1["URL 解析"]
      B2["DNS / 地址候选"]
      B3["地址排序 + Happy Eyeballs"]
      B4["TLS"]
      B5["HTTP"]
    end

    subgraph K["本机 OS Kernel"]
      K1["Socket / 临时端口"]
      K2["TCP"]
      K3["IP + Route"]
      K4["ARP (IPv4) / NDP (IPv6)"]
      K5["Driver / NIC"]
    end

    subgraph R["家庭路由器"]
      R1["L2 接收"]
      R2["Routing / Conntrack"]
      R3["NAT/PAT<br/>(典型 IPv4 家庭网)"]
      R4["WAN 转发"]
    end

    subgraph I["Internet"]
      I1["ISP"]
      I2["AS / BGP 控制面"]
      I3["逐跳转发"]
    end

    subgraph S["Server / Edge"]
      S1["NIC / Kernel"]
      S2["TCP 443 LISTEN"]
      S3["Connected Socket"]
      S4["TLS 证书 + 私钥"]
      S5["HTTP Handler"]
    end

    B1 --> B2 --> B3
    B3 --> K1 --> K2 --> K3 --> K4 --> K5
    K5 --> R1 --> R2 --> R3 --> R4
    R4 --> I1 --> I2 --> I3 --> S1 --> S2 --> S3
    S3 --> B4 --> S4
    B4 --> B5 --> S5
~~~

这张图是“角色地图”，不是逐报文时序图。  
真正 TCP/TLS 的双向交互，会在章节里用 sequence diagram 画。

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

0. [电脑刚连上网络时，先拿到了什么？](./00-network-bootstrap.md)  
   DHCP、本机 IP、子网、默认网关、DNS Server。

1. [从输入 URL 到网页返回](./01-url-to-webpage.md)  
   把 DNS、Socket、TCP、Route、ARP/NDP、NAT/PAT、TLS、HTTP 串成一条真实请求。

2. [网络分层、封装与 OS 收发包](./02-network-model-and-packets.md) · [HTML 视觉版](./02-network-model-and-packets.html)  
   网络分层、封装/解封装、用户态 → 内核 → 驱动 → 网卡、MTU/MSS。

3. 03-ip-routing-arp-nat.md  
   IPv4/IPv6、CIDR、路由、ARP/NDP、DHCP、ICMP、NAT。

4. 04-tcp-udp.md  
   四元组、三次握手、四次挥手、重传、窗口、拥塞、队列、故障场景。

5. 05-http-https-tls.md  
   HTTP、TLS 1.2/1.3、ECDHE、数字签名、证书链、SNI、ALPN。

6. 06-modern-protocols.md  
   HTTP/2、HTTP/3、QUIC、WebSocket、RPC。

7. 07-backend-network-topology.md  
   CDN / WAF / L4-L7 LB / Nginx / Gateway / RPC / Redis / MySQL。

8. 08-labs.md  
   Windows/Linux 命令、curl、OpenSSL、Wireshark、浏览器 DevTools。

9. 09-review-and-interview.md  
   用因果链复盘高频面试问题和排障问题。

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
