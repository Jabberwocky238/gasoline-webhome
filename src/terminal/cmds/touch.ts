import type { Ctx } from '../context'
import { touch as vfsTouch } from '../../fs/vfs'

export default function touch(ctx: Ctx): void {
  if (ctx.args.length === 0) return ctx.err('', 'missing file operand')
  for (const a of ctx.args) {
    try {
      vfsTouch(ctx.user, ctx.resolve(a))
    } catch (e) {
      ctx.reportVfs(e, a)
    }
  }
}
