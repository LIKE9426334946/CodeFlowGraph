# CodeFlowGraph

用于学习 Python / PyTorch 网络的代码与 SVG 双向绑定工作台。桌面和平板横屏为可调整宽度的左右布局，竖屏使用“代码 / 结构图”标签切换。

## 功能

- CodeMirror Python 编辑器：语法高亮、行号、多行选择、Ctrl/⌘+F、撤销重做、绑定行标记、多文件编辑。
- 直接解析 SVG DOM，使用独立 Overlay；通过 `getScreenCTM().inverse()` 把框选转换为 SVG 原始坐标，兼容非零 viewBox 和 SVG 内嵌变换。
- 鼠标 / 单指平移，指针中心滚轮缩放，双指捏合缩放，触摸框选；支持滚动条、100%、适应窗口、适应宽度和重置。
- Code ↔ SVG 双向定位；同一代码范围可建立多个绑定；点击 gutter 圆点、代码行或绑定列表定位结构，点击矩形定位代码。
- 编辑绑定名称、颜色、代码范围、重新框选和删除；代码增删时自动跟踪绑定行号。
- SVG 代码注释和连接线随图同比例缩放；可调整注释坐标。
- Markdown 备注与 KaTeX 数学公式；搜索全部代码文件、SVG 文字、绑定名称、备注。
- 多项目管理、代码上传、新建 / 重命名 / 删除文件、深浅主题、完整 ZIP 导入导出。
- 服务器自动保存项目、代码、SVG、绑定、备注、缩放、视图中心、分栏比例、编辑器滚动和光标；刷新后恢复。
- 保存采用 750 ms 防抖、顺序提交和版本检测。并发页面冲突会提示；保存失败不会显示“已保存”，可导出当前本地副本。
- 自带可编辑的 Multi-Head Attention 示例，包含 PyTorch 代码、结构 SVG 和五个绑定。

代码仅作为文本进行编辑和学习，服务端不执行上传的 Python。编辑器、公式字体及脚本随构建打包，不依赖外部 CDN。

## 端口和部署结构

| 项目         | 值                                          |
| ------------ | ------------------------------------------- |
| GitHub 分支  | `main`                                      |
| 部署目录     | `/opt/CodeFlowGraph`                        |
| 公网入口     | `http://服务器IP:16046`                     |
| Node.js 监听 | `127.0.0.1:3046`                            |
| systemd      | `/etc/systemd/system/CodeFlowGraph.service` |
| Nginx 配置   | `/etc/nginx/sites-available/CodeFlowGraph`  |
| 项目数据     | `/opt/CodeFlowGraph/data`                   |

使用 Ubuntu、root、Node.js 22 或以上、Nginx、systemd。没有数据库服务、容器或用户权限系统。

## 首次部署

以下命令在 Ubuntu 服务器上以 **root** 执行。

### 1. 安装运行环境

```bash
apt-get update
apt-get install -y git nginx curl ca-certificates
```

如果 `/usr/bin/node` 已经为 22 或更高版本，可跳过下面的 Node.js 安装。

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/nodesource_setup_22.sh
bash /tmp/nodesource_setup_22.sh
apt-get install -y nodejs
/usr/bin/node --version
npm --version
```

### 2. 获取项目并部署

```bash
mkdir -p /opt
git clone -b main https://github.com/LIKE9426334946/CodeFlowGraph.git /opt/CodeFlowGraph
cd /opt/CodeFlowGraph
bash deploy/install.sh
```

脚本会安装依赖、构建前端、安装 systemd / Nginx 配置、检查 Nginx、启用开机启动并启动服务。已有其他项目的 Nginx 配置不会被删除。

如果服务器使用云安全组或防火墙，在对应规则中允许 TCP **16046**。如已启用 UFW，可执行：

```bash
ufw allow 16046/tcp
```

浏览器访问：

```text
http://服务器IP:16046
```

### 3. 验证

```bash
systemctl status CodeFlowGraph --no-pager
nginx -t
curl http://127.0.0.1:3046/api/health
curl http://127.0.0.1:16046/api/health
ss -lntp | grep -E ':3046|:16046'
```

健康接口应返回 `{"ok":true,"name":"CodeFlowGraph"}`。Node.js 应只监听 `127.0.0.1:3046`，公网通过 Nginx 访问。

## 手动部署（与脚本等价）

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

systemd 配置指定 `User=root`、工作目录 `/opt/CodeFlowGraph`、入口 `/usr/bin/node /opt/CodeFlowGraph/backend/server.js`、`HOST=127.0.0.1`、`PORT=3046`、`Restart=always`。Nginx 使用独立 `server` 监听 16046，保留 Host（包括端口）、转发来源 IP 并支持 WebSocket 升级。

## 更新

```bash
cd /opt/CodeFlowGraph
git pull --ff-only origin main
npm ci --include=dev
npm run build
systemctl restart CodeFlowGraph
systemctl status CodeFlowGraph --no-pager
```

如果此次更新包含部署配置变更，可重新执行 `bash deploy/install.sh`。用户数据在 `.gitignore` 中，更新不会覆盖 `data/`。

## 使用流程

1. 新建项目，上传 `.py` 和 `.svg`，或创建 Attention 示例。
2. 在左侧选择单行 / 连续多行代码。
3. 点击“绑定代码与 SVG”，在右侧拖动或触摸框选结构区域。
4. 在绑定详情修改名称、颜色、行号或备注。需要替换区域时使用“重新框选”。
5. 点击代码行 / gutter 圆点定位结构；点击结构矩形定位代码。重复点击同一代码行可轮流定位该行的多个绑定。
6. 右上方 `</>` 按钮打开“在 SVG 中显示代码”，注释、文字与连接线均在 SVG 坐标系中。
7. 自动保存状态变为“已保存”后即可刷新。导出项目可获得可迁移的 ZIP。

### 操作快捷方式

| 操作                                   | 结果                        |
| -------------------------------------- | --------------------------- |
| 鼠标拖动 / 单指拖动                    | 平移 SVG                    |
| 滚轮 / 双指捏合                        | 以指针 / 手势中点为中心缩放 |
| Alt + 滚轮 / 纵向滚动条                | 上下浏览长 SVG              |
| Shift + 滚轮 / 横向滚动条              | 左右浏览 SVG                |
| 画布获焦后方向键 / Page Up / Page Down | 平移 / 翻页                 |
| 画布获焦后 Home / End                  | 顶部 / 底部                 |
| Ctrl/⌘ + F                             | 当前文件搜索                |
| Ctrl/⌘ + K                             | 全局搜索                    |
| Ctrl/⌘ + S                             | 立即保存                    |
| Escape                                 | 取消框选 / 关闭弹窗         |
| 分隔条获焦后左右方向键                 | 调整左右面板比例            |

平板先在代码编辑器用原生触摸文本选择，再点击绑定按钮。框选模式下单指画框，双指依然缩放；非框选模式下单指平移。在竖屏中按“代码 / 结构图”标签切换。绑定详情也可以直接输入起止行号。

## 数据、备份与导入导出

所有内容保存于服务器文件系统。每个项目通过一个原子更新的 `current.json` 指针切换完整快照，保留当前与上一版本。`bindings.json` 独立保存。代码 / SVG 未变化时复用磁盘文件，不因移动画布重复写入大图。界面状态保存只传输变化的字段。

```text
data/
  workspace.json
  projects/<project-id>/
    current.json
    versions/<revision>-<version-id>/
      project.json
      bindings.json
      network.svg
      sources/<file-id>.py
