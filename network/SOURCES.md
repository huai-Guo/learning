# 参考资料与使用方式

本目录以“输入 URL 到网页返回”为主线，参考公开资料核对知识覆盖面；正文会重新组织、重新举例、重新作图，不直接复制参考文章。

---

# 1. 主要知识覆盖参考：xiaolincoder / CS-Base

总目录：

- https://github.com/xiaolincoder/CS-Base/tree/main/network

基础：

- https://github.com/xiaolincoder/CS-Base/blob/main/network/1_base/tcp_ip_model.md
- https://github.com/xiaolincoder/CS-Base/blob/main/network/1_base/what_happen_url.md
- https://github.com/xiaolincoder/CS-Base/blob/main/network/1_base/how_os_deal_network_package.md

HTTP / HTTPS：

- https://github.com/xiaolincoder/CS-Base/blob/main/network/2_http/http_interview.md
- https://github.com/xiaolincoder/CS-Base/blob/main/network/2_http/https_rsa.md
- https://github.com/xiaolincoder/CS-Base/blob/main/network/2_http/https_ecdhe.md
- https://github.com/xiaolincoder/CS-Base/blob/main/network/2_http/https_optimize.md
- https://github.com/xiaolincoder/CS-Base/blob/main/network/2_http/http2.md
- https://github.com/xiaolincoder/CS-Base/blob/main/network/2_http/http3.md
- https://github.com/xiaolincoder/CS-Base/blob/main/network/2_http/http_websocket.md
- https://github.com/xiaolincoder/CS-Base/blob/main/network/2_http/http_rpc.md

TCP：

- https://github.com/xiaolincoder/CS-Base/blob/main/network/3_tcp/tcp_interview.md
- https://github.com/xiaolincoder/CS-Base/blob/main/network/3_tcp/tcp_feature.md
- https://github.com/xiaolincoder/CS-Base/blob/main/network/3_tcp/tcp_queue.md
- https://github.com/xiaolincoder/CS-Base/blob/main/network/3_tcp/tcp_tcpdump.md
- https://github.com/xiaolincoder/CS-Base/blob/main/network/3_tcp/port.md
- https://github.com/xiaolincoder/CS-Base/blob/main/network/3_tcp/quic.md

IP：

- https://github.com/xiaolincoder/CS-Base/blob/main/network/4_ip/ip_base.md
- https://github.com/xiaolincoder/CS-Base/blob/main/network/4_ip/ping.md

---

# 2. 易出错部分优先对 RFC / 标准核对

Happy Eyeballs v2：

- RFC 8305: https://www.rfc-editor.org/rfc/rfc8305

TLS 1.3：

- RFC 8446: https://www.rfc-editor.org/rfc/rfc8446

DHCP：

- RFC 2131: https://www.rfc-editor.org/rfc/rfc2131

IPv6 Neighbor Discovery：

- RFC 4861: https://www.rfc-editor.org/rfc/rfc4861

HTTP Semantics：

- RFC 9110: https://www.rfc-editor.org/rfc/rfc9110

HTTP/2：

- RFC 9113: https://www.rfc-editor.org/rfc/rfc9113

HTTP/3：

- RFC 9114: https://www.rfc-editor.org/rfc/rfc9114

QUIC Transport：

- RFC 9000: https://www.rfc-editor.org/rfc/rfc9000

---

# 3. 本项目会主动强调的准确性问题

1. connect() 后 TCP SYN 已经开始产生；Route / ARP / NAT / Internet Routing 是在运输 TCP 报文。
2. Route 决定下一跳；ARP 在 IPv4 Ethernet 场景解析下一跳 MAC。
3. IPv6 不使用 ARP，使用 NDP 等机制。
4. NAT/PAT 在典型家庭 NAPT 中按一次状态化连接映射解释。
5. DNS 的 Stub Resolver / Recursive Resolver 按角色解释，不强行等价成固定进程。
6. Happy Eyeballs 是地址排序后的错峰连接竞争，不写成无限制全并发。
7. TLS 1.3 与旧版 TLS 分开，不用“TLS 四次握手”概括所有版本。
8. CA 的证书签发与浏览器连接时验链分成两个时间轴。
9. ECDHE 临时 key share 与证书身份公钥分开。
10. 数字签名写成“私钥签名、公钥验证”，避免“私钥加密、公钥解密”的误导说法。
11. HTTP/3 使用 QUIC/UDP，不把 HTTPS 永远绑定 TCP。
12. Linux 内核实现细节与协议抽象分层讲，不拿某个 Linux 版本实现冒充协议规范。
