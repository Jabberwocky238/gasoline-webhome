import type { Ctx } from '../context'
import { lookup, USERS } from '../../fs/vfs'

// chgrp — change group. Non-root may only set to a group they belong to
// (primary or supplementary).
export default function chgrp(ctx: Ctx): void {
  if (ctx.args.length < 2) return ctx.err('', 'missing operand')
  const groupName = ctx.args[0]
  const group = Object.values(USERS).find((u) => u.group === groupName)
  if (!group) return ctx.err(groupName, 'invalid group')
  const isRoot = ctx.user.uid === 0
  const inGroup =
    ctx.user.gid === group.gid || ctx.user.groups?.includes(group.gid)
  if (!isRoot && !inGroup) return ctx.err(groupName, 'Operation not permitted')
  for (const p of ctx.args.slice(1)) {
    const node = lookup(ctx.resolve(p))
    if (!node) { ctx.err(p, 'No such file or directory'); continue }
    if (!isRoot && ctx.user.uid !== node.uid) {
      ctx.err(p, 'Operation not permitted'); continue
    }
    node.gid = group.gid
  }
}
