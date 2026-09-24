# 计算机网络扫盲

这不是一份从“OSI 七层定义”开始背的网络笔记。

整个目录只用一条主线：

> **在浏览器输入一个 HTTPS URL，页面为什么真的能从另一台机器回来？**

## 总地图

```text
https://shop.example.com/products
        │
        ▼
URL 解析
        │
        ▼
DNS：域名 → A / AAAA
        │
        ▼
地址排序 + Happy Eyeballs
        │
        ▼
socket() / connect()
        │
        ▼
TCP SYN
        │
        ▼
IP：最终目标是谁
        │
        ▼
Route：下一跳是谁
        │
        ▼
ARP：下一跳 MAC 是谁
        │
        ▼
Ethernet：把这一跳真正发出去
        │
        ▼
家庭路由器 NAT/PAT
        │
        ▼
Internet 多跳路由
        │
        ▼
目标服务器
        │
        ├─ SYN-ACK
        └─ ACK
        │
        ▼
TCP ESTABLISHED
        │
        ▼
TLS 1.3
        │
        ├─ SNI / ALPN
        ├─ ECDHE
        ├─ Certificate
        ├─ CertificateVerify
        └─ CA Chain 验证
        │
        ▼
HTTP Request
        │
        ▼
HTTP Response
        │
        ▼
浏览器解析并渲染页面
```

## 学习顺序

1. [从输入 URL 到页面返回](./01-url-to-webpage.md)
2. 网络分层与数据包封装（计划中）
3. IP / Route / ARP / NAT（计划中）
4. TCP / UDP（计划中）
5. HTTP / HTTPS / TLS（计划中）
6. HTTP/2 / HTTP/3 / QUIC / WebSocket / RPC（计划中）
7. 真实后端网络拓扑（计划中）
8. 抓包与本机实验（计划中）
9. 面试与复盘（计划中）

完整建设计划见 [PLAN.md](./PLAN.md)。

## 学习方法

遇到一个名词时始终问四件事：

```text
它为什么存在？
        ↓
它解决谁的问题？
        ↓
它运行在哪个参与者里？
        ↓
在“输入 URL”这条主链上，它前后分别是谁？
```

例如 ARP 不单独背“IP → MAC”，而要放回：

```text
已经知道最终目标 IP
        ↓
查 Route
        ↓
知道下一跳 IP
        ↓
ARP
        ↓
得到下一跳 MAC
        ↓
才能构造当前链路的 Ethernet Frame
```

这也是本目录所有章节的组织方式。
