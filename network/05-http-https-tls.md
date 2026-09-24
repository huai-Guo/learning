# 05｜HTTP / HTTPS / TLS：浏览器到底发了什么，TLS 又如何保证“别人看不懂、改不了、冒充不了”？

> 这一章只解决两个问题：
>
> 1. **HTTP 到底怎样表达一次业务请求？**
> 2. **HTTPS 为什么能让 HTTP 在不可信网络上安全传输？**

前四章已经把链路打通：

~~~text
URL
 ↓
DNS
 ↓
Socket / TCP
 ↓
IP / Route / ARP / NAT
 ↓
Server
~~~

现在 TCP 已经提供一条可靠字节流。接下来需要回答：浏览器和服务器在这条字节流里到底说什么？

如果使用 HTTP：

~~~text
HTTP bytes
 ↓
TCP
~~~

如果使用 HTTPS：

~~~text
HTTP
 ↓
TLS
 ↓
TCP
~~~

> 本章主线使用 HTTP/1.1 + TLS 1.3 建立最清晰的模型。HTTP/2、HTTP/3 下一章单独展开。

---

# 0. 先看三层职责

~~~text
HTTP
负责：
“业务消息是什么意思？”

TLS
负责：
“这批业务字节如何保密、验真、防篡改？”

TCP
负责：
“这些字节如何可靠、有序地到达？”
~~~

所以：

> **HTTP、TLS、TCP 不是互相替代，而是不同职责的协议层。**

---

# 1. HTTP 本质是什么？

HTTP 是应用层请求-响应协议。

最小模型：

~~~text
Client
  │
  │ Request
  ▼
Server
  │
  │ Response
  ▼
Client
~~~

它规定请求方法、目标资源、Header、Body、Status、缓存、内容协商、认证相关字段，以及代理如何参与。

HTTP 不只属于浏览器，也可以发生在：

~~~text
Backend Service
     ↓ HTTP
Backend Service
~~~

---

# 2. 一个 HTTP/1.1 Request 长什么样？

~~~http
GET /products?lang=zh-CN HTTP/1.1
Host: shop.example.com
User-Agent: ExampleBrowser/1.0
Accept: text/html
Accept-Encoding: gzip
Cookie: session_id=abc123

~~~

如果带 Body：

~~~http
POST /orders HTTP/1.1
Host: shop.example.com
Content-Type: application/json
Content-Length: 42

{"product_id":42,"count":1}
~~~

结构：

~~~text
Request Line
     ↓
Headers
     ↓
空行
     ↓
Optional Body
~~~

---

# 3. Request Line 的三部分

~~~text
GET /products HTTP/1.1
│       │          │
Method  Target     Version
~~~

Method 表达：

> 我想对这个资源做什么？

常见：

- GET：获取资源；
- HEAD：类似 GET，但不需要响应 Body；
- POST：提交数据，由资源定义如何处理；
- PUT：通常表达创建或整体替换指定资源；
- PATCH：部分修改；
- DELETE：删除；
- OPTIONS：查询通信选项；
- CONNECT：建立隧道。

方法语义比“参数放 URL 还是 Body”更重要。

---

# 4. Safe 和 Idempotent 是什么？

## Safe

表示方法语义上：

> 客户端不是为了修改服务器状态。

典型：

~~~text
GET
HEAD
OPTIONS
~~~

## Idempotent

表示：

> 同一个请求执行一次或多次，目标效果应与执行一次一致。

典型：

~~~text
GET
PUT
DELETE
~~~

POST 通常不被定义为幂等。

但注意：

> 这是协议语义，不代表开发者代码一定遵守。

如果有人写：

~~~text
GET /deleteUser?id=42
~~~

虽然 Method 是 GET，业务实现仍可能真的删除数据。

---

# 5. GET 和 POST 不要背成“URL vs Body”

常见错误口诀：

~~~text
GET 参数一定放 URL
POST 参数一定放 Body
~~~

并不严谨。

更重要的是：

~~~text
GET
→ 语义是获取目标资源

POST
→ 让目标资源根据 request content 执行处理
~~~

URL query 不属于 GET 独占；POST URL 也可以有 query。

HTTP 规范也不是靠“GET 绝不能出现 Body”定义 GET。现实系统、代理、框架对 GET Body 兼容性并不理想，因此通常不要依赖它。

---

# 6. Response 长什么样？

~~~http
HTTP/1.1 200 OK
Content-Type: text/html; charset=utf-8
Content-Length: 12580
Cache-Control: max-age=60
Set-Cookie: session_id=abc123; Secure; HttpOnly; SameSite=Lax

<html>...</html>
~~~

结构：

~~~text
Status Line
     ↓
