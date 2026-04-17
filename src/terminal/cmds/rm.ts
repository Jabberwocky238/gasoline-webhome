import type { Ctx } from '../context'
import { unlink, rmTree, VfsError } from '../../fs/vfs'

// rm — supports -r (recursive), -f (force: ignore ENOENT). Refuses to
// recurse on the root without --no-preserve-root; we never honor that flag.
export default function rm(ctx: Ctx): void {
  let recursive = false
  let force = false
  const targets: string[] = []
  for (const a of ctx.args) {
    if (a === '--') break
    if (a.startsWith('-') && a !== '-') {
      for (const ch of a.slice(1)) {
        if (ch === 'r' || ch === 'R') recursive = true
        else if (ch === 'f') force = true
        else return ctx.err(`-${ch}`, 'invalid option')
      }
      continue
    }
    targets.push(a)
  }
  if (targets.length === 0) {
    if (!force) ctx.err('', 'missing operand')
    return
  }
  for (const t of targets) {
    const path = ctx.resolve(t)
    if (path.length === 0) { ctx.err(t, 'it is dangerous to operate recursively on /'); continue }
    try {
      if (recursive) rmTree(ctx.user, path)
      else unlink(ctx.user, path)
    } catch (e) {
      if (force && e instanceof VfsError && e.code === 'ENOENT') continue
      ctx.reportVfs(e, t)
    }
  }
}
