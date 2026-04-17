import type { Ctx } from '../context'
import { USERS } from '../../fs/vfs'

export default function groups(ctx: Ctx): void {
  const u = ctx.args[0] ? USERS[ctx.args[0]] : ctx.user
  if (!u) return ctx.err(ctx.args[0], 'no such user')
  const gids = [u.gid, ...(u.groups ?? [])]
  const names = gids.map((g) => Object.values(USERS).find((v) => v.gid === g)?.group ?? String(g))
  ctx.stdout(names.join(' ') + '\n')
}
