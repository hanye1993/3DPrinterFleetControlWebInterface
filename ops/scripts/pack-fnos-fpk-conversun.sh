#!/usr/bin/env bash
# 按 conversun/fnos-apps 社区布局打包飞牛 .fpk（与 fnpack 输出结构不同）
# 关键差异：ui/ 在 fpk 根目录；manifest 含 fpk_version=1；checksum=md5(app.tgz)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PKG="$ROOT/packages-src/fnos/hanye-printer-monitor"
SERVER="$PKG/app/server"
OUT_DIR="$ROOT/packages"
mkdir -p "$OUT_DIR"
VERSION="$(node -p "require('$ROOT/package.json').version")"
APPNAME="hanyemonitor"
LAUNCH="${APPNAME}.Application"

need() { command -v "$1" >/dev/null 2>&1 || { echo "缺少命令: $1" >&2; exit 1; }; }
need rsync
need node
need npm
need md5

echo "==> 同步版本: $VERSION"
if sed --version >/dev/null 2>&1; then
  sed -i "s/^version=.*/version=$VERSION/" "$PKG/manifest"
else
  sed -i '' "s/^version=.*/version=$VERSION/" "$PKG/manifest"
fi

echo "==> 构建主程序"
(
  cd "$ROOT"
  npm run build
)

echo "==> 准备 app/server"
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

pack_one() {
  local platform="$1"
  local outfile="$2"
  local work
  work="$(mktemp -d)"
  mkdir -p "$work/cmd" "$work/config" "$work/wizard" "$work/ui/images"

  rsync -a "$PKG/cmd/" "$work/cmd/"
  rsync -a "$PKG/config/" "$work/config/"
  rsync -a "$PKG/wizard/" "$work/wizard/"
  rsync -a "$PKG/app/ui/" "$work/ui/"
  cp -f "$PKG/ICON.PNG" "$PKG/ICON_256.PNG" "$work/"

  tar -czf "$work/app.tgz" -C "$SERVER" .
  chmod +x "$work/cmd/"*

  cat >"$work/manifest" <<EOF
appname = ${APPNAME}
version = ${VERSION}
display_name = 韩叶打印机监控台
desc = 统一监控多品牌 3D 打印机。Node 直装，无需 Docker。请先安装 Node.js 20 或 22。
changelog = conversun fpk layout
platform = ${platform}
source = thirdparty
maintainer = hanye
distributor = hanye
service_port = 17890
checkport = true
ctl_stop = true
desktop_uidir = ui
desktop_applaunchname = ${LAUNCH}
EOF
  cs="$(md5 -q "$work/app.tgz")"
  echo "checksum = $cs" >>"$work/manifest"
  echo "fpk_version = 1" >>"$work/manifest"

  (
    cd "$work"
    tar -czf "$outfile" *
  )
  rm -rf "$work"
  ls -lh "$outfile"
}

echo "==> 打包 conversun 布局 fpk"
pack_one "all" "$OUT_DIR/hanye-printer-monitor-conversun-all.fpk"
pack_one "x86" "$OUT_DIR/hanye-printer-monitor-conversun-x86.fpk"
pack_one "arm" "$OUT_DIR/hanye-printer-monitor-conversun-arm.fpk"
cp -f "$OUT_DIR/hanye-printer-monitor-conversun-all.fpk" "$OUT_DIR/hanye-printer-monitor.fpk"

echo "OK: conversun layout packages in $OUT_DIR"
