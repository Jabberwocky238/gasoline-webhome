import type { Ctx } from '../context'
import { addUser } from '../../fs/accounts'
import { isSudoer } from '../../fs/vfs'

// useradd [-u uid] [-g gid] [-G groups] [-p password] name
export default function useradd(ctx: Ctx): void {
  if (!isSudoer(ctx.user)) { ctx.err('useradd', 'Only root or sudoers may run useradd'); return }
  let uid: number | undefined, gid: number | undefined, password: string | undefined
  const supplementary: number[] = []
  let name: string | null = null
  for (let i = 0; i < ctx.args.length; i++) {
    const a = ctx.args[i]
    if (a === '-u') { uid = parseInt(ctx.args[++i], 10); continue }
    if (a === '-g') { gid = parseInt(ctx.args[++i], 10); continue }
    if (a === '-G') { for (const g of (ctx.args[++i] ?? '').split(',')) { const n = parseInt(g, 10); if (!isNaN(n)) supplementary.push(n) } ; continue }
    if (a === '-p') { password = ctx.args[++i]; continue }
    if (a.startsWith('-')) { ctx.err(a, 'unknown option'); return }
    name = a
  }
  if (!name) return ctx.err('', 'usage: useradd [-u uid] [-g gid] [-G g1,g2] [-p pw] name')
  try { addUser({ name, uid, gid, password, groups: supplementary.length ? supplementary : undefined }) }
  catch (e) { ctx.err(name, (e as Error).message) }
}
