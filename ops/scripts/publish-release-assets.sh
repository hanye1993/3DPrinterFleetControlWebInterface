#!/usr/bin/env bash
# 上传 v4.2.0 一键安装包 + installer-src 到 GitHub / Gitee / GitCode Releases
# 用法：
#   export GITHUB_TOKEN=...   # github.com → Settings → Developer settings → PAT (repo)
#   export GITEE_TOKEN=...      # gitee.com → 设置 → 私人令牌 (projects)
#   export GITCODE_TOKEN=...   # gitcode.com → 设置 → 私人令牌
#   bash ops/scripts/publish-release-assets.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PKG="$ROOT/packages"
VERSION="$(node -p "require('$ROOT/package.json').version")"
TAG="v${VERSION}"
REPO="3DPrinterFleetControlWebInterface"

need() { command -v "$1" >/dev/null 2>&1 || { echo "缺少: $1" >&2; exit 1; }; }
need node
need curl
need git

ASSETS=(
  "windows-${VERSION}-amd64.exe"
  "macos-${VERSION}-arm64.dmg"
  "macos-${VERSION}-amd64.dmg"
  "ubuntu-${VERSION}-amd64.deb"
  "ubuntu-${VERSION}-arm64.deb"
  "debian-${VERSION}-amd64.deb"
  "debian-${VERSION}-arm64.deb"
  "centos-${VERSION}-amd64.rpm"
  "centos-${VERSION}-arm64.rpm"
  "fnos-${VERSION}-x86.fpk"
  "fnos-${VERSION}-arm.fpk"
  "syno-${VERSION}-x86_64.spk"
  "syno-${VERSION}-aarch64.spk"
  "installer-src-${VERSION}.zip"
)

for f in "${ASSETS[@]}"; do
  if [ ! -f "$PKG/$f" ]; then
    echo "缺少安装包: $PKG/$f" >&2
    exit 1
  fi
done

NOTES="$(cat <<EOF
hanye 3D 打印机监控台 ${VERSION}

## 一键安装包
- Windows / macOS / Linux / 飞牛 fpk / 群晖 spk
- installer-src-${VERSION}.zip：各平台安装包打包源码

默认端口 17890，账号 admin / admin123（请立刻改密）。
EOF
)"

upload_github() {
  local token="$1"
  echo "=== GitHub Release ${TAG} ==="
  local api="https://api.github.com/repos/hanye1993/${REPO}/releases"
  local rel_id
  rel_id="$(curl -fsSL -H "Authorization: Bearer ${token}" -H "Accept: application/vnd.github+json" \
    "${api}/tags/${TAG}" 2>/dev/null | node -p "try{JSON.parse(require('fs').readFileSync(0,'utf8')).id}catch(e){''}")"
  if [ -z "$rel_id" ]; then
    rel_id="$(curl -fsSL -X POST -H "Authorization: Bearer ${token}" -H "Accept: application/vnd.github+json" \
      -d "$(node -e "console.log(JSON.stringify({tag_name:'${TAG}',name:'${TAG}',body:process.argv[1],draft:false,prerelease:false}))" "$NOTES")" \
      "$api" | node -p "JSON.parse(require('fs').readFileSync(0,'utf8')).id")"
  fi
  echo "release id: $rel_id"
  for f in "${ASSETS[@]}"; do
    echo "  upload $f"
    curl -fsSL -X POST \
      -H "Authorization: Bearer ${token}" \
      -H "Accept: application/vnd.github+json" \
      -H "Content-Type: application/octet-stream" \
      --data-binary @"$PKG/$f" \
      "https://uploads.github.com/repos/hanye1993/${REPO}/releases/${rel_id}/assets?name=${f}" >/dev/null
  done
  echo "OK GitHub: https://github.com/hanye1993/${REPO}/releases/tag/${TAG}"
}

upload_gitee_like() {
  local platform="$1" owner="$2" token="$3"
  local base
  case "$platform" in
    gitee) base="https://gitee.com/api/v5" ;;
    gitcode) base="https://gitcode.com/api/v5" ;;
    *) return 1 ;;
  esac
  echo "=== ${platform} Release ${TAG} ==="
  local rel_id
  rel_id="$(curl -fsSL "${base}/repos/${owner}/${REPO}/releases/tags/${TAG}?access_token=${token}" 2>/dev/null \
    | node -p "try{JSON.parse(require('fs').readFileSync(0,'utf8')).id}catch(e){''}" || true)"
  if [ -z "$rel_id" ]; then
    rel_id="$(curl -fsSL -X POST "${base}/repos/${owner}/${REPO}/releases?access_token=${token}" \
      -d "tag_name=${TAG}&name=${TAG}&body=$(printf '%s' "$NOTES" | sed 's/$/\\n/' | tr -d '\n')" \
      | node -p "JSON.parse(require('fs').readFileSync(0,'utf8')).id")"
  fi
  echo "release id: $rel_id"
  for f in "${ASSETS[@]}"; do
    echo "  upload $f"
    curl -fsSL -X POST "${base}/repos/${owner}/${REPO}/releases/${rel_id}/attach_files?access_token=${token}" \
      -F "file=@${PKG}/${f}" >/dev/null
  done
  case "$platform" in
    gitee) echo "OK Gitee: https://gitee.com/${owner}/${REPO}/releases/tag/${TAG}" ;;
    gitcode) echo "OK GitCode: https://gitcode.com/${owner}/${REPO}/releases/tag/${TAG}" ;;
  esac
}

ok=0
fail=0

if [ -n "${GITHUB_TOKEN:-}" ]; then
  upload_github "$GITHUB_TOKEN" && ok=$((ok+1)) || { echo "[warn] GitHub 上传失败" >&2; fail=$((fail+1)); }
else
  echo "[skip] GitHub：未设置 GITHUB_TOKEN"
  fail=$((fail+1))
fi

if [ -n "${GITEE_TOKEN:-}" ]; then
  upload_gitee_like gitee hanye11 "$GITEE_TOKEN" && ok=$((ok+1)) || { echo "[warn] Gitee 上传失败" >&2; fail=$((fail+1)); }
else
  echo "[skip] Gitee：未设置 GITEE_TOKEN"
  fail=$((fail+1))
fi

if [ -n "${GITCODE_TOKEN:-}" ]; then
  upload_gitee_like gitcode hanye6666 "$GITCODE_TOKEN" && ok=$((ok+1)) || { echo "[warn] GitCode 上传失败" >&2; fail=$((fail+1)); }
else
  echo "[skip] GitCode：未设置 GITCODE_TOKEN"
  fail=$((fail+1))
fi

echo "完成：成功 ${ok}，跳过/失败 ${fail}"
[ "$ok" -gt 0 ]
