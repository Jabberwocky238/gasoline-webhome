import type { Ctx } from '../context'
import { readFile, hasPerm, type VFile } from '../../fs/vfs'

// head / tail — default 10 lines; -n N overrides. Reads named files or stdin.
export async function head(ctx: Ctx): Promise<void> { await slice(ctx, 'head') }
export async function tail(ctx: Ctx): Promise<void> { await slice(ctx, 'tail') }

async function slice(ctx: Ctx, mode: 'head' | 'tail'): Promise<void> {
  let n = 10
  const files: string[] = []
  for (let i = 0; i < ctx.args.length; i++) {
    const a = ctx.args[i]
    if (a === '-n') {
      const v = ctx.args[++i]
      if (!v || !/^\d+$/.test(v)) return ctx.err(a, 'invalid number')
      n = parseInt(v, 10)
    } else if (/^-\d+$/.test(a)) {
      n = parseInt(a.slice(1), 10)
    } else if (a.startsWith('-n')) {
      const v = a.slice(2)
      if (!/^\d+$/.test(v)) return ctx.err(a, 'invalid option')
      n = parseInt(v, 10)
    } else files.push(a)
  }
  const sources: { label: string; text: string }[] = []
  if (files.length === 0) {
    sources.push({ label: '', text: ctx.stdin })
  } else {
    for (const f of files) {
      const node = ctx.lookup(ctx.resolve(f))
      if (!node) { ctx.err(f, 'No such file or directory'); continue }
      if (node.kind !== 'file') { ctx.err(f, 'Is a directory'); continue }
      if (!hasPerm(ctx.user, node, 'r')) { ctx.err(f, 'Permission denied'); continue }
      sources.push({ label: f, text: await readFile(node as VFile) })
    }
  }
  const showHeader = sources.length > 1
  for (const s of sources) {
    if (showHeader) ctx.stdout(`==> ${s.label} <==\n`)
    const lines = s.text.split('\n')
    const hadTrailing = lines[lines.length - 1] === ''
    if (hadTrailing) lines.pop()
    const picked = mode === 'head' ? lines.slice(0, n) : lines.slice(-n)
    ctx.stdout(picked.join('\n') + (picked.length ? '\n' : ''))
  }
}
