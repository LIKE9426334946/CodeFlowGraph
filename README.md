# CodeFlowGraph

一个简单的整页 SVG 查看与标签工具。图片占据右侧查看区，添加标签、缩放、全屏和管理入口集中在左侧栏。

- **显示页 `/`**：浏览 SVG，直接添加、修改、拖动或删除文字标签。
- **管理页 `/admin`**：上传 / 替换 SVG，也可以编辑标签。
- 标签保存在 SVG 原始坐标系中，跟随图片一起平移、滚动和缩放。
- 图片与标签保存到服务器，刷新或重新打开页面仍可恢复。
- 支持鼠标操作和触摸平板；不再提供代码显示、代码编辑或分栏。

## 页面地址

| 页面             | 地址                          |
| ---------------- | ----------------------------- |
| 显示页面         | `http://服务器IP:16046/`      |
| 管理页面         | `http://服务器IP:16046/admin` |
| Node.js 内部监听 | `127.0.0.1:3046`              |

## 使用方式

1. 在 `/admin` 上传 SVG，再打开显示页。
2. 点击“添加标签”，在图片上点击或触摸需要标注的位置。
3. 输入文字，点击“保存标签”（也可以按 Ctrl/⌘+Enter）。支持多行文字。
4. 拖动标签可以调整位置；点击标签可以修改文字或删除。
5. 点击空白处拖动画布。普通滚轮滚动，Ctrl/⌘+滚轮以指针位置缩放，平板使用双指捏合缩放。

左侧栏提供放大、缩小、100%、适应宽度及浏览器全屏（浏览器支持时）。图片从查看区顶部开始显示，上下不预留画布空间，长图滚动范围止于图片底边。点击“取消添加”或按 Esc 取消放置；编辑框的关闭按钮会放弃尚未确认的文字。

确认文字、删除标签或拖动结束后约 750 ms 自动保存，工具栏显示“正在保存…”或“已保存”。标签输入框中的文字需先点击“保存标签”。其他打开的页面在空闲时约 3 秒同步一次；正在输入或拖动时不会打断本页操作。

替换为不同的 SVG 会清空当前标签，管理页会先提示确认。重新上传完全相同的 SVG 可以保留标签。每张图最多 1000 个标签，每个标签最多 1000 字符；SVG 文件上限为 30 MB。

## 服务器部署

按 `Development.MD` 要求使用 Ubuntu、root、Node.js、Nginx、systemd，无需数据库或 Docker。

- 项目目录：`/opt/CodeFlowGraph`
- 分支：`main`
- 外部端口：`16046`
- 内部端口：`3046`，只监听 `127.0.0.1`
- systemd：`/etc/systemd/system/CodeFlowGraph.service`
- Nginx：`/etc/nginx/sites-available/CodeFlowGraph`

### 首次部署

以 root 用户执行：

```bash
apt-get update
apt-get install -y git nginx curl ca-certificates
```

