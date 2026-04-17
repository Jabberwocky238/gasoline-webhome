import type { Ctx } from '../context'
import { hasPerm, absPath } from '../../fs/vfs'

export default function cd(ctx: Ctx): void {
  const target = ctx.args[0] ?? '~'
  const resolved = ctx.resolve(target)
  const node = ctx.lookup(resolved)
  if (!node) return ctx.err(target, 'No such file or directory')
  if (node.kind !== 'dir') return ctx.err(target, 'Not a directory')
  if (!hasPerm(ctx.user, node, 'x')) return ctx.err(target, 'Permission denied')
  ctx.shell.cwd = resolved
  ctx.shell.env.PWD = absPath(resolved)
}
