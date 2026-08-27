#!/usr/bin/env bash
# 上传 v4.2.0 一键安装包 + installer-src 到 GitHub / Gitee / GitCode Releases
# 用法：
#   export GITHUB_TOKEN=... GITEE_TOKEN=... GITCODE_TOKEN=...
#   bash ops/scripts/publish-release-assets.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PKG="$ROOT/packages"
VERSION="$(node -p "require('$ROOT/package.json').version")"
TAG="v${VERSION}"
REPO="3DPrinterFleetControlWebInterface"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

need() { command -v "$1" >/dev/null 2>&1 || { echo "缺少: $1" >&2; exit 1; }; }
need node
need curl

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
  [ -f "$PKG/$f" ] || { echo "缺少: $PKG/$f" >&2; exit 1; }
done

NOTES="hanye 3D 打印机监控台 ${VERSION}

一键安装包：Windows / macOS / Linux / 飞牛 fpk / 群晖 spk
installer-src-${VERSION}.zip：各平台安装包打包源码

默认端口 17890，账号 admin / admin123（请立刻改密）。"

curl_json() {
  curl -fsSL "$@"
}

github_release_id() {
  local token="$1"
  curl_json -H "Authorization: Bearer ${token}" \
    -H "Accept: application/vnd.github+json" \
    "https://api.github.com/repos/hanye1993/${REPO}/releases/tags/${TAG}" \
    | node -p "try{String(JSON.parse(require('fs').readFileSync(0,'utf8')).id||'')}catch(e){''}"
}

upload_github() {
  local token="$1"
  echo "=== GitHub ${TAG} ==="
  local rel_id
  rel_id="$(github_release_id "$token" || true)"
  if [ -z "$rel_id" ]; then
    node -e "
const fs=require('fs');
fs.writeFileSync('$TMP/gh-release.json', JSON.stringify({
  tag_name:'$TAG', name:'$TAG', body:process.argv[1], draft:false, prerelease:false
}));
" "$NOTES"
    rel_id="$(curl_json -X POST \
      -H "Authorization: Bearer ${token}" \
      -H "Accept: application/vnd.github+json" \
      -H "Content-Type: application/json" \
      -d @"$TMP/gh-release.json" \
      "https://api.github.com/repos/hanye1993/${REPO}/releases" \
      | node -p "JSON.parse(require('fs').readFileSync(0,'utf8')).id")"
  fi
  echo "release id: $rel_id"
  for f in "${ASSETS[@]}"; do
    echo "  upload $f"
    # 删除同名旧附件
    curl_json -H "Authorization: Bearer ${token}" \
      -H "Accept: application/vnd.github+json" \
      "https://api.github.com/repos/hanye1993/${REPO}/releases/${rel_id}/assets" \
      | node -e "
const fs=require('fs'); const name='$f'; const token='$token'; const id='$rel_id';
const assets=JSON.parse(fs.readFileSync(0,'utf8'));
for (const a of assets) { if (a.name===name) console.log(a.id); }
" | while read -r aid; do
      [ -n "$aid" ] && curl_json -X DELETE \
        -H "Authorization: Bearer ${token}" \
        -H "Accept: application/vnd.github+json" \
        "https://api.github.com/repos/hanye1993/${REPO}/releases/assets/${aid}" || true
    done
    curl_json -X POST \
      -H "Authorization: Bearer ${token}" \
      -H "Accept: application/vnd.github+json" \
      -H "Content-Type: application/octet-stream" \
      --data-binary @"$PKG/$f" \
      "https://uploads.github.com/repos/hanye1993/${REPO}/releases/${rel_id}/assets?name=${f}" >/dev/null
  done
  echo "OK https://github.com/hanye1993/${REPO}/releases/tag/${TAG}"
}

gitee_release_id() {
  local base="$1" owner="$2" token="$3"
  curl_json "${base}/repos/${owner}/${REPO}/releases/tags/${TAG}?access_token=${token}" 2>/dev/null \
    | node -p "try{String(JSON.parse(require('fs').readFileSync(0,'utf8')).id||'')}catch(e){''}" || true
}

upload_gitee_like() {
  local platform="$1" owner="$2" token="$3"
  local base web
  case "$platform" in
    gitee) base="https://gitee.com/api/v5"; web="https://gitee.com/${owner}/${REPO}/releases/tag/${TAG}" ;;
    gitcode) base="https://gitcode.com/api/v5"; web="https://gitcode.com/${owner}/${REPO}/releases/tag/${TAG}" ;;
    *) return 1 ;;
  esac
  echo "=== ${platform} ${TAG} ==="
  local rel_id
  rel_id="$(gitee_release_id "$base" "$owner" "$token")"
  if [ -z "$rel_id" ]; then
    rel_id="$(curl -fsSL -X POST "${base}/repos/${owner}/${REPO}/releases?access_token=${token}" \
      --data-urlencode "tag_name=${TAG}" \
      --data-urlencode "name=${TAG}" \
      --data-urlencode "body=${NOTES}" \
      | node -p "JSON.parse(require('fs').readFileSync(0,'utf8')).id")"
  fi
  echo "release id: $rel_id"
  for f in "${ASSETS[@]}"; do
    echo "  upload $f ($(du -h "$PKG/$f" | awk '{print $1}'))"
    curl -fsSL -X POST "${base}/repos/${owner}/${REPO}/releases/${rel_id}/attach_files?access_token=${token}" \
      -F "file=@${PKG}/${f}" >/dev/null
  done
  echo "OK ${web}"
}

ok=0
fail=0

if [ -n "${GITHUB_TOKEN:-}" ]; then
  if upload_github "$GITHUB_TOKEN"; then ok=$((ok+1)); else echo "[fail] GitHub" >&2; fail=$((fail+1)); fi
else
  echo "[skip] GITHUB_TOKEN 未设置"; fail=$((fail+1))
fi

if [ -n "${GITEE_TOKEN:-}" ]; then
  if upload_gitee_like gitee hanye11 "$GITEE_TOKEN"; then ok=$((ok+1)); else echo "[fail] Gitee" >&2; fail=$((fail+1)); fi
else
  echo "[skip] GITEE_TOKEN 未设置"; fail=$((fail+1))
fi

if [ -n "${GITCODE_TOKEN:-}" ]; then
  if upload_gitee_like gitcode hanye6666 "$GITCODE_TOKEN"; then ok=$((ok+1)); else echo "[fail] GitCode" >&2; fail=$((fail+1)); fi
else
  echo "[skip] GITCODE_TOKEN 未设置"; fail=$((fail+1))
fi

echo "完成：成功 ${ok}，失败/跳过 ${fail}"
[ "$ok" -gt 0 ]
