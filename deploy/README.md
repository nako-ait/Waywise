# 云端部署：先进行服务器内部验收

运行环境：Ubuntu 虚拟机、Docker Engine、Docker Compose v2。
本配置先仅监听服务器本机 127.0.0.1:8080，不直接对公网开放。
通过验收后，再配置 HTTPS、访问入口和调用额度保护供评委使用。
评委公网 IP 入口的可选配置见 [PUBLIC_ACCESS.md](PUBLIC_ACCESS.md)。

## 准备配置

在项目根目录操作：

```bash
cp backend/.env.example backend/.env
```

在服务器上编辑 backend/.env，配置模型和高德 Web 服务密钥。
也可在项目根目录执行 `python3 backend/scripts/configure_cloud_ai.py`：
交互输入优云智算模型 API Key（不回显），自动设置官方接口和 deepseek-v4.1-flash 模型。
工具保留已有的有效配置项，从模板重建注释以丢弃手动误粘贴的无效文本；
更新前会在 backend/ 下备份原配置为 .env.backup-*，Linux 上备份和新文件权限均为 600。
不要上传或分享配置文件及其备份。
不要把真实密钥提交到 GitHub。模型平台的 Base URL 和模型 ID 必须以实际提供的信息为准。
留空密钥时，后端使用离线和规则降级，可先验证服务启动。
配置模型后，可用 `curl --max-time 60 http://127.0.0.1:8080/api/ai/health` 实际验证连接。
自检的输出上限为 1024 tokens，为思考型模型留出生成最终回答的空间；
只返回思考内容而无最终回答仍判为失败。诊断包含结束原因及 token 用量，不回显思考正文。
连通测试通过不代表工具调用已经验收，仍需用真实行程请求验证提案与执行流程。

配置高德可运行 `python3 backend/scripts/configure_cloud_amap.py`，按顺序隐藏输入：
高德 Web 服务 Key、Web 端 JS API Key、该 JS Key 对应的安全密钥。
工具保留现有 AI 设置并备份配置，写入 backend/.env 和项目根目录 .env。
根目录的 VITE_AMAP_JS_KEY 是公开的浏览器 Key；AMAP_SECURITY_CODE 仅在容器启动时传给 Nginx。
云端构建固定启用 /_AMapService 代理，不将安全密钥写进构建产物；本地开发仍支持旧的明文配置。
Nginx 仅代理固定高德上游，并验证 HTTPS 证书；关闭代理位置的请求日志和错误日志以避免记录鉴权参数。
参考 [高德服务器代理说明](https://lbs.amap.com/api/javascript-api-v2/guide/abc/jscode)。
不要把服务器 API 密钥填入 VITE_ 变量。代理公开前仍需配置访问保护和调用额度限制。
VITE_API_BASE 固定为空，前端通过 Nginx 同源访问 /api。
所有 .env 文件均被 Git 和 Docker 构建上下文排除。

## 启动与内部检查

```bash
sudo docker compose up -d --build
sudo docker compose ps
curl -f http://127.0.0.1:8080/api/health
curl -I http://127.0.0.1:8080/plan
```

如果构建失败，保留错误输出；不要盲目更换不可信镜像源。
基础镜像从 Docker 官方在 AWS ECR Public 发布的仓库获取，避免依赖 Docker Hub 的直连可用性。
参见 [Docker 官方说明](https://www.docker.com/blog/news-from-aws-reinvent-docker-official-images-on-amazon-ecr-public/)。
此调整不需要修改服务器 Docker 配置。Python、Node 和 Nginx 的版本标签保持不变。
后端不映射公网端口。Python 在容器内使用 3.12，不依赖 Ubuntu 自带的 Python 3.10。
缓存使用命名卷 backend-data；首次启动会从镜像复制 POI 快照，后续启动保留缓存。
更新 POI 快照需要单独同步到数据卷，重新构建镜像不会覆盖已有卷中的快照。
后端使用单个 worker：现有分享口令保存在进程内存中，重启后失效，多 worker 无法共享。

## 更新和排查

```bash
git pull --ff-only
sudo docker compose up -d --build
sudo docker compose logs --tail=100
```

修改后端环境变量后需要重新创建容器；上述 up 命令会处理。
修改前端 VITE_ 变量后必须重新构建前端。
停止服务可使用 sudo docker compose stop；不要添加 -v 删除数据卷。
公开访问、HTTPS 和访问保护需要在正式对外演示前完成配置与验证。