Headers
     ↓
空行
     ↓
Optional Body
~~~

---

# 7. Status Code 不只是“成功 / 失败”

~~~text
1xx → 信息性响应
2xx → 成功处理
3xx → 重定向 / 缓存相关
4xx → Client 请求、权限、资源等问题
5xx → Server / Gateway 处理失败
~~~

常见：

| Code | 常见含义 |
|---|---|
| 200 | OK |
| 201 | Created |
| 204 | No Content |
| 206 | Partial Content |
| 301 | Permanent Redirect |
| 302 | Temporary Redirect |
| 304 | Not Modified |
| 400 | Bad Request |
| 401 | Authentication required / invalid credentials context |
| 403 | Forbidden |
| 404 | Not Found |
| 409 | Conflict |
| 429 | Too Many Requests |
| 500 | Internal Server Error |
| 502 | Bad Gateway |
| 503 | Service Unavailable |
| 504 | Gateway Timeout |

502 常见于 Gateway / reverse proxy 无法正常从 upstream 获得有效响应；504 更偏向等待 upstream 超时。

---

# 8. Header 本质是“元数据”

例如：

~~~text
Host
Content-Type
Content-Length
Accept
Accept-Encoding
Authorization
Cookie
Cache-Control
ETag
If-None-Match
Location
User-Agent
~~~

HTTP 很多关键语义都在 Header 中表达。

---

# 9. Host、SNI、:authority 为什么都像“域名”？

假设访问：

~~~text
https://shop.example.com/products
~~~

## DNS 阶段

~~~text
shop.example.com
→ 地址候选
~~~

## TLS 阶段

ClientHello 经典情况下带：

~~~text
SNI = shop.example.com
~~~

让共享同一 IP:443 的 TLS Server 知道你想访问哪个 hostname。

## HTTP/1.1

~~~http
Host: shop.example.com
~~~

让 HTTP Server / reverse proxy 知道请求属于哪个虚拟站点。

## HTTP/2 / HTTP/3

~~~text
:authority = shop.example.com
~~~

承担 authority / host 角色。

所以：

> **DNS hostname、TLS SNI、HTTP Host / :authority 经常内容相同，但阶段和协议层完全不同。**

---

# 10. 一个 IP:443 为什么能托管很多 HTTPS 网站？

~~~text
203.0.113.20:443
~~~

同时可以服务：

~~~text
shop.example.com
api.example.com
blog.example.net
~~~

TLS 阶段：

~~~text
ClientHello
SNI = shop.example.com
        ↓
TLS terminator
        ↓
选择 shop.example.com 对应证书和配置
~~~

HTTP 阶段：

~~~text
Host / :authority
        ↓
选择 HTTP virtual host / route
~~~

---

# 11. HTTP/1.1 如何知道 Body 到哪里结束？

TCP 是字节流，不会告诉 HTTP：

~~~text
“这次 recv 就是一整个 Response”
~~~

HTTP/1.1 必须自己定义 Message Framing。

## Content-Length

~~~http
Content-Length: 12580
~~~

## Transfer-Encoding: chunked

HTTP/1.1 可以使用 Chunked Transfer Coding：

~~~text
size
chunk data
size
chunk data
...
0
~~~

## 某些 Response 没有 Body

例如 HEAD response、204、304，以及某些 CONNECT 语义。

所以：

> **HTTP/1.1 framing 是在 TCP 字节流上重新建立 HTTP message boundary。**

HTTP/2 以后使用 binary frame，不再依赖 HTTP/1.1 这套文本 framing。

---

# 12. HTTP persistent connection 到底是什么？

HTTP/1.0 早期常见：

~~~text
一个 Request
 ↓
一个 TCP connection
 ↓
Response
 ↓
close
~~~

代价是不断重复 TCP/TLS 建连。

HTTP/1.1 默认支持持久连接语义：

~~~text
TCP/TLS connection
   │
   ├─ Request 1 / Response 1
   ├─ Request 2 / Response 2
   └─ Request 3 / Response 3
~~~

所以：

> **HTTP persistent connection 是复用底层连接，不是 TCP Keepalive。**

---

# 13. Cookie 是什么？

网站往往需要记住：

~~~text
你是谁
购物车
登录状态
偏好
~~~

Server 可以返回：

~~~http
Set-Cookie: session_id=abc123; Secure; HttpOnly; SameSite=Lax
~~~

浏览器后续自动带：

~~~http
Cookie: session_id=abc123
~~~

Cookie 本质是：

> 浏览器按规则保存，并在匹配请求中自动附带的一小段状态。

---

# 14. Cookie 与 Session 不是一个东西

经典 Server-side Session：