```

ZIP 导出保留用户文件名：

```text
Transformer.zip
  project.json
  bindings.json
  model.py
  attention.py
  transformer.svg
```

导入会创建一个新项目，不覆盖现有项目。无论图的内部节点能否识别，都可以用手动框选绑定。替换项目 SVG 时会确认并清除旧绑定，避免把旧坐标误用于新图。

完整服务器备份可以短暂停服务后打包数据，以确保多个项目快照一致：

```bash
systemctl stop CodeFlowGraph
tar -czf /root/CodeFlowGraph-data-$(date +%F-%H%M%S).tar.gz -C /opt/CodeFlowGraph data
systemctl start CodeFlowGraph
```

文件大小限制：单个 Python 文件 2 MB、SVG 30 MB、上传 ZIP 40 MB、ZIP 解压总量 80 MB；每项目最多 64 个代码文件、5000 个绑定。自动保存完成前关闭浏览器会提示未保存修改；网络失败后保留页面，可重试或导出本地副本。

## 开发与验证

```bash
npm ci
npm run dev
```

访问开发服务器 `http://127.0.0.1:5173`；Vite 将 `/api` 转发给 `127.0.0.1:3046`。

```bash
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

测试涵盖快照保存、版本冲突、重启读取、ZIP 多文件往返、非法数据拒绝，以及浏览器中的坐标转换、框选、双向定位、编辑后行号跟踪、刷新恢复、搜索与触摸手势。E2E 使用独立的临时数据目录，不修改实际项目数据。

## 常见问题

- **502**：查看 `systemctl status CodeFlowGraph` 和 `journalctl -u CodeFlowGraph -n 100 --no-pager`，确认已构建 `dist/` 且 `/usr/bin/node` 版本正确。
- **公网打不开**：确认 Nginx 配置已启用、`nginx -t` 通过，安全组放行 16046。
- **保存冲突**：另一个页面更新了同一项目；先导出当前本地副本，然后重新加载。必要时把本地副本作为新项目导入。
- **SVG 文件被拒绝**：需要有效 XML 和 `viewBox`，或明确的 `width` / `height`。上传 SVG 内的脚本、外部资源与 HTML 嵌入会移除，普通 Netron 形状、路径、文字和内嵌样式保留。
- **长图很小**：选择“适应宽度”，再拖动或用滚动条浏览；“适应窗口”会缩小至整张图可见。

## 实现说明

React + TypeScript + CodeMirror 6 + DOMPurify + KaTeX；Node.js + Express + 文件系统快照；JSZip 用于备份迁移。

`SvgViewer` 将原始 SVG 与 Overlay 放入同一个外层 SVG，保留原始坐标。原 SVG 放在 Shadow DOM 中隔离样式。平移 / 缩放通过 DOM transform 和原生滚动完成，手势移动按动画帧合并；React 只接收延迟的视图状态，不随每次 pointermove 重新渲染。SVG 文本索引在第一次搜索时生成并缓存。
