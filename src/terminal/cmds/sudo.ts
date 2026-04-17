import type { Ctx } from '../context'
import { makeCtx } from '../context'
import { getCommand } from '../registry'
import { isSudoer, USERS } from '../../fs/vfs'

// sudo — run a single command as root, provided the current user is in the
// sudo group (gid 27). The command is dispatched directly with its already-
// expanded argv, so we don't re-parse (and won't misinterpret glob output).
//
// Scope limits vs. real sudo: no -u flag, no preserve-env, no password
// prompt (demo). Piping / redirection must be applied outside sudo:
//     sudo touch /etc/foo          works
//     sudo echo hi > /etc/foo      the redirect happens as *your* user
export default async function sudo(ctx: Ctx): Promise<void> {
  if (!isSudoer(ctx.user)) {
    ctx.stderr(`${ctx.user.name} is not in the sudoers file. This incident will be reported.\n`)
    ctx.setExit(1); return
  }
  if (ctx.args.length === 0) return ctx.err('', 'usage: sudo <command> [args...]')
  const name = ctx.args[0]
  const args = ctx.args.slice(1)
  const fn = getCommand(name)
  if (!fn) { ctx.stderr(`sudo: ${name}: command not found\n`); ctx.setExit(127); return }
  const origUser = ctx.shell.user
  ctx.shell.user = USERS.root
  const sub = makeCtx({
    shell: ctx.shell,
    name,
    args,
    stdin: ctx.stdin,
    stdout: ctx.stdout,
    stderr: ctx.stderr,
  })
  try {
    await fn(sub)
    ctx.setExit(sub.exitCode)
  } finally {
    ctx.shell.user = origUser
  }
}
