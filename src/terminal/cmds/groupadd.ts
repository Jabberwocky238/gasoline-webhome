import type { Ctx } from '../context'
import { addGroup } from '../../fs/accounts'
import { isSudoer } from '../../fs/vfs'

// groupadd [-g gid] name
export default function groupadd(ctx: Ctx): void {
  if (!isSudoer(ctx.user)) { ctx.err('groupadd', 'must be root / sudoer'); return }
  let gid: number | undefined
  let name: string | null = null
  for (let i = 0; i < ctx.args.length; i++) {
    const a = ctx.args[i]
    if (a === '-g') { gid = parseInt(ctx.args[++i], 10); continue }
    if (a.startsWith('-')) { ctx.err(a, 'unknown option'); return }
    name = a
  }
  if (!name) return ctx.err('', 'usage: groupadd [-g gid] name')
  try { addGroup(name, gid) } catch (e) { ctx.err(name, (e as Error).message) }
}