~~~text
Browser Cookie
session_id=abc123
       ↓
Server

abc123
  ↓
Session Store
  ↓
user_id = 42
cart = ...
roles = ...
~~~

所以：

~~~text
Cookie
=
客户端携带的状态 / 标识载体

Session
=
服务端维护的会话状态模型
~~~

也可以使用 JWT、opaque token、Authorization Bearer、mTLS identity 等其他方案。

---

# 15. Secure、HttpOnly、SameSite 分别保护什么？

## Secure

Cookie 只应通过安全传输发送。

## HttpOnly

阻止普通前端 JavaScript 直接通过 document.cookie 读取该 Cookie。它可以降低某些 XSS 场景下 Cookie 被直接窃取的风险，但不能消灭 XSS。

## SameSite

控制跨站请求时 Cookie 的发送策略，有助于降低部分 CSRF 风险。

所以：

> 三个属性解决的是不同攻击面。

---

# 16. Cache-Control：为什么浏览器有时根本不访问 Server？

~~~http
Cache-Control: max-age=60
~~~

在 freshness period 内，浏览器可以直接使用缓存。

~~~text
Browser Cache
  │
  ├─ fresh
  │    ↓
  │  直接使用
  │
  └─ stale
       ↓
      重新验证 / 请求
~~~

---

# 17. ETag / If-None-Match 为什么会返回 304？

第一次：

~~~http
ETag: "v42"
~~~

下次：

~~~http
If-None-Match: "v42"
~~~

如果资源没变化：

~~~http
HTTP/1.1 304 Not Modified
~~~

意思是：

> 继续使用本地缓存，不必重新传完整 Body。

Last-Modified / If-Modified-Since 也可以做条件请求。

---

# 18. HTTP 为什么不安全？

裸 HTTP 在不可信网络上面临三类核心问题：

~~~text
Confidentiality
→ 别人可能直接看到内容

Integrity
→ 中间人可能修改内容

Authentication
→ Browser 无法仅凭裸 HTTP 确认 Server 身份
~~~

HTTPS 的核心不是“URL 多了一个 s”，而是：

~~~text
HTTP
 ↓
TLS
 ↓
TCP
~~~

---

# 19. TLS 要同时解决三件事

~~~text
Confidentiality
机密性
→ 别人看不懂

Integrity
完整性
→ 被改能发现

Authentication
身份认证
→ Browser 能验证 Server 身份
~~~

TLS 还包括密钥协商、algorithm negotiation、transcript binding、session resumption 和 downgrade protection 等。

---

# 20. 为什么不直接全程使用公钥密码？

非对称密码很重要，但通常：

- 运算更昂贵；
- 适合数字签名、身份认证和密钥建立；
- 不适合高效保护大量业务流量。

因此 TLS 的组合是：

~~~text
Public-key / (EC)DHE / Signature
       ↓
身份认证 + Shared Secret
       ↓
派生 symmetric traffic keys
       ↓
大量 Application Data
使用对称 AEAD
~~~

所以：

> **HTTPS 的大量业务数据不是拿证书公钥逐包加密。**

---

# 21. 四种密码学概念必须分开

## Symmetric Encryption

同一类 secret key 用于高效保护大量数据。

TLS 1.3 常见 AEAD：

- AES-GCM；
- ChaCha20-Poly1305。

## Public-key Cryptography

使用 Private Key / Public Key，TLS 中尤其用于数字签名和身份认证等。

## Hash

任意长度输入映射成固定长度摘要。Hash 不是 Encryption，也不存在“把 Hash 解密回来”。

## Digital Signature

~~~text
Private Key
   ↓
sign(message / transcript context)
   ↓
Signature

Public Key
   ↓
verify
~~~

不要用：

> 私钥加密、公钥解密

来解释数字签名。

---

# 22. AEAD 为什么比“只加密”更重要？

TLS 1.3 使用 AEAD 类算法，同时提供：

~~~text
Confidentiality
+
Integrity / Authenticity of protected record
~~~

因此攻击者既看不懂内容，也不能悄悄修改密文而不被发现。

---

# 23. TLS 里有两类最容易混淆的“公钥”

## A. ECDHE 临时 Key Share

用于：

> 建立本次连接 Shared Secret。

~~~text
Client ephemeral key pair
            +
Server ephemeral key pair
            ↓
ECDHE
            ↓
Shared Secret
~~~

## B. Certificate Identity Public Key

用于：

> 验证 Server 身份签名。

~~~text
Server Identity Private Key
        ↓
sign handshake transcript
        ↓
CertificateVerify

Certificate Public Key
        ↓
verify
~~~

所以：

