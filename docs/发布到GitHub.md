# 发布到 GitHub

> 这份文档是给"在 Windows 上、本机还没有 git"的人看的。照着做，大约 10 分钟。

---

## 第 0 步（最重要）：先轮换密钥

开发过程中**两把高德 Key 和一把 DeepSeek Key 都曾在聊天里以明文出现过**。
虽然它们都在 `.gitignore` 里、不会被提交，但为了安全，**请在推送到公开仓库之前去控制台重新生成**：

| Key | 去哪里换 | 换完要改哪里 |
| --- | --- | --- |
| 高德 **Web 端(JS API)** Key + 安全密钥 | https://console.amap.com/dev/key/app | `frontend/.env.local` |
| 高德 **Web 服务** Key | 同上（服务平台选「Web服务」） | `backend/.env` |
| DeepSeek API Key | https://platform.deepseek.com/api_keys | `backend/.env` |

> 换完记得重启前后端（`frontend/.env.local` 只在 dev server 启动时读一次）。

---

## 第 1 步：在 GitHub 网页上创建仓库

打开 https://github.com/new ，填：

| 字段 | 建议值 |
| --- | --- |
| Repository name | `trip-compiler` 或 `lushu`（**别用中文**，URL 会变成一长串编码） |
| Description | `路书编译师 TripCompiler —— 以酒店为起点、AI 自动编译多日出行路线的行程规划器（上海）` |
| Visibility | 想放简历上就 **Public**；只想自己看就 Private |
| Add a README file | **千万不要勾** ← 勾了会和本地首次 push 冲突（non-fast-forward） |
| Add .gitignore / license | **都不要勾**（仓库里已经有 `.gitignore` 了） |

点 **Create repository**，然后记下页面上的仓库地址，形如：

```
https://github.com/<你的用户名>/trip-compiler.git
```

---

## 第 2 步：安装 Git for Windows

本机**目前没有安装 git**（`Get-Command git` 找不到）。二选一：

- 官网下载：https://git-scm.com/download/win （一路默认下一步即可）
- 或者用 winget：`winget install --id Git.Git -e`

装完**关掉所有终端窗口重新打开**，验证：

```powershell
git --version
```

---

## 第 3 步：初始化仓库并推送

在项目根目录执行（把 `<你的用户名>` 和仓库名替换成你的）：

```powershell
cd C:\Users\35258\dsh-workspace\lushu

# 首次装 git 需要配一下身份（只配一次）
git config --global user.name  "你的名字"
git config --global user.email "你的邮箱"

git init -b main
git add -A

# ★ 关键一步：确认密钥和依赖没被加进来
git status --short | Select-String "\.env|node_modules|\.venv|\.db"
#    ↑ 这条命令应该**什么都不输出**。有输出就立刻停下，检查 .gitignore。

git commit -m "feat: 路书编译师 TripCompiler —— AI 多日行程编译器（上海）"
git remote add origin https://github.com/<你的用户名>/trip-compiler.git
git push -u origin main
```

### 推送时会要密码？

GitHub 从 2021 年起**不接受账号密码**，要用 **Personal Access Token（PAT）**：

1. 打开 https://github.com/settings/tokens → **Generate new token (classic)**
2. 勾选 **`repo`** 权限，有效期选 30 天
3. 生成的 token 当作密码粘贴（**只显示一次，先复制走**）

也可以装 [GitHub CLI](https://cli.github.com/) 后直接 `gh auth login`，它能自动帮你处理认证和建仓库：

```powershell
winget install --id GitHub.cli -e
gh auth login          # 选 HTTPS → 浏览器登录
gh repo create trip-compiler --public --source=. --remote=origin --push
```

---

## 第 4 步：验证

1. 刷新 GitHub 仓库页面，应该能看到 `README.md` / `backend/` / `frontend/` / `docs/`
2. **确认这三个"不该有"的东西都不在**：
   - `backend/.env` ❌
   - `frontend/.env.local` ❌
   - `frontend/node_modules/`、`backend/.venv/` ❌
3. 本地再检查一次仓库是干净的：

```powershell
git status
# 应该显示 "nothing to commit, working tree clean"
```

---

## 常见报错

| 报错 | 原因 | 解决 |
| --- | --- | --- |
| `rejected ... non-fast-forward` | 建仓库时勾了 README/.gitignore | `git pull --rebase origin main` 再 `git push` |
| `Support for password authentication was removed` | 用了账号密码 | 改用 PAT（见第 3 步） |
| `Permission denied (publickey)` | 用的是 SSH 地址但没有配置密钥 | 改用 `https://` 地址，或配 SSH key |
| `RPC failed; HTTP 413` | 单次推送太大 | 确认 `node_modules` 没进去（`git ls-files \| Select-String node_modules`） |
| `LF will be replaced by CRLF` 警告 | Windows 换行符转换 | 无害，忽略即可 |

---

## 仓库里已经排除的文件（`.gitignore`）

| 排除项 | 原因 |
| --- | --- |
| `node_modules/`、`.venv/`、`__pycache__/` | 依赖，体积大且与平台相关 |
| `.env`、`.env.local` | **含真实密钥** |
| `backend/data/*.db` / `*.db-shm` / `*.db-wal` | SQLite 缓存，4MB+ 且与机器相关 |
| `frontend/dist/`、`.vite/` | 构建产物 |
| `.tmp/`、`*.tmpdir/` | 工具临时目录 |

会保留并上传的"数据类"文件（都是纯文本、可审阅）：

- `backend/data/shanghai_pois.json`（145KB，276 个 POI 的高德快照）
- `frontend/src/data/shanghaiPois.ts`（107KB，同上，前端用）
- `docs/路书编译师_答辩.pptx`（53KB）

> 这些文件里只含 POI 名称/坐标/营业时间，**不含任何 Key**。

---

## 别人 clone 下来要怎么跑

```powershell
git clone https://github.com/<你的用户名>/trip-compiler.git
cd trip-compiler

# 后端
cd backend
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env        # 然后填 AMAP_WEB_KEY 和 DEEPSEEK_API_KEY
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000

# 前端（另开一个终端）
cd frontend
pnpm install
copy .env.example .env.local  # 然后填 VITE_AMAP_JS_KEY 和 VITE_AMAP_SECURITY_CODE
pnpm dev
```

> 没有 Key 也能跑：地图会显示"请配置 Key"引导卡，路线走**离线估算**（直线距离 × 绕行系数），
> AI 解析降级为**规则解析**。这一点在 README 里也有说明。
