import type { AiFaultKind } from '../../shared/aiVision'
import { AI_FAULT_LABELS } from '../../shared/aiVision'

export type CloudVisionHit = {
  kind: AiFaultKind
  confidence: number
  note?: string
}

export type CloudVisionResult =
  | { ok: true; hits: CloudVisionHit[]; raw?: string }
  | { ok: false; message: string }

const KIND_HINT = `
判断 3D 打印机舱内监控画面是否出现异常（可多选）：
- spaghetti: 炒面（一团乱丝/线材缠绕堆积）
- airPrint: 空打（喷头在空中挤出、平台上几乎没有成型件）
- modelFell: 模型掉落（模型倾倒、移位、脱离平台）
- warping: 翘边（边角翘起、脱粘）
只根据画面可见证据判断。返回严格 JSON：
{"hits":[{"kind":"spaghetti","confidence":0.0,"note":"简短中文"}]}
若正常则 {"hits":[]}
confidence 范围 0~1。
`.trim()

export async function runCloudVision(opts: {
  baseUrl: string
  apiKey: string
  model: string
  imageBase64: string
  timeoutMs?: number
}): Promise<CloudVisionResult> {
  const base = (opts.baseUrl || '').replace(/\/$/, '')
  const key = (opts.apiKey || '').trim()
  const model = (opts.model || '').trim()
  if (!base || !key || !model) {
    return { ok: false, message: '云端 AI 未配置完整（地址 / Key / 模型）' }
  }

  let b64 = opts.imageBase64
  let mime = 'image/jpeg'
  if (b64.startsWith('data:')) {
    const m = /^data:([^;]+);base64,(.+)$/i.exec(b64)
    if (m) {
      mime = m[1] || mime
      b64 = m[2] || ''
    }
  }

  const url = `${base}/chat/completions`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 45_000)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: KIND_HINT },
              {
                type: 'image_url',
                image_url: { url: `data:${mime};base64,${b64}` }
              }
            ]
          }
        ]
      }),
      signal: controller.signal
    })
    const text = await res.text()
    if (!res.ok) {
      return { ok: false, message: `云端 AI HTTP ${res.status}: ${text.slice(0, 240)}` }
    }
    let content = ''
    try {
      const data = JSON.parse(text) as {
        choices?: Array<{ message?: { content?: string } }>
      }
      content = data.choices?.[0]?.message?.content || ''
    } catch {
      return { ok: false, message: '云端 AI 响应非 JSON' }
    }
    const parsed = parseHits(content)
    return { ok: true, hits: parsed, raw: content }
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : String(e)
    }
  } finally {
    clearTimeout(timer)
  }
}

function parseHits(content: string): CloudVisionHit[] {
  const raw = content.trim()
  let obj: { hits?: unknown } | null = null
  try {
    obj = JSON.parse(raw) as { hits?: unknown }
  } catch {
    const m = raw.match(/\{[\s\S]*\}/)
    if (m) {
      try {
        obj = JSON.parse(m[0]) as { hits?: unknown }
      } catch {
        obj = null
      }
    }
  }
  if (!obj || !Array.isArray(obj.hits)) return []
  const out: CloudVisionHit[] = []
  for (const h of obj.hits) {
    if (!h || typeof h !== 'object') continue
    const row = h as Record<string, unknown>
    const kind = String(row.kind || '') as AiFaultKind
    if (!(kind in AI_FAULT_LABELS)) continue
    const confidence = Number(row.confidence)
    out.push({
      kind,
      confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0,
      note: typeof row.note === 'string' ? row.note : undefined
    })
  }
  return out
}