~~~text
ECDHE ephemeral public key
≠
Certificate public key
~~~

---

# 24. ECDHE 为什么公开 Key Share，旁观者仍算不出 Shared Secret？

简化抽象：

~~~text
Client:
private = a
public  = A

Server:
private = b
public  = B
~~~

双方交换 A 和 B，但私钥 a、b 不出本机。

在安全椭圆曲线和算法假设下，旁观者只有公开 key share，无法有效恢复 private key 或 Shared Secret。

真正数学是椭圆曲线群上的标量乘法，这里的图只是建立“私钥不出本机、公钥可以交换”的直觉。

---

# 25. 为什么 ECDHE 有 Forward Secrecy？

每次连接可以使用新的 ephemeral key pair：

~~~text
Connection 1
→ ephemeral secret 1

Connection 2
→ ephemeral secret 2
~~~

未来即使长期证书私钥泄漏，也不应因此直接恢复过去已经完成的 ECDHE 会话秘密。

---

# 26. HKDF 是干什么的？

ECDHE 得到 Shared Secret 后，不能简单把原始值当成所有加密密钥。

TLS 1.3 使用 HKDF-based key schedule：

~~~text
ECDHE Shared Secret
        +
Transcript / Labels
        ↓
HKDF Extract / Expand
        ↓
Handshake Traffic Keys
Application Traffic Keys
Finished Key
...
~~~

不同方向、不同阶段使用不同密钥材料。

---

# 27. CA 到底在什么时候参与？

一定要分两个时间轴。

## 时间轴 A：网站部署前

~~~mermaid
sequenceDiagram
    participant Site as 网站运营方
    participant CA as CA
    participant Server as Server

    Site->>Site: 准备身份密钥材料
    Site->>CA: 申请证书
    CA->>CA: 验证域名控制等信息
    CA-->>Site: 签发 Server Certificate
    Site->>Server: 部署 Certificate + Private Key + Intermediate Chain
~~~

CA 的主要参与发生在：

> **证书签发阶段。**

---

# 28. Root CA 为什么 Browser 本地已经认识？

OS / Browser 维护：

~~~text
Trust Store
~~~

里面有受信任 Root CA。

Browser 可以从：

~~~text
Server Certificate
      ↓
Intermediate CA
      ↓
Trusted Root
~~~

构造可信路径。

Root CA 通常不需要 Server 每次握手都发送，因为 Browser 本地已经把它作为 Trust Anchor。

---

# 29. Server 为什么通常要发送 Intermediate？

典型链：

~~~text
Root CA
   ↓ signs
Intermediate CA
   ↓ signs
Server Certificate
~~~

Browser 已信任 Root，但未必缓存 Intermediate。

所以 Server 通常发送：

~~~text
Server Certificate
+
Intermediate Certificate(s)
~~~

帮助构造：

~~~text
Leaf
 ↓
Intermediate
 ↓
Root Trust Anchor
~~~

如果 Intermediate 配置错误，就可能出现某些客户端能打开、另一些验证失败。

---

# 30. Certificate 里有什么？

常见字段包括：

- Subject / Issuer；
- Public Key；
- Signature Algorithm；
- Validity；
- SAN；
- Key Usage / Extended Key Usage；
- Serial Number；
- Extensions；
- CA Signature。

浏览器关心的不是“证书看起来像真的”，而是：

> 能否建立一条满足策略的可信验证路径，并且 hostname 等约束正确。

---

# 31. Browser 验证证书时检查什么？

简化但更真实：

~~~text
Server Certificate
        ↓
hostname / SAN 匹配？
        ↓
当前时间在有效期？
        ↓
Key Usage / EKU / constraints 合法？
        ↓
Issuer / Signature 能构造可信链？
        ↓
最终链到 Trust Store 中的 Trust Anchor？
        ↓
实现策略下的 revocation / CT / policy 等检查？
~~~

不要简化成：

> 拿 Root CA 公钥解密证书。

更准确是：

> **逐级验证证书签名和约束，最终建立到可信 Trust Anchor 的认证路径。**

---

# 32. Certificate Signature 与 CertificateVerify 是两个不同签名

## Certificate 上的 CA Signature

~~~text
CA Private Key
      ↓
签 Server Certificate
~~~

证明：

> CA 对这张证书中的身份和 Public Key 做了签发背书。

## TLS CertificateVerify

~~~text
Server Certificate 对应 Private Key
        ↓
签当前 TLS handshake transcript
~~~

证明：

> 当前握手方确实持有证书对应 Private Key。

所以：

~~~text
Certificate Signature
≠
CertificateVerify
~~~

---

# 33. TLS 1.3 第一步：ClientHello

ClientHello 经典内容包括：

