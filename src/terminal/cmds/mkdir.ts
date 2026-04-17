import type { Ctx } from '../context'
import { mkdir as vfsMkdir, mkdirP } from '../../fs/vfs'

export default function mkdir(ctx: Ctx): void {
  let recursive = false
  const targets: string[] = []
  for (const a of ctx.args) {
    if (a === '-p' || a === '--parents') { recursive = true; continue }
    if (a.startsWith('-') && a !== '-') return ctx.err(a, 'invalid option')
    targets.push(a)
  }
  if (targets.length === 0) return ctx.err('', 'missing operand')
  for (const t of targets) {
    try {
      if (recursive) mkdirP(ctx.user, ctx.resolve(t))
      else vfsMkdir(ctx.user, ctx.resolve(t))
    } catch (e) {
      ctx.reportVfs(e, t)
    }
  }
}
