#!/usr/bin/env bash
# 将 packages-src/（各平台安装包源码）打成 zip，输出到 packages/
# 用法：npm run pack:installer-src
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
VERSION="$(node -p "require('$ROOT/package.json').version")"
SRC="$ROOT/packages-src"
ZIP_DIR="$ROOT/packages"
ZIP_NAME="installer-src-${VERSION}.zip"
ZIP_PATH="$ZIP_DIR/$ZIP_NAME"

if [ ! -d "$SRC" ]; then
  echo "缺少 $SRC" >&2
  exit 1
fi

mkdir -p "$ZIP_DIR"
rm -f "$ZIP_PATH"

# 排除构建缓存与临时产物
(
  cd "$ROOT"
  zip -r -q "$ZIP_PATH" packages-src \
    -x 'packages-src/**/.DS_Store' \
    -x 'packages-src/**/cache/**' \
    -x 'packages-src/**/staging/**' \
    -x 'packages-src/**/staging-*/**' \
    -x 'packages-src/**/dmg-*/**' \
    -x 'packages-src/**/nfpm-work-*/**' \
    -x 'packages-src/**/node_modules/**' \
    -x 'packages-src/**/dist/**' \
    -x 'packages-src/**/app/server/**' \
    -x 'packages-src/**/app/docker/**' \
    -x 'packages-src/**/hanyemonitor/server/**' \
    -x 'packages-src/**/*.fpk' \
    -x 'packages-src/**/staging.zip'
)

cat >"$SRC/README.txt" <<EOF
hanye Printer Monitor — 各平台安装包源码
版本: ${VERSION}
目录: packages-src/

  mac/     macOS DMG
  linux/   Ubuntu / Debian / CentOS
  win/     Windows exe
  fnos/    飞牛 .fpk
  syno/    群晖 .spk

二进制安装包输出到 packages/
打包脚本在 ops/scripts/（npm run pack:*）
EOF

echo "OK: packages-src/ 为安装包源码目录"
ls -lh "$ZIP_PATH"
echo "压缩包: packages/$ZIP_NAME"
