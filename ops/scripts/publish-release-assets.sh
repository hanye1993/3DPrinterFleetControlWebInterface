#!/usr/bin/env bash
# 三端 Release「初始化」：只创建/更新发行说明与标签对应的 Release，不上传一键安装包。
# 一键包仅本地 `npm run pack:*` 产出，不往 GitHub / Gitee / GitCode Release 挂附件。
#
# 发布流程（以后固定）：
#   1. 改 package.json 版本 + README / INSTALL 等 md
#   2. 提交源码，打 tag：vX.Y.Z
#   3. npm run push:mirrors   # 推 main + tags 到三仓库
#   4. npm run publish:release  # 仅初始化 Release 说明（无附件）
#
# 用法：
#   export GITHUB_TOKEN=... GITEE_TOKEN=... GITCODE_TOKEN=...
#   bash ops/scripts/publish-release-assets.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
VERSION="$(node -p "require('$ROOT/package.json').version")"
TAG="v${VERSION}"
REPO="3DPrinterFleetControlWebInterface"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

need() { command -v "$1" >/dev/null 2>&1 || { echo "缺少: $1" >&2; exit 1; }; }
need node
need curl

NOTES="hanye 3D 打印机监控台 ${VERSION}

本 Release 仅作版本标记与源码归档（平台自动附带的源码 zip/tar）。
一键安装包请本地构建：npm run pack:win / pack:mac / pack:linux / pack:fnos / pack:syno
产物在仓库 packages/ 目录，不上传到三端 Release。

默认端口 17890，账号 admin / admin123（请立刻改密）。"

ensure_github() {
  local token="$1"
  echo "=== GitHub ${TAG}（仅初始化，无附件）==="
  local exists
  exists="$(curl -fsSL --connect-timeout 20 --max-time 60 \
    -H "Authorization: Bearer ${token}" \
    -H "Accept: application/vnd.github+json" \
    "https://api.github.com/repos/hanye1993/${REPO}/releases/tags/${TAG}" \
    | node -p "try{String(JSON.parse(require('fs').readFileSync(0,'utf8')).id||'')}catch(e){''}" || true)"
  if [ -n "$exists" ]; then
    node -e "
const fs=require('fs');
fs.writeFileSync('$TMP/gh-patch.json', JSON.stringify({ name:'$TAG', body:process.argv[1] }));
" "$NOTES"
    curl -fsSL --connect-timeout 20 --max-time 60 -X PATCH \
      -H "Authorization: Bearer ${token}" \
      -H "Accept: application/vnd.github+json" \
      -H "Content-Type: application/json" \
      -d @"$TMP/gh-patch.json" \
      "https://api.github.com/repos/hanye1993/${REPO}/releases/${exists}" >/dev/null
    echo "updated release id: $exists"
  else
    node -e "
const fs=require('fs');
fs.writeFileSync('$TMP/gh-release.json', JSON.stringify({
  tag_name:'$TAG', name:'$TAG', body:process.argv[1], draft:false, prerelease:false
}));
" "$NOTES"
    curl -fsSL --connect-timeout 20 --max-time 60 -X POST \
      -H "Authorization: Bearer ${token}" \
      -H "Accept: application/vnd.github+json" \
      -H "Content-Type: application/json" \
      -d @"$TMP/gh-release.json" \
      "https://api.github.com/repos/hanye1993/${REPO}/releases" >/dev/null
    echo "created"
  fi
  echo "OK https://github.com/hanye1993/${REPO}/releases/tag/${TAG}"
}

ensure_gitee_like() {
  local platform="$1" owner="$2" token="$3"
  local base web
  case "$platform" in
    gitee) base="https://gitee.com/api/v5"; web="https://gitee.com/${owner}/${REPO}/releases/tag/${TAG}" ;;
    gitcode) base="https://gitcode.com/api/v5"; web="https://gitcode.com/${owner}/${REPO}/releases/tag/${TAG}" ;;
    *) echo "unknown platform $platform" >&2; return 1 ;;
  esac
  echo "=== ${platform} ${TAG}（仅初始化，无附件）==="
  local exists
  exists="$(curl -sS --connect-timeout 20 --max-time 60 \
    "${base}/repos/${owner}/${REPO}/releases/tags/${TAG}?access_token=${token}" \
    | node -p "try{String(JSON.parse(require('fs').readFileSync(0,'utf8')).id||'')}catch(e){''}" || true)"
  if [ -z "${exists}" ]; then
    if curl -sS --connect-timeout 20 --max-time 60 -X POST \
      "${base}/repos/${owner}/${REPO}/releases?access_token=${token}" \
      --data-urlencode "tag_name=${TAG}" \
      --data-urlencode "name=${TAG}" \
      --data-urlencode "body=${NOTES}" \
      --data-urlencode "target_commitish=main" >/dev/null; then
      echo "created"
    else
      echo "create skipped or already exists"
    fi
  else
    echo "already exists id: ${exists} (no asset upload)"
  fi
  echo "OK ${web}"
}

ok=0
fail=0

if [ -n "${GITHUB_TOKEN:-}" ]; then
  if ensure_github "$GITHUB_TOKEN"; then ok=$((ok+1)); else echo "[fail] GitHub" >&2; fail=$((fail+1)); fi
else
  echo "[skip] GITHUB_TOKEN unset"; fail=$((fail+1))
fi

if [ -n "${GITEE_TOKEN:-}" ]; then
  if ensure_gitee_like gitee hanye11 "$GITEE_TOKEN"; then ok=$((ok+1)); else echo "[fail] Gitee" >&2; fail=$((fail+1)); fi
else
  echo "[skip] GITEE_TOKEN unset"; fail=$((fail+1))
fi

if [ -n "${GITCODE_TOKEN:-}" ]; then
  if ensure_gitee_like gitcode hanye6666 "$GITCODE_TOKEN"; then ok=$((ok+1)); else echo "[fail] GitCode" >&2; fail=$((fail+1)); fi
else
  echo "[skip] GITCODE_TOKEN unset"; fail=$((fail+1))
fi

echo "done ok=${ok} fail_or_skip=${fail} (no installer packages uploaded)"
[ "${ok}" -gt 0 ]
