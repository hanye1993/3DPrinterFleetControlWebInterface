#!/usr/bin/env bash
# Linux 一键安装包（内置 Node.js + systemd，无需用户另装依赖）
# 产出：
#   hanyemonitor-<version>-ubuntu-amd64.deb / hanyemonitor-<version>-debian-amd64.deb
#   hanyemonitor-<version>-centos-amd64.rpm
#   （arm64 架构同理）
# 用法：npm run pack:linux
#       LINUX_ARCH=amd64 bash ops/scripts/pack-linux-installer.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LINUX="$ROOT/packages-src/linux"
RES="$LINUX/resources"
OUT_DIR="$ROOT/packages"
mkdir -p "$OUT_DIR"
VERSION="$(node -p "require('$ROOT/package.json').version")"
NODE_VERSION="${NODE_VERSION:-20.18.1}"
CACHE="$LINUX/cache"
NFPM_VERSION="${NFPM_VERSION:-2.47.0}"

need() { command -v "$1" >/dev/null 2>&1 || { echo "缺少命令: $1" >&2; exit 1; }; }
need node
need npm
need curl
need rsync
need tar

resolve_nfpm() {
  if [ -n "${NFPM:-}" ] && [ -x "$NFPM" ]; then
    NFPM_BIN="$NFPM"
    return 0
  fi
  if command -v nfpm >/dev/null 2>&1; then
    NFPM_BIN="$(command -v nfpm)"
    return 0
  fi
  local OS_RAW ARCH_RAW OS_NFPM NFPM_ARCH NFPM_TAR URL
  OS_RAW="$(uname -s)"
  ARCH_RAW="$(uname -m)"
  case "$OS_RAW" in
    Darwin) OS_NFPM=Darwin ;;
    Linux) OS_NFPM=Linux ;;
    *) echo "无法自动下载 nfpm，请设置 NFPM=路径" >&2; return 1 ;;
  esac
  case "$ARCH_RAW" in
    arm64|aarch64) NFPM_ARCH=arm64 ;;
    x86_64|amd64) NFPM_ARCH=x86_64 ;;
    *) echo "无法自动下载 nfpm，请设置 NFPM=路径" >&2; return 1 ;;
  esac
  NFPM_TAR="nfpm_${NFPM_VERSION}_${OS_NFPM}_${NFPM_ARCH}.tar.gz"
  URL="https://github.com/goreleaser/nfpm/releases/download/v${NFPM_VERSION}/${NFPM_TAR}"
  mkdir -p "$CACHE"
  if [ ! -f "$CACHE/$NFPM_TAR" ]; then
    echo "下载 nfpm: $URL"
    local ok=0 u
    for u in \
      "$URL" \
      "https://ghfast.top/${URL}" \
      "https://mirror.ghproxy.com/${URL}"; do
      if curl -fsSL --connect-timeout 20 --max-time 180 -o "$CACHE/$NFPM_TAR" "$u"; then
        ok=1
        break
      fi
      rm -f "$CACHE/$NFPM_TAR"
    done
    if [ "$ok" -eq 0 ]; then
      echo "nfpm 下载失败，将尝试手动打 .deb（.rpm 需 nfpm）" >&2
      return 1
    fi
  fi
  rm -rf "$CACHE/nfpm-extract"
  mkdir -p "$CACHE/nfpm-extract"
  tar -xzf "$CACHE/$NFPM_TAR" -C "$CACHE/nfpm-extract"
  NFPM_BIN="$(find "$CACHE/nfpm-extract" -name nfpm -type f | head -1)"
  if [ -z "$NFPM_BIN" ] || [ ! -x "$NFPM_BIN" ]; then
    echo "nfpm 解压失败" >&2
    return 1
  fi
}

