import type { Ctx } from '../context'

// env — print env one per line, KEY=VALUE. Skips the internal $? shim.
export default function env(ctx: Ctx): void {
  const entries = Object.entries(ctx.shell.env)
    .filter(([k]) => k !== '?' && !/^[0-9]$/.test(k))
    .sort(([a], [b]) => a.localeCompare(b))
  ctx.stdout(entries.map(([k, v]) => `${k}=${v}`).join('\n') + '\n')
}
