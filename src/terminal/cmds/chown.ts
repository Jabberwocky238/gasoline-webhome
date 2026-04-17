import type { Ctx } from '../context'
import { lookup, USERS } from '../../fs/vfs'

// chown — accepts `user`, `:group`, `user:group`. Only root (uid 0) or the
// current owner may change ownership (and non-root can't gift to others).
export default function chown(ctx: Ctx): void {
  if (ctx.args.length < 2) return ctx.err('', 'missing operand')
  const spec = ctx.args[0]
  const colon = spec.indexOf(':')
  const userPart = colon < 0 ? spec : spec.slice(0, colon)
  const groupPart = colon < 0 ? null : spec.slice(colon + 1)
  let newUid: number | null = null
  let newGid: number | null = null
  if (userPart) {
    const u = USERS[userPart]
    if (!u) return ctx.err(userPart, 'invalid user')
    newUid = u.uid
  }
  if (groupPart !== null && groupPart !== '') {
    const g = Object.values(USERS).find((u) => u.group === groupPart)
    if (!g) return ctx.err(groupPart, 'invalid group')
    newGid = g.gid
  }
  for (const p of ctx.args.slice(1)) {
    const node = lookup(ctx.resolve(p))
    if (!node) { ctx.err(p, 'No such file or directory'); continue }
    if (ctx.user.uid !== 0 && ctx.user.uid !== node.uid) {
      ctx.err(p, 'Operation not permitted'); continue
    }
    if (newUid !== null && ctx.user.uid !== 0) {
      ctx.err(p, 'Operation not permitted'); continue
    }
    if (newUid !== null) node.uid = newUid
    if (newGid !== null) node.gid = newGid
  }
}
