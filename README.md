# CodeFlowGraph

一个简单的代码与 SVG 对照显示网页。

- **显示页 `/`**：左边显示代码，右边显示 SVG。代码只读。
- **管理页 `/admin`**：编写、粘贴或上传代码，上传 / 替换 SVG，自动保存到服务器。
- 显示页只保留 **左右分屏（各一半） / 代码全屏 / SVG 全屏** 三种模式。
- 图片支持上下 / 左右滚动、鼠标或单指拖动、双指缩放、放大、缩小、100% 和适应宽度。
- 支持进入浏览器全屏；浏览器不支持时，仍可使用单独显示代码或 SVG 的模式。

已移除项目管理、多文件列表、绑定框选、代码关联、备注、公式、搜索、ZIP 导入导出、主题设置和可拖动分栏。现在只管理一份代码与一张 SVG。

## 页面地址

| 页面             | 地址                          |
| ---------------- | ----------------------------- |
| 显示页面         | `http://服务器IP:16046/`      |
| 管理页面         | `http://服务器IP:16046/admin` |
| Node.js 内部监听 | `127.0.0.1:3046`              |

## 使用方式

1. 进入 `/admin`，在左侧编辑器中编写 / 粘贴 Python 代码，或上传 `.py` / `.txt` 文件。
2. 在右侧上传 SVG。再次上传会替换当前图片。
3. 编辑后约 750 ms 自动保存，也可以点击“保存”或按 Ctrl/⌘+S。
4. 点击“打开显示页”，选择左右分屏、代码全屏或 SVG 全屏。

显示页只读，不提供上传、保存和代码编辑入口。管理页保存后，已打开的显示页会在约 3 秒内同步更新，刷新页面也可以立即加载。

SVG 的普通滚轮操作为滚动浏览；Ctrl/⌘+滚轮为指针位置缩放。平板使用单指拖动、双指捏合缩放。显示模式会在当前浏览器中记住。

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

然后刷新浏览器。显示页地址不变，管理页改为 `/admin`。端口和 systemd / Nginx 配置不变。

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

代码和 SVG 都保存到服务器 `/opt/CodeFlowGraph/data/`，不依赖浏览器缓存。显示模式保存在当前浏览器中。

```text
data/
  content.json
  svg/<内容哈希>.svg
```

`content.json` 保存代码、SVG 引用和版本信息，采用临时文件加原子替换写入。代码修改只提交代码，不重复上传 SVG。多个管理页同时修改时会检测版本冲突，防止相互覆盖。

从复杂版第一次升级时，自动读取旧版当前项目的当前代码文件与 SVG，作为新版显示内容。原来的 `data/projects/` 和其他源文件保留在服务器中，不会被删除。迁移只在首次生成 `content.json` 时进行。

更新代码不会覆盖 `data/`。如需备份，可打包整个 `data/` 目录。代码文件上限为 2 MB，SVG 上限为 30 MB。

## 本地开发与验证

```bash
npm ci
npm run dev
```

开发时访问 `http://127.0.0.1:5173/` 或 `/admin`。Vite 将 `/api` 代理到 3046。

```bash
npm run build
npm test
npx playwright install chromium
npm run test:e2e
```

验证覆盖管理页编辑和上传、服务器保存与重启读取、旧版内容迁移、显示页只读、三种布局、显示页同步更新和模拟平板触摸缩放。
