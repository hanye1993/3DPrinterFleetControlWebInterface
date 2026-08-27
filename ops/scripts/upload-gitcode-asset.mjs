#!/usr/bin/env node
/** GitCode Release 附件：先取 upload_url，再 PUT 到 OBS */
import fs from 'node:fs';
import path from 'node:path';

const [owner, repo, tag, filePath, token] = process.argv.slice(2);
if (!owner || !repo || !tag || !filePath || !token) {
  console.error('用法: node upload-gitcode-asset.mjs owner repo tag file token');
  process.exit(1);
}

const fileName = path.basename(filePath);
const metaUrl =
  `https://gitcode.com/api/v5/repos/${owner}/${repo}/releases/${tag}/upload_url` +
  `?access_token=${encodeURIComponent(token)}&file_name=${encodeURIComponent(fileName)}`;

const metaRes = await fetch(metaUrl);
if (!metaRes.ok) {
  console.error(await metaRes.text());
  process.exit(1);
}
const meta = await metaRes.json();
const body = fs.readFileSync(filePath);
const headers = { ...meta.headers, 'Content-Length': String(body.length) };

const up = await fetch(meta.url, { method: 'PUT', headers, body });
if (!up.ok) {
  console.error(`PUT ${up.status}`, await up.text());
  process.exit(1);
}
console.log(`OK ${fileName}`);