- supported_versions；
- cipher_suites；
- supported_groups；
- key_share；
- signature_algorithms；
- SNI；
- ALPN；
- PSK / resumption 相关扩展；
- 其他 extensions。

重要：

> TLS 1.3 cipher suite 不再像 TLS 1.2 那样把密钥交换、证书签名、对称加密全部捆进一个名字。

TLS 1.3 cipher suite 主要指定：

> **AEAD + Hash**

例如：

~~~text
TLS_AES_128_GCM_SHA256
~~~

而 ECDHE group、Signature Algorithm 在其他协商中决定。

---

# 34. ClientHello 为什么经典情况下仍可被观察？

在传统 TLS 1.3：

~~~text
TCP established
 ↓
ClientHello
~~~

此时还没有双方共享的 handshake key。

因此很多 ClientHello metadata 传统上可以被中间网络观察，例如 SNI、supported groups、ALPN offer 等。

ECH 试图进一步保护 ClientHello 中的敏感部分。

---

# 35. 第二步：ServerHello

Server 选择 TLS 版本、cipher suite、key share group，并返回 Server key share。

此时：

~~~text
Client
自己的 ephemeral private
+
Server public key share

Server
自己的 ephemeral private
+
Client public key share
~~~

双方得到同一个 ECDHE Shared Secret，然后进入 TLS 1.3 key schedule。

---

# 36. ServerHello 后为什么可以开始加密后续握手？

ServerHello 后，双方已经有足够材料派生：

~~~text
Handshake Traffic Keys
~~~

因此正常 TLS 1.3 中，后续 Server 握手消息：

~~~text
EncryptedExtensions
Certificate
CertificateVerify
Finished
~~~

已经受到握手密钥保护。

这和很多 TLS 1.2 教程里“Certificate 明文出现”的直觉不同。

---

# 37. EncryptedExtensions 与 ALPN

ClientHello：

~~~text
ALPN offers:
h2
http/1.1
~~~

Server 在 EncryptedExtensions 中告诉 Client：

~~~text
ALPN selected:
h2
~~~

也就是说：

> Client 提供候选，Server 选择最终应用协议。

---

# 38. Certificate：把身份链交给 Browser

Server 发送：

~~~text
Server Leaf Certificate
Intermediate Certificate(s)
~~~

Browser 把它和：

~~~text
Target Hostname
Local Trust Store
Current Validation Policy
~~~

结合起来验证。

---

# 39. CertificateVerify：证明“我真的有 Private Key”

攻击者可以复制公开证书，所以只发送 Certificate 不能证明自己是持有者。

Server：

~~~text
Certificate Private Key
        ↓
sign handshake transcript
        ↓
CertificateVerify
~~~

Browser：

~~~text
Certificate Public Key
        ↓
verify
~~~

成功才说明：

> 当前握手方确实掌握证书对应 Private Key。

---

# 40. Finished：不是再签一次证书

Finished 更接近：

> **确认双方对整个 Handshake Transcript 和已经派生的秘密理解一致，而且握手消息没有被悄悄篡改。**

所以：

~~~text
CertificateVerify
→ 身份 Private Key 持有证明

Finished
→ 握手完整性 + Key Schedule 一致性确认
~~~

---

# 41. TLS 1.3 主握手时序

~~~mermaid
sequenceDiagram
    participant B as Browser
    participant S as Server

    B->>S: ClientHello<br/>SNI / ALPN offers / cipher suites / key_share
    S-->>B: ServerHello<br/>selected suite / key_share

    Note over B,S: ECDHE + HKDF → Handshake Traffic Keys

    S-->>B: EncryptedExtensions
    S-->>B: Certificate
    S-->>B: CertificateVerify
    S-->>B: Finished

    Note over B: Verify chain / hostname / CertificateVerify / Server Finished

    B->>S: Finished

    Note over B,S: Application Traffic Keys

    B->>S: Encrypted HTTP Request
    S-->>B: Encrypted HTTP Response
~~~

---

# 42. 为什么 Browser 不能先 Finished，再慢慢验身份？

如果身份没有验证，你并不知道当前共享密钥究竟是和谁建立的。

Browser 必须确认：

- 证书链可信；
- hostname 匹配；
- Server 持有身份 Private Key；
- Server Finished 正确。

通过后才能接受这次握手。

所以：

> **Confidentiality 不能替代 Authentication。**

---

# 43. SNI、Certificate、CertificateVerify 怎么串起来？

~~~text
URL hostname
shop.example.com
        ↓
ClientHello SNI
shop.example.com
        ↓
Server 选择站点配置 / 证书
        ↓
Certificate
SAN includes shop.example.com
        ↓
