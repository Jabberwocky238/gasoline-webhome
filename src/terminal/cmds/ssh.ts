import type { Ctx } from '../context'
import { USERS, HOME_PATH } from '../../fs/vfs'

// ssh — demo login. Accepts several compact forms the user might try:
//
//   ssh user@host                     prompts for password
//   ssh user@host password            password as separate arg
//   ssh user@host:password            password after colon
//   ssh @host:user:password           user's specified syntax
//   ssh host:user:password            no leading '@'
//
// Host must match our hostname (gasoline.network); unknown hosts get the
// classic "Name or service not known" error. Wrong password → "Permission
// denied". On success, the current shell session switches identity.
const HOST = 'gasoline.network'

interface Parts { user?: string; host?: string; password?: string }

export default async function ssh(ctx: Ctx): Promise<void> {
  if (ctx.args.length === 0) return ctx.err('', 'usage: ssh [user@]host[:password]')
  const parts = parseTarget(ctx.args[0], ctx.args[1])
  if (!parts.host) return ctx.err(ctx.args[0], 'unable to parse target')
  if (parts.host !== HOST && parts.host !== 'localhost') {
    ctx.stderr(`ssh: Could not resolve hostname ${parts.host}: Name or service not known\n`)
    ctx.setExit(255); return
  }
  const userName = parts.user ?? ctx.user.name
  const account = USERS[userName]
  if (!account) {
    ctx.stderr(`${userName}@${parts.host}: Permission denied (publickey,password).\n`)
    ctx.setExit(255); return
  }
  let password = parts.password
  if (password === undefined) {
    password = await ctx.ask(`${userName}@${parts.host}'s password: `)
  }
  if (!account.password || account.password !== password) {
    ctx.stderr(`${userName}@${parts.host}: Permission denied (publickey,password).\n`)
    ctx.setExit(255); return
  }
  // Switch identity in-place.
  ctx.shell.user = account
  ctx.shell.env.USER = account.name
  ctx.shell.env.HOME = account.name === 'visitor' ? '/home/visitor' : `/home/${account.name}`
  if (account.name === 'visitor') ctx.shell.cwd = [...HOME_PATH]
  else if (account.name === 'root') ctx.shell.cwd = ['root']
  else ctx.shell.cwd = ['home', account.name]
  ctx.stdout(`Welcome, ${account.name}.\n`)
}

function parseTarget(first: string, second: string | undefined): Parts {
  const out: Parts = {}
  if (first.startsWith('@')) {
    // @host:user:password
    const p = first.slice(1).split(':')
    out.host = p[0]
    if (p[1]) out.user = p[1]
    if (p[2] !== undefined) out.password = p[2]
  } else if (first.includes('@')) {
    const at = first.indexOf('@')
    out.user = first.slice(0, at)
    const rest = first.slice(at + 1)
    const colon = rest.indexOf(':')
    if (colon >= 0) { out.host = rest.slice(0, colon); out.password = rest.slice(colon + 1) }
    else out.host = rest
  } else {
    const p = first.split(':')
    out.host = p[0]
    if (p[1]) out.user = p[1]
    if (p[2] !== undefined) out.password = p[2]
  }
  if (out.password === undefined && second !== undefined) out.password = second
  return out
}
