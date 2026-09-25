#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo '请以 root 用户运行。'
  exit 1
fi
if [[ ! -f /opt/CodeFlowGraph/package.json ]]; then
  echo '请先将仓库克隆到 /opt/CodeFlowGraph。'
  exit 1
fi
if [[ ! -x /usr/bin/node ]] || ! /usr/bin/node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)'; then
  echo '需要 /usr/bin/node，版本 22 或以上。请按 README 安装 Node.js。'
  exit 1
fi
command -v nginx >/dev/null || { echo '请先安装 Nginx。'; exit 1; }
cd /opt/CodeFlowGraph
npm ci --include=dev
npm run build
install -m 0644 deploy/CodeFlowGraph.service /etc/systemd/system/CodeFlowGraph.service
install -m 0644 deploy/CodeFlowGraph.nginx /etc/nginx/sites-available/CodeFlowGraph
ln -sfn /etc/nginx/sites-available/CodeFlowGraph /etc/nginx/sites-enabled/CodeFlowGraph
nginx -t
systemctl daemon-reload
systemctl enable CodeFlowGraph
systemctl restart CodeFlowGraph
systemctl enable nginx
systemctl restart nginx
systemctl --no-pager --full status CodeFlowGraph
echo '部署完成。访问 http://服务器IP:16046'
