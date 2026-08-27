#!/usr/bin/env bash
# Windows 一键安装包（内置 Node + NSSM + 托盘控制面板）
# 产出：packages/windows-<version>-amd64.exe（用户双击安装；桌面图标打开控制面板）
# 控制面板三个按钮：启动 / 重启 / 关闭，可最小化到系统托盘
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WIN="$ROOT/packages-src/win"
STAGING="$WIN/staging"
OUT_DIR="$ROOT/packages"
mkdir -p "$OUT_DIR"
VERSION="$(node -p "require('$ROOT/package.json').version")"
NODE_VERSION="${NODE_VERSION:-20.18.1}"
NODE_ZIP="node-v${NODE_VERSION}-win-x64.zip"
NODE_URL="https://nodejs.org/dist/v${NODE_VERSION}/${NODE_ZIP}"
NSSM_URL="https://nssm.cc/release/nssm-2.24.zip"
CACHE="$WIN/cache"
OUTFILE="windows-${VERSION}-amd64.exe"
STAGING_ONLY=0
for arg in "$@"; do
  [ "$arg" = "--staging-only" ] && STAGING_ONLY=1
done

need() { command -v "$1" >/dev/null 2>&1 || { echo "缺少命令: $1" >&2; exit 1; }; }
need node
need npm
need curl
need rsync
need unzip
need zip
need tar
need python3

echo "==> 版本: $VERSION  产物: $OUTFILE"
NEED_BUILD=0
if [ ! -d "$STAGING/node" ] || [ ! -f "$STAGING/app/dist/server/server/nodeServer.js" ]; then
  NEED_BUILD=1
  rm -rf "$STAGING"
else
  echo "==> 复用已有 staging（删除 win/staging 可强制重建）"
fi
mkdir -p "$STAGING/app" "$CACHE"

if [ "$NEED_BUILD" -eq 1 ]; then
  echo "==> 构建主程序"
  ( cd "$ROOT" && npm run build )

  echo "==> 准备 app（Windows x64 依赖）"
  rsync -a "$ROOT/dist/" "$STAGING/app/dist/"
  rsync -a \
    --exclude 'examples/plugin-orca-web' \
    --exclude 'examples/plugin-app-launcher' \
    --exclude 'examples/plugin-card-model-portrait' \
    "$ROOT/assets/" "$STAGING/app/assets/" 2>/dev/null || true
  rsync -a "$ROOT/ops/sql/" "$STAGING/app/ops/sql/" 2>/dev/null || mkdir -p "$STAGING/app/ops/sql"
  cp "$ROOT/package.json" "$ROOT/package-lock.json" "$STAGING/app/"

  (
    cd "$STAGING/app"
    npm config set registry https://registry.npmmirror.com
    export npm_config_platform=win32
    export npm_config_arch=x64
    export npm_config_target_platform=win32
    export npm_config_target_arch=x64
    npm ci --omit=dev --os=win32 --cpu=x64
  )

  if [ ! -d "$STAGING/app/node_modules/@esbuild/win32-x64" ]; then
    echo "==> 补装 @esbuild/win32-x64"
    (
      cd "$STAGING/app"
      export npm_config_platform=win32
      export npm_config_arch=x64
      npm install --omit=dev --os=win32 --cpu=x64 "@esbuild/win32-x64@*"
    )
  fi
  rm -rf "$STAGING/app/node_modules/@esbuild/darwin-arm64" "$STAGING/app/node_modules/@esbuild/darwin-x64" 2>/dev/null || true

  if [ ! -f "$STAGING/app/dist/server/server/nodeServer.js" ]; then
    echo "构建失败：缺少 nodeServer.js" >&2
    exit 1
  fi
fi

if [ ! -f "$STAGING/node/node.exe" ]; then
  echo "==> 下载 Node.js ${NODE_VERSION} win-x64"
  if [ ! -f "$CACHE/$NODE_ZIP" ]; then
    curl -fsSL -o "$CACHE/$NODE_ZIP" "$NODE_URL"
  fi
  rm -rf "$CACHE/node-extract"
  mkdir -p "$CACHE/node-extract"
  unzip -q -o "$CACHE/$NODE_ZIP" -d "$CACHE/node-extract"
  NODE_DIR="$(find "$CACHE/node-extract" -maxdepth 1 -type d -name 'node-v*' | head -1)"
  mkdir -p "$STAGING/node"
  rsync -a \
    --exclude 'node_modules/npm' \
    --exclude 'node_modules/corepack' \
    "$NODE_DIR/" "$STAGING/node/"
fi

