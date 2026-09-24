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
- https://github.com/xiaolincoder/CS-Base/blob/main/network/3_tcp/tcp_no_accpet.md
- https://github.com/xiaolincoder/CS-Base/blob/main/network/3_tcp/tcp_no_listen.md
- https://github.com/xiaolincoder/CS-Base/blob/main/network/3_tcp/tcp_three_fin.md
- https://github.com/xiaolincoder/CS-Base/blob/main/network/3_tcp/time_wait_recv_syn.md
- https://github.com/xiaolincoder/CS-Base/blob/main/network/3_tcp/tcp_tw_reuse_close.md
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

HTTP Caching：

- RFC 9111: https://www.rfc-editor.org/rfc/rfc9111

HTTP/1.1：

- RFC 9112: https://www.rfc-editor.org/rfc/rfc9112

Cookies：

- RFC 6265: https://www.rfc-editor.org/rfc/rfc6265

HTTP/2：

- RFC 9113: https://www.rfc-editor.org/rfc/rfc9113

HTTP/3：

- RFC 9114: https://www.rfc-editor.org/rfc/rfc9114

QUIC Transport：

- RFC 9000: https://www.rfc-editor.org/rfc/rfc9000

QPACK：

- RFC 9204: https://www.rfc-editor.org/rfc/rfc9204

WebSocket：

- RFC 6455: https://www.rfc-editor.org/rfc/rfc6455

WebSocket over HTTP/2：

- RFC 8441: https://www.rfc-editor.org/rfc/rfc8441

WebSocket over HTTP/3：

- RFC 9220: https://www.rfc-editor.org/rfc/rfc9220

Forwarded HTTP Extension：

- RFC 7239: https://www.rfc-editor.org/rfc/rfc7239

Nginx Reverse Proxy / Load Balancing：

- https://docs.nginx.com/nginx/admin-guide/web-server/reverse-proxy/
- https://docs.nginx.com/nginx/admin-guide/load-balancer/http-load-balancer/

Envoy：

- https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/arch_overview
- https://www.envoyproxy.io/docs/envoy/latest/api-docs/xds_protocol

Kubernetes Service / Probes：

- https://kubernetes.io/docs/concepts/services-networking/service/
- https://kubernetes.io/docs/concepts/configuration/liveness-readiness-startup-probes/

gRPC reliability / connection behavior：

- https://grpc.io/docs/guides/deadlines/
- https://grpc.io/docs/guides/keepalive/
- https://grpc.io/docs/guides/retry/

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
13. HTTP Method 优先按协议语义解释，不把 GET/POST 简化成 URL 参数 vs Body。
14. Host、SNI、:authority 分协议阶段解释，不因为值相同就当成同一个字段。
15. TLS 1.3 cipher suite 主要表达 AEAD + Hash；Key Exchange 与 Signature Algorithm 分开协商。
16. Certificate 上的 CA Signature 与 TLS CertificateVerify 分开解释。
17. Root CA 通常来自本地 Trust Store；Server 通常发送 Leaf + Intermediate，而不是把 Root 当作每次握手必发证书。
18. TLS 1.3 不写成“永远只有 ECDHE”；恢复场景允许 PSK / PSK+(EC)DHE，0-RTT 必须提示 Replay 风险。
19. HTTPS 明确区分“保护 HTTP 内容”与“仍可暴露 IP、大小、时序等 metadata”，经典 SNI 与传统 DNS 也可能泄露 hostname。
20. HTTP/2 的 Multiplexing 解决 HTTP 层并发限制，但 TCP 仍是一条全局有序 Byte Stream，会产生 TCP-level HOL。
21. QUIC 不写成“UDP 自动可靠”；ACK、Loss Recovery、Flow/Congestion Control 与 Stream Reliability 都由 QUIC 实现。
22. QUIC Packet Number 与 Stream Offset 分开解释；重传可靠信息时不复用原 Packet Number。
23. Connection ID 不替代 IP/UDP；Connection Migration 还必须考虑 Path Validation 与新的路径状态。
24. HTTP/2 Server Push 区分“标准曾支持”与“现代浏览器实际采用情况”，不再作为今天的核心卖点。
25. WebSocket 是应用层双向消息协议，不写成 Socket API，也不写成 HTTP/2/3 的替代品。
26. RPC 定义为调用模型/框架集合，不写成固定网络协议；gRPC、Thrift、HTTP、TCP/QUIC 必须按层比较。
27. Retry 必须和 Deadline、Idempotency / Deduplication 一起讨论，不能把网络超时等同于远端业务未执行。
28. DNS 返回的公网 IP 不默认解释成业务 Server；在真实系统中它可能是 CDN、Anycast Edge、WAF、LB 或 Reverse Proxy。
29. L4 与 L7 LB 按观察层次和路由粒度区分，不把产品名称直接等同于某一层。
30. TLS Termination、Re-encrypt、Passthrough 分开；使用 LB 不代表一定在 LB 解 TLS。
31. Backend 的 TCP peer 与 Original Client IP 分开；Forwarded / X-Forwarded-* 必须建立 Trusted Proxy Boundary。
32. X-Forwarded-For 与 PROXY Protocol 分层解释：前者是 HTTP metadata，后者可用于更通用的连接级代理场景。
33. Service Discovery 解决 Name → Endpoint Set；Load Balancing 解决本次选哪个 Endpoint。
34. 一次业务 Request 不画成一条端到端 TCP Connection；Proxy 和 Service 边界可能形成多条独立连接。
35. API Gateway、Service Mesh、Trace ID、Connection ID 按治理对象与协议层分开解释。