Browser 验证 hostname
        ↓
CertificateVerify
        ↓
证明 Server 持有对应 Private Key
~~~

这就是：

> Browser 为什么相信对面是 shop.example.com

的最小完整链。

---

# 44. HTTPS 到底加密什么，没加密什么？

TLS 建立后，HTTP 的 Method、Path、Headers、Cookie、Authorization、Body、Response Body 通常都在 TLS 保护内。

但是网络转发仍然需要：

~~~text
src / dst IP
packet sizes
timing
TCP / UDP metadata
~~~

经典 TLS 中 SNI 也可能暴露 hostname；传统明文 DNS 也可能暴露查询 hostname。

所以：

> **HTTPS 不等于隐藏所有网络 metadata。**

---

# 45. TLS 1.2 与 TLS 1.3 的核心差异

TLS 1.2 历史上支持 RSA key exchange、(EC)DHE，以及很多旧 cipher / MAC 组合。

TLS 1.3：

- 移除很多旧算法；
- full handshake 通常 1-RTT；
- 更现代的 key schedule；
- cipher suite 主要描述 AEAD + Hash；
- Key Exchange 与 Signature Algorithm 分开；
- ServerHello 后大部分 handshake 消息加密；
- 支持 PSK resumption；
- 可选 0-RTT Early Data。

所以：

> **TLS 1.3 不是简单删掉 TLS 1.2 的两个包，而是握手和算法协商都重新设计。**

---

# 46. TLS 1.3 是不是“只支持 ECDHE”？

更准确的说法：

> TLS 1.3 移除了传统 RSA key exchange，完整认证握手常见使用 (EC)DHE；恢复场景还可以使用 PSK 或 PSK+(EC)DHE。

因此不能写成：

> TLS 1.3 永远只有 ECDHE 一种密钥建立方式。

---

# 47. Session Resumption 为什么能降低延迟？

完整握手需要：

- Key Exchange；
- Certificate；
- Signature Verify；
- 网络往返。

首次连接结束后，可以建立：

~~~text
resumption state / PSK
~~~

下次：

~~~text
Client 带 resumption 信息
        ↓
Server 接受
        ↓
缩短握手
~~~

减少延迟和计算成本。

---

# 48. TLS 1.3 Resumption 与 PSK

TLS 1.3 恢复围绕 PSK。

这里的 Pre-Shared 不一定是人工预配置，也可能来自上一次安全 Session 派生出的 resumption secret / ticket。

恢复：

~~~text
ClientHello
+ PSK identity / binder
        ↓
Server 验证
        ↓
恢复安全上下文
~~~

如果使用：

~~~text
PSK + (EC)DHE
~~~

还可以加入新的 ephemeral contribution。

---

# 49. 0-RTT 是什么？

满足条件的 TLS 1.3 resumption 可以允许：

~~~text
ClientHello
+
Early Application Data
~~~

优势：

> 减少重连请求延迟。

风险：

> **Replay Attack。**

攻击者可能重放捕获到的 0-RTT Early Data。

所以 Server 需要 Anti-Replay 策略，应用也必须谨慎选择允许 Early Data 的操作。

“查询页面”和“扣款一次”的重放风险完全不同。

---

# 50. CRL / OCSP / OCSP Stapling

证书可能在过期前就需要撤销。

## CRL

CA 发布 Certificate Revocation List。

问题：

- 列表可能很大；
- 更新存在延迟。

## OCSP

客户端查询某张 Certificate 当前状态。

问题：

- 额外网络请求；
- 隐私和可用性；
- responder 延迟。

## OCSP Stapling

Server 定期获取带签名 OCSP Response，在 TLS 握手时一起提供给 Client。

所以：

> **不要把“Browser 每次都实时访问 CA”当成通用流程。**

实际浏览器 revocation 策略比这个入门模型复杂。

---

# 51. ECH 是干什么？

经典 ClientHello 中的 SNI 可能被观察。

Encrypted ClientHello 的目标之一是：

> 进一步保护 ClientHello 中敏感内容，降低真实 hostname 暴露。

但 ECH 依赖客户端、DNS 和服务端部署支持，不应假设所有 HTTPS 默认都已启用。

---

# 52. 数字证书为什么不能阻止所有钓鱼网站？

如果攻击者合法注册：

~~~text
paypa1-example.com
~~~

并为它申请合法证书，Browser 可以正确验证：

> 当前连接确实是 paypa1-example.com。

TLS 不会自动判断：

> 这个域名是不是故意长得像 paypal.com。

所以证书提供的是：

> **技术上的域名 / Public Key 身份绑定，不是网站商业信誉判断。**

---