build_deb_manual() {
  local NFPM_ARCH="$1"
  local WORK_DEB="$2"
  local DEB_OUT="$3"
  local STAGING_SRC="$4"
  local ROOTFS="$WORK_DEB/root"
  local DEBIAN="$WORK_DEB/DEBIAN"
  local AR_DIR="$WORK_DEB/ar"
  local INSTALLED_KB

  rm -rf "$WORK_DEB"
  mkdir -p "$ROOTFS/opt/hanye-printer-monitor" "$ROOTFS/lib/systemd/system" "$DEBIAN"

  rsync -a "$STAGING_SRC/" "$ROOTFS/opt/hanye-printer-monitor/"
  cp "$RES/hanyemonitor.service" "$ROOTFS/lib/systemd/system/hanyemonitor.service"

  INSTALLED_KB="$(du -sk "$ROOTFS" | awk '{print $1}')"
  cat >"$DEBIAN/control" <<EOF
Package: hanyemonitor
Version: ${VERSION}
Architecture: ${NFPM_ARCH}
Maintainer: hanye
Section: utils
Priority: optional
Depends: systemd
Installed-Size: ${INSTALLED_KB}
Description: hanye 3D Printer Monitor
 Embedded Node.js web console. http://127.0.0.1:17890 admin/admin123
EOF

  cp "$RES/postinst.sh" "$DEBIAN/postinst"
  cp "$RES/prerm.sh" "$DEBIAN/prerm"
  cp "$RES/postrm.sh" "$DEBIAN/postrm"
  chmod 755 "$DEBIAN/postinst" "$DEBIAN/prerm" "$DEBIAN/postrm"

  if command -v dpkg-deb >/dev/null 2>&1; then
    dpkg-deb --root-owner-group -Zgzip -b "$WORK_DEB" "$DEB_OUT"
    return 0
  fi

  mkdir -p "$AR_DIR"
  printf '2.0\n' >"$AR_DIR/debian-binary"
  tar --owner=0 --group=0 -czf "$AR_DIR/data.tar.gz" -C "$ROOTFS" .
  tar --owner=0 --group=0 -czf "$AR_DIR/control.tar.gz" -C "$DEBIAN" .
  rm -f "$DEB_OUT"
  ar rcs "$DEB_OUT" "$AR_DIR/debian-binary" "$AR_DIR/control.tar.gz" "$AR_DIR/data.tar.gz"
}

build_linux_arch() {
  local ARCH="$1"
  local NPM_ARCH NODE_ARCH NODE_TAR NODE_URL STAGING NFPM_YAML WORK

  case "$ARCH" in
    arm64|aarch64)
      NPM_ARCH=arm64
      NODE_ARCH=arm64
      NFPM_ARCH=arm64
      ;;
    amd64|x64|x86_64)
      NPM_ARCH=x64
      NODE_ARCH=x64
      NFPM_ARCH=amd64
      ;;
    *)
      echo "不支持的 LINUX_ARCH: $ARCH" >&2
      return 1
      ;;
  esac

  STAGING="$LINUX/staging-${NODE_ARCH}"
  WORK="$LINUX/nfpm-work-${NODE_ARCH}"
  NFPM_YAML="$WORK/nfpm.yaml"

  echo ""
  echo "========== Linux ${NFPM_ARCH} =========="

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

    echo "==> 准备 app（linux ${NPM_ARCH}）"
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
      npm ci --omit=dev --platform=linux --arch="$NPM_ARCH"
    )

    if [ ! -f "$STAGING/app/dist/server/server/nodeServer.js" ]; then
      echo "构建失败：缺少 nodeServer.js" >&2
      return 1
    fi
  fi

  NODE_TAR="node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz"
  NODE_URL="https://nodejs.org/dist/v${NODE_VERSION}/${NODE_TAR}"

  if [ ! -f "$STAGING/node/bin/node" ]; then
    echo "==> 下载 Node.js ${NODE_VERSION} linux-${NODE_ARCH}"
    if [ ! -f "$CACHE/$NODE_TAR" ]; then
      curl -fsSL -o "$CACHE/$NODE_TAR" "$NODE_URL"
    fi
    rm -rf "$CACHE/node-extract-${NODE_ARCH}"
    mkdir -p "$CACHE/node-extract-${NODE_ARCH}"
    tar -xJf "$CACHE/$NODE_TAR" -C "$CACHE/node-extract-${NODE_ARCH}"
    NODE_DIR="$(find "$CACHE/node-extract-${NODE_ARCH}" -maxdepth 1 -type d -name 'node-v*' | head -1)"
    mkdir -p "$STAGING/node"
    rsync -a \
      --exclude 'node_modules/npm' \
      --exclude 'node_modules/corepack' \
      "$NODE_DIR/" "$STAGING/node/"
  fi

  cp "$RES/app.env.example" "$STAGING/"
  cp "$RES/start-hanyemonitor.sh" "$STAGING/"
  cp "$RES/stop-hanyemonitor.sh" "$STAGING/"
  chmod +x "$STAGING/start-hanyemonitor.sh" "$STAGING/stop-hanyemonitor.sh"
  find "$STAGING" -name '.DS_Store' -delete

  rm -rf "$WORK"
  mkdir -p "$WORK"

  cat >"$NFPM_YAML" <<EOF
