# CodeFlowGraph

一个简单的整页 SVG 查看与标签工具。图片占据右侧查看区，添加标签、缩放、全屏和管理入口集中在左侧栏。

- **显示页 `/`**：从左侧图片列表打开 SVG，直接添加、修改、拖动或删除文字标签。
- **管理页 `/admin`**：添加 SVG、修改图片名称、删除图片，也可以编辑标签。
- 标签保存在 SVG 原始坐标系中，跟随图片一起平移、滚动和缩放。
- 可以保存多张图片，每张图片的名称和标签独立保存到服务器，下次打开恢复最后选择的图片。
- 支持鼠标操作和触摸平板；不再提供代码显示、代码编辑或分栏。

## 页面地址

| 页面             | 地址                          |
| ---------------- | ----------------------------- |
| 显示页面         | `http://服务器IP:16046/`      |
| 管理页面         | `http://服务器IP:16046/admin` |
| Node.js 内部监听 | `127.0.0.1:3046`              |

## 使用方式

1. 在 `/admin` 左侧点击“添加 SVG”。每次上传都会新增一张图片，默认以文件名命名。
2. 点击图片列表中的名称即可打开；点击“命名”可修改名称，点击“删除”并确认可删除当前图片及其标签。
3. 点击“添加标签”，在图片上点击或触摸需要标注的位置。
4. 输入文字，点击“保存标签”（也可以按 Ctrl/⌘+Enter）。支持多行文字。
5. 拖动标签可以调整位置；点击标签可以修改文字或删除。
6. 点击空白处拖动画布。普通滚轮滚动，Ctrl/⌘+滚轮以指针位置缩放，平板使用双指捏合缩放。

左上角的小按钮可以隐藏 / 展开侧边栏，隐藏后 SVG 使用整页宽度，按钮仍保留在左上角。左侧栏提供放大、缩小、100%、适应宽度及浏览器全屏（浏览器支持时）。图片默认适应宽度；缩小后在查看区内左右居中，长图从顶部开始，滚动范围止于图片边缘。

缩小到整张图片刚好放入窗口时停止：长图的底部贴合查看区底边，宽图以完整宽度为下限。缩小按钮、Ctrl/⌘+滚轮、双指捏合和 100% 均遵守这个下限，达到下限后缩小按钮变灰。侧边栏开合、窗口尺寸或屏幕方向变化时重新计算下限；已有缩放比例高于下限时保持不变。图片和标签始终一起变换。点击“取消添加”或按 Esc 取消放置；编辑框的关闭按钮会放弃尚未确认的文字。

确认文字、删除标签或拖动结束后约 750 ms 自动保存，工具栏显示“正在保存…”或“已保存”。Ctrl/⌘+S 也可立即保存。切换、添加、重命名或删除图片前，会先保存当前正在输入的非空标签；保存失败时留在当前图片，保留修改并显示重试入口。

其他打开的页面在空闲时约 3 秒同步图片列表与当前图片的标签；正在输入或拖动时不会打断本页操作。不同页面可以分别查看不同图片。刷新或下次进入时，打开服务器记录的最后一张选中图片。删除当前图片后打开剩余图片；全部删除后显示空列表，可继续添加。

即使重复上传同一个 SVG，也会作为独立图片保存，拥有各自的名称和标签。图片名称最多 150 个字符，每张图最多 1000 个标签，每个标签最多 1000 字符；SVG 文件上限为 30 MB。

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
  gallery.json
  gallery-svg/<内容哈希>.svg
  content.json             # 升级前已有的文件原样保留
  svg/                     # 升级前已有的 SVG 原样保留
```

`gallery.json` 使用版本 4，保存图片列表、每张图片的独立 ID、名称、SVG 引用、标签、版本号、创建 / 修改时间，以及最后打开的图片 ID。SVG 内容单独写入 `gallery-svg/`，列表接口只返回图片摘要，打开时才读取当前图片。

每个标签保存 `id`、`text`、`x`、`y`、`fontSize`；位置与字号均采用 SVG 原始单位。标签层和图片共用一个 CSS transform，转换指针坐标使用 SVG 的 `getScreenCTM().inverse()`，支持非零 viewBox 原点。缩放、平移和拖动过程中只更新变换，不重新解析大型 SVG，也不保存屏幕坐标。

标签修改只提交所属图片的标签，不重复上传 SVG；元数据采用临时文件加原子替换。同一图片的多页面保存会检测版本冲突，防止相互覆盖；不同图片可以独立更新。遇到冲突时本页保留修改并提示保存失败，请保留文字后刷新再编辑。

第一次升级时自动将旧 `content.json` 中的图片和已有标签迁入图片列表，原文件与原 SVG 保持不变。更早的项目版也可迁移当前 SVG；原 `data/projects/`、源文件、绑定文件与已有备份仍留在服务器中。迁移只执行一次，之后删除图片不会使旧图片再次出现。

更新代码不会覆盖 `data/`。如需备份，可打包整个 `data/` 目录。删除图片会删除其元数据和标签；没有其他图片引用的 SVG 会从 `gallery-svg/` 清理，升级前的旧文件仍保留。

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

验证覆盖旧版图片和标签迁移、多图片添加 / 命名 / 切换 / 删除、服务器重启后的恢复、独立标签与版本冲突、切换前保存输入及失败保护、标签创建 / 修改 / 删除 / 拖动、非零 SVG 坐标、指针缩放与图片对齐、跨页面同步、刷新恢复及平板触摸缩放。浏览器测试使用独立临时数据目录。
