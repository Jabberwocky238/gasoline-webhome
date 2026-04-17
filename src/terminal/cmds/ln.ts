import type { Ctx } from '../context'
import { link, symlink, unlink, lookup, resolvePath, VfsError } from '../../fs/vfs'

// ln — create a link.
//   ln    source dest        hard link (shared inode)
//   ln -s target dest        symbolic link (dest -> target, stored verbatim)
//   ln -sf target dest       replace dest if it exists
//
// When dest is an existing directory, the link is created INSIDE it using
// the basename of the source. Matches coreutils.
export default function ln(ctx: Ctx): void {
  let symbolic = false
  let force = false
  const rest: string[] = []
  for (const a of ctx.args) {
    if (a === '--') break
    if (a.startsWith('-') && a.length > 1 && !/^-\d/.test(a)) {
      for (const ch of a.slice(1)) {
        if (ch === 's') symbolic = true
        else if (ch === 'f') force = true
        else return ctx.err(`-${ch}`, 'invalid option')
      }
      continue
    }
    rest.push(a)
  }
  if (rest.length < 2) return ctx.err('', 'missing operand')
  const src = rest[0]
  const destArg = rest[1]

  // If dest is an existing directory, the link lands inside with src's basename.
  let destPath = ctx.resolve(destArg)
  const destNode = lookup(destPath, { followLast: false })
  if (destNode && destNode.kind === 'dir') {
    const leaf = src.split('/').filter(Boolean).pop() ?? src
    destPath = [...destPath, leaf]
  }

  // Force: remove an existing dest entry up front.
  if (force) {
    const existing = lookup(destPath, { followLast: false })
    if (existing) {
      try { unlink(ctx.user, destPath) }
      catch (e) {
        if (!(e instanceof VfsError && e.code === 'ENOENT')) { ctx.reportVfs(e, destArg); return }
      }
    }
  }

  if (symbolic) {
    try { symlink(ctx.user, destPath, src) }
    catch (e) { ctx.reportVfs(e, destArg) }
    return
  }

  // Hard link — resolve src through symlinks (real Unix follows).
  try { link(ctx.user, resolvePath(ctx.shell.cwd, src), destPath) }
  catch (e) { ctx.reportVfs(e, destArg) }
}