# 53. HTTPS 有锁为什么不代表业务没有安全漏洞？

HTTPS 可以保护传输，但不能自动解决：

- SQL Injection；
- XSS；
- CSRF；
- Broken Access Control；
- 业务越权；
- 弱密码；
- Server 被入侵；
- 恶意网站本身；
- 用户终端中毒。

所以：

> **HTTPS 是安全基础设施，不是完整应用安全方案。**

---

# 54. 一个完整 HTTPS Request 再走一次

~~~text
【Browser】

URL
https://shop.example.com/products

 ↓

DNS
shop.example.com
→ 203.0.113.20

 ↓

TCP
192.168.1.20:53124
→ 203.0.113.20:443

 ↓

TLS ClientHello
SNI = shop.example.com
ALPN = h2,http/1.1
key_share = ...

 ↓

ServerHello
ECDHE
HKDF

 ↓

EncryptedExtensions
Certificate
CertificateVerify
Finished

 ↓

Browser：
验证证书链
验证 SAN = shop.example.com
验证 Server Private Key 持有
验证 Finished

 ↓

Client Finished

 ↓

TLS Secure Channel

 ↓

HTTP Request

GET /products HTTP/1.1
Host: shop.example.com
Cookie: ...

 ↓

TLS Application Data

 ↓

TCP

 ↓

Server
~~~

---

# 55. Host、SNI、Certificate SAN 为什么经常一致？

正常：

~~~text
URL:
shop.example.com

TLS SNI:
shop.example.com

Certificate SAN:
shop.example.com

HTTP Host:
shop.example.com
~~~

如果 Server Certificate 只有：

~~~text
api.example.com
~~~

而用户访问：

~~~text
shop.example.com
~~~

Browser 会认为 hostname validation 失败。

因为：

> “证书是真的”不等于“证书是给这个 hostname 的”。

---

# 56. HTTP/1.1 为什么还会继续演化？

即使连接可以复用，HTTP/1.1 单连接并发能力有限。

于是演化出：

~~~text
HTTP/2
Binary Framing
Stream
Multiplexing
HPACK
~~~

但 HTTP/2 仍跑在 TCP 上，TCP 丢包仍可能形成传输层队头阻塞。

HTTP/3 / QUIC 再进一步改变底层传输方式。

下一章展开。

---

# 57. HTTP Cache 与 CDN 是什么关系？

Browser Cache：

~~~text
离用户最近
~~~

CDN / Proxy Cache：

~~~text
共享的中间缓存
~~~

~~~text
Browser
 ↓
CDN Edge
 ├─ Cache Hit → 直接 Response
 └─ Cache Miss
       ↓
     Origin
~~~

缓存行为还受 Cache-Control、Vary、ETag、Authorization、CDN policy 等影响。

---

# 58. HTTP Authentication 与 TLS Authentication 是一回事吗？

不是。

## TLS Server Authentication

回答：

> 当前 Server 是否持有 shop.example.com 对应可信 Certificate Private Key？

## HTTP / Application Authentication

回答：

> 当前用户是谁？

例如：

~~~text
Cookie
Authorization: Bearer ...
Session
OAuth token
~~~

所以：

> TLS 认证服务器，业务认证用户，属于不同层。

---

# 59. Browser DevTools 实验

打开 Network 面板，观察：

- Method；
- Status；
- Request Headers；
- Response Headers；
- Cookie；
- Cache；
- Protocol；
- Timing。

重点找：

~~~text
Host / :authority
Content-Type
Content-Length
Cache-Control
ETag
Cookie
Set-Cookie
~~~

---

# 60. curl 实验

Windows 可直接尝试：

~~~powershell
curl.exe -v https://example.com/
~~~

观察：

- DNS / connect；
- TLS；
- Request Headers；
- Response Headers；
- HTTP version。

不同 curl 构建和 TLS backend 输出格式会不同。

---

# 61. OpenSSL 实验

如果环境有 OpenSSL：

~~~bash
openssl s_client -connect example.com:443 -servername example.com
~~~

重点看：

- Certificate Chain；
- Server Certificate；
- Subject / Issuer；
- TLS version；
- cipher；
- ALPN。

也可以：

~~~bash
openssl s_client -connect example.com:443 -servername example.com -showcerts
~~~

观察 Server 发来的 Certificate Chain。

---

# 62. Wireshark 实验

过滤：

~~~text
tls
~~~

重点找：

~~~text
ClientHello
ServerHello
EncryptedExtensions
Certificate
CertificateVerify
Finished
Application Data
~~~

尝试回答：

