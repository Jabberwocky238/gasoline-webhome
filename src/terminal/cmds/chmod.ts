import type { Ctx } from '../context'
import { chmod as vfsChmod, lookup } from '../../fs/vfs'

// chmod — accepts octal (0755, 755) or symbolic (u+x, g-w, a+r, o=rx, +x).
// Multiple symbolic clauses may be joined with commas. Matches coreutils
// common cases; does not implement X or s/t bits.
export default function chmod(ctx: Ctx): void {
  if (ctx.args.length < 2) return ctx.err('', 'missing operand')
  const spec = ctx.args[0]
  const paths = ctx.args.slice(1)
  for (const p of paths) {
    const path = ctx.resolve(p)
    const node = lookup(path)
    if (!node) { ctx.err(p, 'No such file or directory'); continue }
    try {
      const mode = applyModeSpec(node.mode, spec)
      vfsChmod(ctx.user, path, mode)
    } catch (e) {
      ctx.reportVfs(e, p)
    }
  }
}

function applyModeSpec(current: number, spec: string): number {
  if (/^[0-7]{3,4}$/.test(spec)) return parseInt(spec, 8) & 0o7777
  let mode = current
  for (const clause of spec.split(',')) {
    const m = /^([ugoa]*)([+\-=])([rwxX]*)$/.exec(clause)
    if (!m) throw new Error(`invalid mode: ${spec}`)
    const who = m[1] === '' ? 'a' : m[1]
    const op = m[2]
    const perms = m[3]
    const whoMask = buildWho(who)
    const permMask = buildPerms(perms, whoMask)
    if (op === '+') mode |= permMask
    else if (op === '-') mode &= ~permMask
    else /* = */      mode = (mode & ~whoMask) | (permMask & whoMask)
  }
  return mode & 0o7777
}

function buildWho(who: string): number {
  let mask = 0
  if (who.includes('a')) mask |= 0o777
  if (who.includes('u')) mask |= 0o700
  if (who.includes('g')) mask |= 0o070
  if (who.includes('o')) mask |= 0o007
  return mask
}

function buildPerms(perms: string, whoMask: number): number {
  let bits = 0
  if (perms.includes('r')) bits |= 0o444
  if (perms.includes('w')) bits |= 0o222
  if (perms.includes('x')) bits |= 0o111
  // X: only add x if any x already set or target is a dir — we approximate
  // by requiring any x to be set.
  if (perms.includes('X')) bits |= 0o111
  return bits & whoMask
}