需要 Node.js 22 或以上。如果 `/usr/bin/node` 版本已经满足要求，跳过此步骤：

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/nodesource_setup_22.sh
bash /tmp/nodesource_setup_22.sh
apt-get install -y nodejs
/usr/bin/node --version
```

获取项目并执行部署脚本：

```bash
mkdir -p /opt
git clone -b main https://github.com/LIKE9426334946/CodeFlowGraph.git /opt/CodeFlowGraph
cd /opt/CodeFlowGraph
bash deploy/install.sh
```

脚本会安装依赖、构建前端、安装本项目的 systemd / Nginx 配置、执行 `nginx -t`、启用开机启动并启动服务。其他项目的配置不会被删除。

云安全组需要放行 TCP **16046**。若已启用 UFW，可执行：

```bash
ufw allow 16046/tcp
```

### 手动部署

也可以不用脚本，执行以下等价步骤：

```bash
cd /opt/CodeFlowGraph
npm ci --include=dev
npm run build
cp deploy/CodeFlowGraph.service /etc/systemd/system/CodeFlowGraph.service
cp deploy/CodeFlowGraph.nginx /etc/nginx/sites-available/CodeFlowGraph
ln -sfn /etc/nginx/sites-available/CodeFlowGraph /etc/nginx/sites-enabled/CodeFlowGraph
nginx -t
systemctl daemon-reload
systemctl enable CodeFlowGraph
systemctl start CodeFlowGraph
systemctl enable nginx
systemctl restart nginx
```

systemd 配置使用 `User=root`、`WorkingDirectory=/opt/CodeFlowGraph`、`ExecStart=/usr/bin/node /opt/CodeFlowGraph/backend/server.js`、`HOST=127.0.0.1`、`PORT=3046`、`Restart=always`。

Nginx 的独立 `server` 块监听 16046，代理到 `http://127.0.0.1:3046`，包含 Host、来源 IP、转发协议和 WebSocket Upgrade 请求头。管理页路由由 Node.js 直接提供，无需增加另一项 Nginx 配置。

### 更新现有部署

```bash
cd /opt/CodeFlowGraph
git pull --ff-only origin main
npm ci --include=dev
npm run build
systemctl restart CodeFlowGraph
```

然后刷新浏览器。页面地址、端口和 systemd / Nginx 配置不变。

### 检查状态

```bash
systemctl status CodeFlowGraph --no-pager
journalctl -u CodeFlowGraph -n 100 --no-pager
nginx -t
curl http://127.0.0.1:3046/api/health
curl http://127.0.0.1:16046/api/health
```

健康接口应返回 `{"ok":true,"name":"CodeFlowGraph"}`。502 时先检查 Node.js 服务和前端 `dist/` 是否已经构建；公网打不开时检查安全组和 Nginx。

## 保存与旧版升级

内容保存到服务器 `/opt/CodeFlowGraph/data/`，不依赖浏览器缓存。

```text
data/
  content.json
  svg/<内容哈希>.svg
  content-v2.backup.json   # 从代码 + SVG 版本升级时自动生成
```

`content.json` 使用版本 3，保存 SVG 引用、标签与保存版本号。每个标签保存 `id`、`text`、`x`、`y`、`fontSize`；位置与字号均采用 SVG 原始单位。标签层和图片共用一个 CSS transform，转换指针坐标使用 SVG 的 `getScreenCTM().inverse()`，支持非零 viewBox 原点。缩放、平移和拖动过程中只更新变换，不重新解析大型 SVG，也不保存屏幕坐标。

标签修改只提交标签，不重复上传 SVG；元数据采用临时文件加原子替换。多个页面同时保存时检测版本冲突，防止相互覆盖。遇到冲突时本页保留修改并提示保存失败，请保留文字后刷新再编辑。

从上一版升级时，保留原 SVG，并将包含旧代码的 `content.json` 原样备份为 `content-v2.backup.json`，然后迁移到只含 SVG 与标签的结构。更早的项目版也可迁移当前 SVG；原 `data/projects/`、源文件与绑定文件仍留在服务器中。升级不会删除旧代码数据，也不会重新显示代码功能。

更新代码不会覆盖 `data/`。如需备份，可打包整个 `data/` 目录。历史 SVG 文件保留在哈希目录中。

## 本地开发与验证

```bash
npm ci
npm run dev
```

开发时访问 `http://127.0.0.1:5173/` 或 `/admin`，Vite 将 `/api` 代理到 3046。

```bash
npm run build
npm test
npx playwright install chromium
npm run test:e2e
```

验证覆盖旧版迁移与备份、标签服务器保存、版本冲突、标签创建 / 修改 / 删除 / 拖动、非零 SVG 坐标、指针缩放与图片对齐、跨页面同步、刷新恢复及平板触摸缩放。浏览器测试使用独立临时数据目录。