name: hanyemonitor
arch: ${NFPM_ARCH}
platform: linux
version: "${VERSION}"
section: utils
priority: optional
maintainer: "hanye"
description: |-
  hanye 3D Printer Monitor — web console, embedded Node.js, no Docker.
  Open http://127.0.0.1:17890 — default admin / admin123
vendor: hanye
homepage: https://example.com
license: MIT
contents:
  - src: ${STAGING}
    dst: /opt/hanye-printer-monitor
    type: tree
  - src: ${RES}/hanyemonitor.service
    dst: /lib/systemd/system/hanyemonitor.service
    type: file
overrides:
  deb:
    depends:
      - systemd
  rpm:
    depends:
      - systemd
scripts:
  postinstall: ${RES}/postinst.sh
  preremove: ${RES}/prerm.sh
  postremove: ${RES}/postrm.sh
EOF

  DEB_UBUNTU="$OUT_DIR/ubuntu-${VERSION}-${NFPM_ARCH}.deb"
  DEB_DEBIAN="$OUT_DIR/debian-${VERSION}-${NFPM_ARCH}.deb"
  RPM_CENTOS="$OUT_DIR/centos-${VERSION}-${NFPM_ARCH}.rpm"

  if [ -n "${NFPM_BIN:-}" ]; then
    echo "==> 生成 .deb（Ubuntu / Debian）via nfpm"
    (
      cd "$WORK"
      "$NFPM_BIN" package -f nfpm.yaml -p deb
    )
    DEB_BUILT="$(ls -1t "$WORK"/hanyemonitor_*.deb 2>/dev/null | head -1)"
    cp -f "$DEB_BUILT" "$DEB_UBUNTU"
    cp -f "$DEB_BUILT" "$DEB_DEBIAN"

    echo "==> 生成 .rpm（CentOS / RHEL）via nfpm"
    (
      cd "$WORK"
      "$NFPM_BIN" package -f nfpm.yaml -p rpm
    )
    RPM_BUILT="$(ls -1t "$WORK"/hanyemonitor*.rpm 2>/dev/null | head -1)"
    if [ -z "$RPM_BUILT" ] || [ ! -f "$RPM_BUILT" ]; then
      echo "未找到生成的 .rpm" >&2
      return 1
    fi
    cp -f "$RPM_BUILT" "$RPM_CENTOS"
  else
    echo "==> 生成 .deb（Ubuntu / Debian）手动打包"
    build_deb_manual "$NFPM_ARCH" "$WORK/deb-build" "$DEB_UBUNTU" "$STAGING"
    cp -f "$DEB_UBUNTU" "$DEB_DEBIAN"
    echo "跳过 .rpm：未找到 nfpm，请稍后重试 npm run pack:linux 或设置 NFPM=路径" >&2
  fi

  ls -lh "$DEB_UBUNTU"
  echo "OK: $DEB_UBUNTU"
  if [ -f "$RPM_CENTOS" ]; then
    ls -lh "$RPM_CENTOS"
    echo "OK: $RPM_CENTOS"
  fi
}

NFPM_BIN=""
if resolve_nfpm; then
  :
else
  NFPM_BIN=""
fi

LINUX_ARCH="${LINUX_ARCH:-all}"
case "$LINUX_ARCH" in
  all)
    build_linux_arch amd64
    build_linux_arch arm64
    ;;
  amd64|x64|x86_64)
    build_linux_arch amd64
    ;;
  arm64|aarch64)
    build_linux_arch arm64
    ;;
  *)
    echo "LINUX_ARCH 无效: $LINUX_ARCH" >&2
    exit 1
    ;;
esac
