#!/usr/bin/env bash
# macOS 一键安装包（内置 Node.js + launchd，无需用户另装依赖）
# 产出：packages/macos-<version>-arm64.dmg / packages/macos-<version>-amd64.dmg
# 用法：npm run pack:mac
#       MAC_ARCH=arm64 bash ops/scripts/pack-mac-installer.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MAC="$ROOT/packages-src/mac"
RES="$MAC/resources"
OUT_DIR="$ROOT/packages"
mkdir -p "$OUT_DIR"
VERSION="$(node -p "require('$ROOT/package.json').version")"
NODE_VERSION="${NODE_VERSION:-20.18.1}"
CACHE="$MAC/cache"
OUTFILE_PREFIX="macos-${VERSION}"

need() { command -v "$1" >/dev/null 2>&1 || { echo "缺少命令: $1" >&2; exit 1; }; }
need node
need npm
need curl
need rsync
need tar

build_mac_arch() {
  local ARCH="$1"
  local NPM_ARCH NODE_ARCH NODE_TAR NODE_URL STAGING APP_FOLDER DMG_WORK DMG_NAME

  case "$ARCH" in
    arm64)
      NPM_ARCH=arm64
      NODE_ARCH=arm64
      ;;
    x64|x86_64|amd64)
      NPM_ARCH=x64
      NODE_ARCH=x64
      ;;
    *)
      echo "不支持的 MAC_ARCH: $ARCH（用 arm64 或 x64）" >&2
      return 1
      ;;
  esac

  STAGING="$MAC/staging-${NODE_ARCH}"
  APP_FOLDER="hanye Printer Monitor"
  DMG_WORK="$MAC/dmg-${NODE_ARCH}"
  local CHIP_LABEL="$NODE_ARCH"
  [ "$CHIP_LABEL" = x64 ] && CHIP_LABEL=amd64
  DMG_NAME="macos-${VERSION}-${CHIP_LABEL}.dmg"

  echo ""
  echo "========== macOS ${NODE_ARCH} =========="

  if [ -d "$STAGING/node" ] && [ -f "$STAGING/app/dist/server/server/nodeServer.js" ]; then
    echo "==> 复用 staging $STAGING"
  else
    rm -rf "$STAGING"
    mkdir -p "$STAGING/app" "$CACHE"

    echo "==> 构建主程序"
    (
      cd "$ROOT"
      npm run build
    )

    echo "==> 准备 app（darwin ${NPM_ARCH}）"
    rsync -a "$ROOT/dist/" "$STAGING/app/dist/"
    rsync -a \
      --exclude 'examples/plugin-orca-web' \
      --exclude 'examples/plugin-app-launcher' \
      --exclude 'examples/plugin-card-model-portrait' \
      "$ROOT/assets/" "$STAGING/app/assets/"
    rsync -a "$ROOT/ops/sql/" "$STAGING/app/ops/sql/" 2>/dev/null || mkdir -p "$STAGING/app/ops/sql"
    cp "$ROOT/package.json" "$ROOT/package-lock.json" "$STAGING/app/"

    (
      cd "$STAGING/app"
      npm config set registry https://registry.npmmirror.com
      npm ci --omit=dev --platform=darwin --arch="$NPM_ARCH"
    )

    if [ ! -f "$STAGING/app/dist/server/server/nodeServer.js" ]; then
      echo "构建失败：缺少 nodeServer.js" >&2
      return 1
    fi
  fi

  NODE_TAR="node-v${NODE_VERSION}-darwin-${NODE_ARCH}.tar.gz"
  NODE_URL="https://nodejs.org/dist/v${NODE_VERSION}/${NODE_TAR}"

  if [ ! -f "$STAGING/node/bin/node" ]; then
    echo "==> 下载 Node.js ${NODE_VERSION} darwin-${NODE_ARCH}"
    if [ ! -f "$CACHE/$NODE_TAR" ]; then
      curl -fsSL -o "$CACHE/$NODE_TAR" "$NODE_URL"
    fi
    rm -rf "$CACHE/node-extract-${NODE_ARCH}"
    mkdir -p "$CACHE/node-extract-${NODE_ARCH}"
    tar -xzf "$CACHE/$NODE_TAR" -C "$CACHE/node-extract-${NODE_ARCH}"
    NODE_DIR="$(find "$CACHE/node-extract-${NODE_ARCH}" -maxdepth 1 -type d -name 'node-v*' | head -1)"
    mkdir -p "$STAGING/node"
    rsync -a \
      --exclude 'node_modules/npm' \
      --exclude 'node_modules/corepack' \
      "$NODE_DIR/" "$STAGING/node/"
  fi

  cp "$RES/start-hanyemonitor.sh" "$STAGING/"
  cp "$RES/stop-hanyemonitor.sh" "$STAGING/"
  cp "$RES/app.env.example" "$STAGING/"
  cp "$RES/com.hanye.hanyemonitor.plist" "$STAGING/"

  chmod +x "$STAGING/start-hanyemonitor.sh" "$STAGING/stop-hanyemonitor.sh"
  find "$STAGING" -name '.DS_Store' -delete

  rm -rf "$DMG_WORK"
  mkdir -p "$DMG_WORK"
  cp "$RES/install.command" "$DMG_WORK/"
  chmod +x "$DMG_WORK/install.command"
  cp -R "$STAGING" "$DMG_WORK/$APP_FOLDER"

  cat >"$DMG_WORK/README.txt" <<EOF
hanye Printer Monitor ${VERSION} (macOS ${NODE_ARCH})

1. 双击 install.command 完成安装
2. 浏览器打开 http://127.0.0.1:17890/
3. 默认账号 admin / admin123

程序目录: /Applications/hanye Printer Monitor
配置: app.env（网段 LAN_SCAN_SUBNETS=192.168.1）
日志: data/service.log
EOF

  echo "==> 生成 DMG"
  rm -f "$OUT_DIR/$DMG_NAME"
  hdiutil create \
    -volname "hanye Printer Monitor ${VERSION}" \
    -srcfolder "$DMG_WORK" \
    -ov \
    -format UDZO \
    "$OUT_DIR/$DMG_NAME"

  ls -lh "$OUT_DIR/$DMG_NAME"
  echo "OK: $OUT_DIR/$DMG_NAME"
}

MAC_ARCH="${MAC_ARCH:-all}"
case "$MAC_ARCH" in
  all)
    build_mac_arch arm64
    build_mac_arch x64
    ;;
  arm64|aarch64)
    build_mac_arch arm64
    ;;
  x64|x86_64|amd64)
    build_mac_arch x64
    ;;
  *)
    echo "MAC_ARCH 无效: $MAC_ARCH" >&2
    exit 1
    ;;
esac
