#!/usr/bin/env bash
# 同步推送到三个更新镜像：GitHub / Gitee / GitCode
# 开源已截止：最后开源版 4.3.3；其后版本不开源，勿推新版源码。一键包走 3dmn.cn（见 .cursor/rules/release-mirrors.mdc）。
# 用法：./ops/scripts/push-all-mirrors.sh [branch]
# 默认推送当前分支；加 --tags 时一并推送标签。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
BRANCH="${1:-$(git rev-parse --abbrev-ref HEAD)}"
WITH_TAGS="${WITH_TAGS:-1}"

need_remote() {
  local name="$1" url="$2"
  if git remote get-url "$name" >/dev/null 2>&1; then
    git remote set-url "$name" "$url"
  else
    git remote add "$name" "$url"
  fi
}

need_remote origin  "https://github.com/hanye1993/3DPrinterFleetControlWebInterface.git"
need_remote gitee   "https://gitee.com/hanye11/3DPrinterFleetControlWebInterface.git"
need_remote gitcode "https://gitcode.com/hanye6666/3DPrinterFleetControlWebInterface.git"

push_one() {
  local name="$1"
  echo "=== push $name ($BRANCH) ==="
  if [ "$WITH_TAGS" = "1" ]; then
    git push "$name" "$BRANCH" --tags
  else
    git push "$name" "$BRANCH"
  fi
}

ok=0
fail=0
for r in origin gitee gitcode; do
  if push_one "$r"; then
    ok=$((ok + 1))
  else
    echo "[warn] $r 推送失败（检查网络或登录凭证）"
    fail=$((fail + 1))
  fi
done

echo "完成：成功 ${ok}，失败 ${fail}"
[ "${fail}" -eq 0 ]
