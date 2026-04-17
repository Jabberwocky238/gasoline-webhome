import type { Ctx } from '../context'
import { removeUser } from '../../fs/accounts'
import { isSudoer } from '../../fs/vfs'

export default function userdel(ctx: Ctx): void {
  if (!isSudoer(ctx.user)) { ctx.err('userdel', 'must be root / sudoer'); return }
  if (ctx.args.length === 0) return ctx.err('', 'usage: userdel name')
  for (const n of ctx.args) {
    try { removeUser(n) } catch (e) { ctx.err(n, (e as Error).message) }
  }
}
