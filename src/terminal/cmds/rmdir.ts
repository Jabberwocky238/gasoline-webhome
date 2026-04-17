import type { Ctx } from '../context'
import { rmdir as vfsRmdir } from '../../fs/vfs'

export default function rmdir(ctx: Ctx): void {
  if (ctx.args.length === 0) return ctx.err('', 'missing operand')
  for (const a of ctx.args) {
    try {
      vfsRmdir(ctx.user, ctx.resolve(a))
    } catch (e) {
      ctx.reportVfs(e, a)
    }
  }
}
