# 评委公网入口：IP + HTTPS + 访问密码

现有 127.0.0.1:8080 入口与 SSH 通道继续保留。公网入口另用 Caddy 容器提供，
不公开 Python 后端端口，也不将模型或高德安全密钥传给网关。

## 1. 配置

从云实例页面确认公网 IPv4，在项目根目录运行：

```bash
git pull --ff-only
python3 backend/scripts/configure_public_access.py
```

使用 Ubuntu 服务器自带的 python3（本项目服务器为 3.10）。
输入公网 IPv4、新设的演示访问密码（至少 12 字符），再确认一次密码。
工具备份根目录 .env，保留已有地图设置，只保存 bcrypt 哈希。
用户名固定为 judge。不要使用 SSH 登录密码或 API Key 作为演示密码。
工具设置 COMPOSE_PROFILES=public，后续普通 docker compose up 会包含网关。
若未运行本工具，public profile 默认关闭，不影响之前的内部部署。

## 2. 网络与启动

云平台外网防火墙仅新增 TCP 80 和 443 入站规则；保留已有 SSH 规则，
不删除或替换整套规则，不需要开放 8000、8080 或 Caddy 管理端口。
如服务器还运行 UFW 或其他主机防火墙，也需核对相应规则。

```bash
sudo docker compose up -d gateway
sudo docker compose logs --tail=80 gateway
```

官方基础镜像：public.ecr.aws/docker/library/caddy:2.11.7-alpine。
Caddy 向 Let's Encrypt 申请公网 IP 证书，显式使用 shortlived profile，
HTTP-01 验证需要公网 80 端口可达，用户访问需要公网 443 端口可达。
证书与 ACME 账号保存在 caddy-data 命名卷中，由 Caddy 自动续期。
签发或续期失败时应排查，不能改成忽略证书验证或要求评委绕过浏览器警告。

Caddy 启动不代表公网入口已验收：必须确认签发成功，再从外部网络验证。

## 3. 验收

在另一台电脑或手机流量网络访问 https://公网IPv4：

- 浏览器证书正常，没有安全警告。
- 未输入凭据时网页与 API 均要求登录（HTTP 401）。
- 用户名 judge + 演示密码可以打开页面，地图及 AI 正常。
- 关闭个人电脑的 SSH 通道后，仍可通过公网地址访问。
- 错误密码不能访问 /api/ai/health 或 /_AMapService/ 等接口。

```bash
curl -I https://公网IPv4/
```

未认证应返回 401，而不是直接返回网站页面；不要给 curl 添加 -k。
向评委提供公网网址与演示访问凭据。访问密码只保护演示入口，正式多用户产品仍需账号、配额和限流设计。

## 4. 更新与暂停

日常 git pull 和 docker compose up -d --build --force-recreate 会保留命名卷和配置。
不要使用 down -v，也不要在排错时删除证书数据卷反复签发，以免触发 CA 速率限制。
修改密码后运行 sudo docker compose up -d --force-recreate gateway。
暂停公网入口可运行 sudo docker compose stop gateway，原内部入口仍可用。
公网 IP 变化后须重新运行配置工具，申请新 IP 的证书。

参考：

- [Let's Encrypt 公网 IP 与短期证书](https://letsencrypt.org/2026/01/15/6day-and-ip-general-availability)
- [Caddy ACME profile](https://caddyserver.com/docs/caddyfile/directives/tls)
- [Caddy 访问认证](https://caddyserver.com/docs/caddyfile/directives/basic_auth)
- [优云智算防火墙与端口](https://www.compshare.cn/docs/operation/gpu/firewall)
