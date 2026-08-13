import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { resolve, isAbsolute } from 'path'
import { DEFAULT_YOLO_WEIGHTS, yoloScriptCandidates } from '../../shared/repoLayout'

export type YoloDetectResult =
  | {
      ok: true
      detections: Array<{ label: string; confidence: number; xyxy?: number[] }>
      maxConfidence: number
      count: number
    }
  | { ok: false; message: string }

function resolveWeights(weights: string): string {
  const w = weights.trim() || DEFAULT_YOLO_WEIGHTS
  if (isAbsolute(w)) return w
  return resolve(process.cwd(), w)
}

function resolveScript(): string {
  const candidates = yoloScriptCandidates(__dirname)
  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  return candidates[0]!
}

export function yoloWeightsExists(weights: string): boolean {
  return existsSync(resolveWeights(weights))
}

export async function runYoloSpaghetti(opts: {
  python?: string
  weights?: string
  imageBase64: string
  conf?: number
  timeoutMs?: number
}): Promise<YoloDetectResult> {
  const python = (opts.python || 'python').trim() || 'python'
  const weights = resolveWeights(opts.weights || DEFAULT_YOLO_WEIGHTS)
  const script = resolveScript()
  if (!existsSync(script)) {
    return { ok: false, message: `检测脚本不存在: ${script}` }
  }
  if (!existsSync(weights)) {
    return { ok: false, message: `权重不存在: ${weights}` }
  }

  const conf = opts.conf ?? 0.25
  const timeoutMs = opts.timeoutMs ?? 90_000
  const b64 = opts.imageBase64.includes(',')
    ? opts.imageBase64.split(',').pop() || opts.imageBase64
    : opts.imageBase64

  return new Promise((resolvePromise) => {
    const child = spawn(python, [script, '--weights', weights, '--stdin-b64', '--conf', String(conf)], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (result: YoloDetectResult) => {
      if (settled) return
      settled = true
      resolvePromise(result)
    }
    const timer = setTimeout(() => {
      try {
        child.kill()
      } catch {
        /* ignore */
      }
      finish({ ok: false, message: `YOLO 超时（>${timeoutMs}ms）` })
    }, timeoutMs)

    child.stdout.on('data', (d) => {
      stdout += String(d)
    })
    child.stderr.on('data', (d) => {
      stderr += String(d)
    })
    child.on('error', (e) => {
      clearTimeout(timer)
      finish({
        ok: false,
        message: `无法启动 Python（${python}）: ${e.message}。请安装 Python 并 pip install ultralytics`
      })
    })
    child.on('close', () => {
      clearTimeout(timer)
      const line = stdout
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean)
        .pop()
      if (!line) {
        finish({
          ok: false,
          message: stderr.trim() || 'YOLO 无输出'
        })
        return
      }
      try {
        const parsed = JSON.parse(line) as YoloDetectResult
        finish(parsed)
      } catch {
        finish({ ok: false, message: `YOLO 输出无法解析: ${line.slice(0, 200)}` })
      }
    })

    try {
      child.stdin.write(b64)
      child.stdin.end()
    } catch (e) {
      clearTimeout(timer)
      finish({
        ok: false,
        message: e instanceof Error ? e.message : String(e)
      })
    }
  })
}