if [ ! -f "$STAGING/nssm.exe" ]; then
  echo "==> 下载 NSSM"
  if [ ! -f "$CACHE/nssm.zip" ]; then
    curl -fsSL -o "$CACHE/nssm.zip" "$NSSM_URL"
  fi
  rm -rf "$CACHE/nssm-extract"
  mkdir -p "$CACHE/nssm-extract"
  unzip -q -o "$CACHE/nssm.zip" -d "$CACHE/nssm-extract"
  NSSM_EXE="$(find "$CACHE/nssm-extract" -name 'nssm.exe' -path '*/win64/*' | head -1)"
  cp "$NSSM_EXE" "$STAGING/nssm.exe"
fi

cp "$WIN/resources/start-hanyemonitor.bat" "$STAGING/"
cp "$WIN/resources/stop-hanyemonitor.bat" "$STAGING/"
cp "$WIN/resources/restart-hanyemonitor.bat" "$STAGING/"
cp "$WIN/resources/app.env.example" "$STAGING/"
cp "$WIN/resources/HanyeMonitorControl.ps1" "$STAGING/HanyeMonitorControl.ps1"

# 图标（控制面板 / 快捷方式）
ICON_DST="$STAGING/app-icon.ico"
if [ -f "$WIN/resources/app-icon.ico" ]; then
  cp "$WIN/resources/app-icon.ico" "$ICON_DST"
else
  ICON_SRC=""
  for cand in \
    "$ROOT/packages-src/syno/hanyemonitor/PACKAGE_ICON_256.PNG" \
    "$ROOT/packages-src/syno/hanyemonitor/PACKAGE_ICON.PNG" \
    "$ROOT/dist/web/assets/"icon-*.png; do
    [ -f "$cand" ] && ICON_SRC="$cand" && break
  done
  if [ -n "$ICON_SRC" ]; then
    python3 - <<PY
from PIL import Image
img = Image.open(r"""$ICON_SRC""").convert("RGBA")
sizes = [(16,16),(32,32),(48,48),(64,64),(128,128),(256,256)]
imgs = [img.resize(s, Image.Resampling.LANCZOS) for s in sizes]
imgs[-1].save(r"""$ICON_DST""", format="ICO", sizes=[(i.width,i.height) for i in imgs])
print("icon ok")
PY
  else
    rm -f "$ICON_DST"
  fi
fi

resolve_go() {
  if command -v go >/dev/null 2>&1; then
    command -v go
    return 0
  fi
  if [ -x "$CACHE/go/bin/go" ]; then
    echo "$CACHE/go/bin/go"
    return 0
  fi
  echo "==> 下载 Go 工具链（交叉编译 Windows exe）" >&2
  local GO_VER="1.22.10"
  local GO_TGZ="go${GO_VER}.darwin-amd64.tar.gz"
  mkdir -p "$CACHE"
  if [ ! -f "$CACHE/$GO_TGZ" ]; then
    curl -fL --connect-timeout 20 --max-time 300 -o "$CACHE/$GO_TGZ" "https://mirrors.aliyun.com/golang/${GO_TGZ}" \
      || curl -fL --connect-timeout 20 --max-time 300 -o "$CACHE/$GO_TGZ" "https://go.dev/dl/${GO_TGZ}"
  fi
  rm -rf "$CACHE/go"
  tar -C "$CACHE" -xzf "$CACHE/$GO_TGZ"
  echo "$CACHE/go/bin/go"
}

GO_BIN="$(resolve_go)"

echo "==> 编译托盘控制面板启动器 HanyeMonitorControl.exe（无黑框）"
(
  cd "$WIN/tray-launcher"
  GOOS=windows GOARCH=amd64 CGO_ENABLED=0 "$GO_BIN" build \
    -ldflags="-s -w -H windowsgui" \
    -o "$STAGING/HanyeMonitorControl.exe" .
)

find "$STAGING" -name '.DS_Store' -delete

if [ "$STAGING_ONLY" -eq 1 ]; then
  echo "OK: staging 已就绪 $STAGING"
  ls -lh "$STAGING/HanyeMonitorControl.exe"
  exit 0
fi

echo "==> 打包 staging.zip 并编译安装器 exe"
INSTALLER_GO="$WIN/installer-go"
rm -f "$INSTALLER_GO/staging.zip"
(
  cd "$STAGING"
  zip -qr "$INSTALLER_GO/staging.zip" .
)
printf '%s\n' "$VERSION" >"$INSTALLER_GO/version.txt"

(
  cd "$INSTALLER_GO"
  GOOS=windows GOARCH=amd64 CGO_ENABLED=0 "$GO_BIN" build \
    -ldflags="-s -w -H windowsgui" \
    -o "$OUT_DIR/$OUTFILE" .
)

ls -lh "$OUT_DIR/$OUTFILE"
echo "OK: $OUT_DIR/$OUTFILE"
echo "用户双击安装后，桌面图标打开控制面板：[启动] [重启] [关闭]，可收到托盘。"
