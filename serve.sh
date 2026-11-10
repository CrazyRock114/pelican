#!/bin/bash
# 一键本地预览导航站(从仓库根目录起服务,raw/ 素材随站点直接可达)
cd "$(dirname "$0")" || exit 1
PORT="${1:-8787}"
echo "→ 导航站地址: http://127.0.0.1:${PORT}/"
echo "  (Ctrl+C 停止;原始素材 raw/ 仅被读取,不会被修改)"
python3 -m http.server "$PORT" --bind 127.0.0.1