1. ClientHello 中是否看到 SNI？
2. ALPN offer 有哪些？
3. Server 选了哪个 cipher suite？
4. key_share group 是什么？
5. ServerHello 后哪些消息已加密？
6. 为什么看不到 HTTP 明文 Body？
7. IP / TCP metadata 为什么仍可见？

---

# 63. 最容易混淆的 20 个点

1. HTTP 是应用层协议，不负责 TCP 可靠传输。
2. HTTPS 不是新 HTTP，而是 HTTP over TLS。
3. GET / POST 核心区别是语义，不是“URL vs Body”口诀。
4. Safe 与 Idempotent 是 HTTP 语义属性。
5. HTTP/1.1 需要自己的 Message Framing，因为 TCP 是字节流。
6. HTTP persistent connection 不等于 TCP Keepalive。
7. Cookie 不等于 Session。
8. Host / SNI / :authority 可能内容相同，但属于不同阶段。
9. TLS 同时解决机密性、完整性和身份认证。
10. Hash 不是 Encryption。
11. 数字签名不是“私钥加密、公钥解密”。
12. ECDHE ephemeral key 与 Certificate identity key 不是同一个 Public Key。
13. Certificate 上的 CA Signature 与 TLS CertificateVerify 不是同一个签名。
14. Root CA 通常来自本机 Trust Store，不是 Server 每次发送。
15. TLS 1.3 ServerHello 后大部分握手消息已经加密。
16. TLS 1.3 cipher suite 主要描述 AEAD + Hash。
17. TLS 1.3 不应简化成“永远只有 ECDHE”，恢复还有 PSK 模式。
18. 0-RTT 有 Replay 风险。
19. HTTPS 不隐藏所有网络 metadata。
20. HTTPS 有锁不代表网站业务逻辑没有漏洞。

---

# 64. 一句话记忆

> **HTTP 定义业务请求/响应语义；TLS 用证书身份、公钥签名、(EC)DHE/PSK 和 HKDF 建立密钥，再用对称 AEAD 保护 HTTP；TCP 负责把这些 TLS 字节可靠、有序地运输。**

---

# 65. 自测

1. HTTP、TLS、TCP 分别负责什么？
2. GET 和 POST 最根本的区别为什么不是参数位置？
3. HTTP/1.1 为什么需要 Content-Length 或其他 framing？
4. Cookie 和 Session 有什么区别？
5. Host、SNI、:authority 分别出现在哪个阶段？
6. 为什么裸 HTTP 无法提供 Server Authentication？
7. Symmetric、Public-key、Hash、Digital Signature 分别解决什么？
8. 为什么数字签名不能解释成私钥加密？
9. ECDHE ephemeral key 与 Certificate public key 有什么区别？
10. Forward Secrecy 为什么与 ephemeral key 有关？
11. HKDF 为什么要从 Shared Secret 派生多个 key？
12. CA 主要在哪个时间轴参与？
13. 为什么 Server 通常发送 Intermediate Certificate？
14. Certificate Signature 与 CertificateVerify 分别证明什么？
15. TLS 1.3 为什么 ServerHello 后可以加密后续 Handshake？
16. Finished 与 CertificateVerify 分别保护什么？
17. TLS 1.3 cipher suite 为什么不像 TLS 1.2 那么长？
18. Session Resumption 为什么降低延迟？
19. 0-RTT 为什么有 Replay 风险？
20. HTTPS 为什么不能隐藏目标 IP？
21. HTTPS 为什么不能自动防止 XSS / SQL Injection？
22. TLS Server Authentication 和用户登录 Authentication 有什么区别？

---

# 66. 下一章

下一章进入现代协议：

> **06｜HTTP/2、HTTP/3、QUIC、WebSocket、RPC：为什么 HTTP 还要继续演化？**

主线：

~~~text
HTTP/1.1
 ↓
多连接 / HOL 问题
 ↓
HTTP/2
Binary Frame
Stream
Multiplexing
HPACK
 ↓
TCP-level HOL
 ↓
QUIC
UDP
Connection ID
Stream
Integrated TLS 1.3
 ↓
HTTP/3
~~~

还会解释：

~~~text
WebSocket
为什么不是“更快 HTTP”？

RPC
为什么经常跑在 HTTP/2 上？

gRPC / Thrift / HTTP
到底是什么关系？
~~~

---

# 67. 延伸阅读

主要参考：

- xiaolincoder/CS-Base · HTTP 常见面试题
- xiaolincoder/CS-Base · HTTPS RSA
- xiaolincoder/CS-Base · HTTPS ECDHE
- xiaolincoder/CS-Base · HTTPS 优化
- RFC 9110 · HTTP Semantics
- RFC 8446 · TLS 1.3

具体链接见 [SOURCES.md](./SOURCES.md)。
