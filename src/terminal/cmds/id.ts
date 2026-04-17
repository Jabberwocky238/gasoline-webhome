import type { Ctx } from '../context'
import { USERS } from '../../fs/vfs'

// id — prints uid=N(name) gid=N(group) groups=... like coreutils.
export default function id(ctx: Ctx): void {
  const targetName = ctx.args[0]
  const u = targetName ? USERS[targetName] : ctx.user
  if (!u) return ctx.err(targetName!, 'no such user')
  const groups = u.groups ?? []
  const groupList = [u.gid, ...groups].map((g) => {
    const entry = Object.values(USERS).find((v) => v.gid === g)
    const name = entry?.group ?? String(g)
    return `${g}(${name})`
  }).join(',')
  ctx.stdout(`uid=${u.uid}(${u.name}) gid=${u.gid}(${u.group}) groups=${groupList}\n`)
}
