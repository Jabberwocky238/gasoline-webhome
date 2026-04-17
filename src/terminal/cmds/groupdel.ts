import type { Ctx } from '../context'
import { removeGroup } from '../../fs/accounts'
import { isSudoer } from '../../fs/vfs'

export default function groupdel(ctx: Ctx): void {
  if (!isSudoer(ctx.user)) { ctx.err('groupdel', 'must be root / sudoer'); return }
  if (ctx.args.length === 0) return ctx.err('', 'usage: groupdel name')
  for (const n of ctx.args) {
    try { removeGroup(n) } catch (e) { ctx.err(n, (e as Error).message) }
  }
}
