import type { Ctx } from '../context'
import { absPath, lookup, resolvePath } from '../../fs/vfs'

// pwd — print working directory. -L prints the logical path (default), -P
// prints the physical path with every symlink resolved.
export default function pwd(ctx: Ctx): void {
  const wantPhysical = ctx.args.includes('-P')
  if (!wantPhysical) {
    ctx.stdout(absPath(ctx.shell.cwd) + '\n')
    return
  }
  // Resolve by walking segment-by-segment, following each symlink.
  const resolved: string[] = []
  for (let i = 0; i < ctx.shell.cwd.length; i++) {
    const node = lookup(ctx.shell.cwd.slice(0, i + 1), { followLast: false })
    if (!node) { ctx.stdout(absPath(ctx.shell.cwd) + '\n'); return }
    if (node.kind === 'symlink') {
      const target = resolvePath(resolved, node.target)
      resolved.length = 0
      resolved.push(...target)
    } else {
      resolved.push(ctx.shell.cwd[i])
    }
  }
  ctx.stdout(absPath(resolved) + '\n')
}
