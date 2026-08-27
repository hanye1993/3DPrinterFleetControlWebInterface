#!/usr/bin/env bash
# 打包飞牛 fnOS 原生应用（Node 直装，无 Docker）
# 产出：hanye-printer-monitor-<version>-x86.fpk / hanye-printer-monitor-<version>-arm.fpk
# 用法：npm run pack:fnos
#       FPK_ARCH=arm bash ops/scripts/pack-fnos-fpk.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PKG="$ROOT/packages-src/fnos/hanye-printer-monitor"
SERVER="$PKG/app/server"
OUT_DIR="$ROOT/packages"
mkdir -p "$OUT_DIR"
VERSION="$(node -p "require('$ROOT/package.json').version")"

need() { command -v "$1" >/dev/null 2>&1 || { echo "缺少命令: $1" >&2; exit 1; }; }
need rsync
need node
need npm

resolve_fnpack() {
  if [ -n "${FNPACK:-}" ]; then
    FNPACK_BIN="$FNPACK"
    return 0
  fi
  if command -v fnpack >/dev/null 2>&1; then
    FNPACK_BIN="$(command -v fnpack)"
    return 0
  elif [ -x /tmp/fnpack ]; then
    FNPACK_BIN=/tmp/fnpack
    return 0
  fi
  ARCH="$(uname -m)"
  OS="$(uname -s)"
  case "$OS-$ARCH" in
    Darwin-arm64) URL="https://static2.fnnas.com/fnpack/fnpack-1.2.3-darwin-arm64" ;;
    Darwin-x86_64) URL="https://static2.fnnas.com/fnpack/fnpack-1.2.3-darwin-amd64" ;;
    Linux-aarch64) URL="https://static2.fnnas.com/fnpack/fnpack-1.2.3-linux-arm64" ;;
    Linux-x86_64) URL="https://static2.fnnas.com/fnpack/fnpack-1.2.3-linux-amd64" ;;
    *) echo "请设置 FNPACK=... 指向 fnpack 可执行文件" >&2; return 1 ;;
  esac
  echo "下载 fnpack: $URL"
  curl -fsSL -o /tmp/fnpack "$URL"
  chmod +x /tmp/fnpack
  FNPACK_BIN=/tmp/fnpack
}

build_fpk_arch() {
  local FPK_ARCH="$1"
  local NPM_ARCH NPM_PLATFORM PLATFORM_SUFFIX DEST

  case "$FPK_ARCH" in
    x86|x86_64|amd64)
      FPK_ARCH=x86
      NPM_ARCH=x64
      NPM_PLATFORM=linux
      ;;
    arm|arm64|aarch64)
      FPK_ARCH=arm
      NPM_ARCH=arm64
      NPM_PLATFORM=linux
      ;;
    *)
      echo "不支持的 FPK_ARCH: $FPK_ARCH（用 x86 或 arm）" >&2
      return 1
      ;;
  esac

  echo ""
  echo "========== fnOS ${FPK_ARCH} =========="

  echo "==> 同步版本: $VERSION platform: $FPK_ARCH"
  if sed --version >/dev/null 2>&1; then
    sed -i "s/^version=.*/version=$VERSION/" "$PKG/manifest"
    sed -i "s/^platform=.*/platform=$FPK_ARCH/" "$PKG/manifest"
  else
    sed -i '' "s/^version=.*/version=$VERSION/" "$PKG/manifest"
    sed -i '' "s/^platform=.*/platform=$FPK_ARCH/" "$PKG/manifest"
  fi

  echo "==> 构建主程序"
  (
    cd "$ROOT"
    npm run build
  )

  echo "==> 准备 app/server（linux ${NPM_ARCH} 依赖）"
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
    # 必须强制目标为 linux，否则在 macOS 上打包会带上 darwin 原生二进制，飞牛上会秒退
    export npm_config_platform="$NPM_PLATFORM"
    export npm_config_arch="$NPM_ARCH"
    export npm_config_target_platform="$NPM_PLATFORM"
    export npm_config_target_arch="$NPM_ARCH"
    npm ci --omit=dev --os="$NPM_PLATFORM" --cpu="$NPM_ARCH"
  )

  # 校验关键可选原生包平台（esbuild）；缺失则显式补装
  local ESBUILD_PKG="@esbuild/${NPM_PLATFORM}-${NPM_ARCH}"
  if [ ! -d "$SERVER/node_modules/@esbuild/${NPM_PLATFORM}-${NPM_ARCH}" ]; then
    echo "==> 补装 $ESBUILD_PKG"
    (
      cd "$SERVER"
      export npm_config_platform="$NPM_PLATFORM"
      export npm_config_arch="$NPM_ARCH"
      npm install --omit=dev --os="$NPM_PLATFORM" --cpu="$NPM_ARCH" "$ESBUILD_PKG@*"
    )
  fi
  if [ -d "$SERVER/node_modules/@esbuild/darwin-arm64" ] || [ -d "$SERVER/node_modules/@esbuild/darwin-x64" ]; then
    echo "警告：node_modules 仍含 darwin esbuild，正在清理…" >&2
    rm -rf "$SERVER/node_modules/@esbuild/darwin-arm64" "$SERVER/node_modules/@esbuild/darwin-x64"
  fi

  if [ ! -f "$SERVER/dist/server/server/nodeServer.js" ]; then
    echo "构建失败：缺少 dist/server/server/nodeServer.js" >&2
    return 1
  fi

  rm -rf "$PKG/app/docker"
  rm -f "$PKG/wizard/upgrade"
  find "$PKG" -name '.DS_Store' -delete

  echo "==> 赋权生命周期脚本"
  chmod +x "$PKG"/cmd/*

  rm -f "$PKG"/*.fpk

  echo "==> fnpack build"
  (
    cd "$PKG"
    "$FNPACK_BIN" build
  )

  FPK="$(ls -1t "$PKG"/*.fpk 2>/dev/null | head -1 || true)"
  if [ -z "$FPK" ]; then
    echo "未找到生成的 .fpk" >&2
    return 1
  fi

  DEST="$OUT_DIR/fnos-${VERSION}-${FPK_ARCH}.fpk"
  cp -f "$FPK" "$DEST"
  ls -lh "$DEST"
  echo "OK: $DEST (Node 原生直装，无 Docker)"
}

if ! resolve_fnpack; then
  exit 1
fi

FPK_ARCH="${FPK_ARCH:-all}"
case "$FPK_ARCH" in
  all)
    build_fpk_arch x86
    build_fpk_arch arm
    ;;
  x86|x86_64|amd64)
    build_fpk_arch x86
    ;;
  arm|arm64|aarch64)
    build_fpk_arch arm
    ;;
  *)
    echo "FPK_ARCH 无效: $FPK_ARCH" >&2
    exit 1
    ;;
esac
