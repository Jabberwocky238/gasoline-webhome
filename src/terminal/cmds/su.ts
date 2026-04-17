import type { Ctx } from '../context'
import { HOME_PATH, USERS } from '../../fs/vfs'

// su — demo-only, no password. Switches the shell's `user` and rewrites a
// few env vars to match. Use `exit` (handled via su - visitor) to go back.
export default function su(ctx: Ctx): void {
  const target = ctx.args[0] ?? 'root'
  const u = USERS[target]
  if (!u) return ctx.err(target, 'user does not exist')
  ctx.shell.user = u
  ctx.shell.env.USER = u.name
  ctx.shell.env.HOME = u.name === 'visitor' ? '/home/visitor' : `/home/${u.name}`
  // If switching to visitor, jump to /home/visitor; otherwise leave cwd.
  if (u.name === 'visitor') ctx.shell.cwd = [...HOME_PATH]
}
