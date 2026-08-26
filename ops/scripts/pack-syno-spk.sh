#!/usr/bin/env bash
# 打包群晖 DSM .spk（Node 直装，无 Docker）
# 文档：https://help.synology.com/developer-guide/synology_package/scripts.html
# 用法：npm run pack:syno
#       SPK_ARCH=aarch64 bash ops/scripts/pack-syno-spk.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PKG="$ROOT/packages-src/syno/hanyemonitor"
SERVER="$PKG/server"
OUT_DIR="$ROOT/packages"
mkdir -p "$OUT_DIR"
VERSION="$(node -p "require('$ROOT/package.json').version")"
ARCH="${SPK_ARCH:-$(uname -m)}"
case "$ARCH" in
  x86_64|amd64) ARCH=x86_64 ;;
  aarch64|arm64) ARCH=aarch64 ;;
  armv7l) ARCH=armv7l ;;
esac

need() { command -v "$1" >/dev/null 2>&1 || { echo "缺少命令: $1" >&2; exit 1; }; }
need rsync
need node
need npm
need tar

echo "==> 同步版本: $VERSION arch: $ARCH"
if sed --version >/dev/null 2>&1; then
  sed -i "s/^version=\".*\"/version=\"$VERSION\"/" "$PKG/INFO"
  sed -i "s/^arch=\".*\"/arch=\"$ARCH\"/" "$PKG/INFO"
else
  sed -i '' "s/^version=\".*\"/version=\"$VERSION\"/" "$PKG/INFO"
  sed -i '' "s/^arch=\".*\"/arch=\"$ARCH\"/" "$PKG/INFO"
fi

echo "==> 构建主程序"
(
  cd "$ROOT"
  npm run build
)

echo "==> 准备 server（dist + 生产依赖）"
rm -rf "$SERVER"
mkdir -p "$SERVER"

rsync -a "$ROOT/dist/" "$SERVER/dist/"
rsync -a \
  --exclude 'examples/plugin-orca-web' \
  --exclude 'examples/plugin-app-launcher' \
  --exclude 'examples/plugin-card-model-portrait' \
  "$ROOT/assets/" "$SERVER/assets/"
rsync -a "$ROOT/ops/sql/" "$SERVER/ops/sql/" 2>/dev/null || mkdir -p "$SERVER/ops/sql"
cp "$ROOT/package.json" "$ROOT/package-lock.json" "$SERVER/"

(
  cd "$SERVER"
  npm config set registry https://registry.npmmirror.com
  npm ci --omit=dev
)

if [ ! -f "$SERVER/dist/server/server/nodeServer.js" ]; then
  echo "构建失败：缺少 dist/server/server/nodeServer.js" >&2
  exit 1
fi

find "$PKG" -name '.DS_Store' -delete

echo "==> 赋权脚本"
chmod +x "$PKG"/scripts/*

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# package.tgz → 解压到 /var/packages/hanyemonitor/target/
tar -czf "$WORK/package.tgz" -C "$PKG" server

cp "$PKG/INFO" "$WORK/INFO"
cp -R "$PKG/scripts" "$WORK/scripts"
cp -R "$PKG/ui" "$WORK/ui"
cp -R "$PKG/conf" "$WORK/conf"
cp "$PKG/PACKAGE_ICON.PNG" "$WORK/PACKAGE_ICON.PNG"
cp "$PKG/PACKAGE_ICON_256.PNG" "$WORK/PACKAGE_ICON_256.PNG"

SPK_NAME="syno-${VERSION}-${ARCH}.spk"
SPK_PATH="$OUT_DIR/$SPK_NAME"

(
  cd "$WORK"
  tar -cf "$SPK_PATH" INFO package.tgz scripts ui conf PACKAGE_ICON.PNG PACKAGE_ICON_256.PNG
)

ls -lh "$SPK_PATH"
echo "OK: $SPK_PATH"
