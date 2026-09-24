# 参考资料与使用方式

本目录以“输入 URL 到网页返回”为教学主线，参考公开资料核对知识覆盖面，但不会直接复制参考文章正文。

## 主要参考：xiaolincoder / CS-Base

- [network 总目录](https://github.com/xiaolincoder/CS-Base/tree/main/network)
- [TCP/IP 网络模型有哪几层？](https://github.com/xiaolincoder/CS-Base/blob/main/network/1_base/tcp_ip_model.md)
- [键入网址到网页显示，期间发生了什么？](https://github.com/xiaolincoder/CS-Base/blob/main/network/1_base/what_happen_url.md)
- [Linux 系统是如何收发网络包的？](https://github.com/xiaolincoder/CS-Base/blob/main/network/1_base/how_os_deal_network_package.md)
- [HTTP 常见面试题](https://github.com/xiaolincoder/CS-Base/blob/main/network/2_http/http_interview.md)
- [HTTPS ECDHE 握手解析](https://github.com/xiaolincoder/CS-Base/blob/main/network/2_http/https_ecdhe.md)
- [HTTPS 如何优化？](https://github.com/xiaolincoder/CS-Base/blob/main/network/2_http/https_optimize.md)
- [TCP 三次握手与四次挥手面试题](https://github.com/xiaolincoder/CS-Base/blob/main/network/3_tcp/tcp_interview.md)
- [TCP 重传、滑动窗口、流量控制、拥塞控制](https://github.com/xiaolincoder/CS-Base/blob/main/network/3_tcp/tcp_feature.md)
- [IP 基础知识全家桶](https://github.com/xiaolincoder/CS-Base/blob/main/network/4_ip/ip_base.md)
- [ping 的工作原理](https://github.com/xiaolincoder/CS-Base/blob/main/network/4_ip/ping.md)

## 本项目会主动修正/强调的教学点

参考资料用于覆盖知识面；本项目在讲解顺序上额外强调：

1. `connect()` 后 TCP SYN 已经开始产生，Route / ARP / NAT / Internet Routing 是运输 TCP 报文的网络机制。
2. Route 决定下一跳，ARP 在 IPv4 Ethernet 局域网中解析下一跳 MAC；不把远端服务器 MAC 当成跨互联网可见地址。
3. NAT/PAT 在典型家用 NAPT 中按一次状态化连接映射讲解，而不是两个固定串行设备。
4. DNS 的 Stub Resolver / Recursive Resolver 按“角色”解释，不强行等价为固定进程。
5. Happy Eyeballs 按地址排序后的错峰竞争解释，不描述为无限制全并发。
6. TLS 1.3 与旧 TLS 分开；CA 的“事前签发”与“连接时浏览器验链”分成两个时间轴。
7. 数字签名使用“私钥签名、公钥验证”的表述，不使用容易误导的“私钥加密、公钥解密”。
