import type { Ctx } from '../context'
import { setPassword } from '../../fs/accounts'
import { USERS, isSudoer } from '../../fs/vfs'

// passwd — `passwd [user]`. Non-root users may only change their own.
// Prompts for the new password (asked twice, standard coreutils flow).
export default async function passwd(ctx: Ctx): Promise<void> {
  const target = ctx.args[0] ?? ctx.user.name
  if (!USERS[target]) return ctx.err(target, 'user does not exist')
  if (target !== ctx.user.name && !isSudoer(ctx.user)) {
    return ctx.err(target, 'must be root / sudoer to change another user')
  }
  const a = await ctx.ask('New password: ')
  const b = await ctx.ask('Retype new password: ')
  if (a !== b) { ctx.stderr('passwd: passwords do not match\n'); ctx.setExit(1); return }
  try { setPassword(target, a) } catch (e) { ctx.err(target, (e as Error).message); return }
  ctx.stdout(`passwd: password updated successfully\n`)
}
