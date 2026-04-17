import type { Ctx } from '../context'

// export — `export VAR[=val]` sets (and in a real shell, marks exported).
// With no args, prints current env in `declare -x KEY="val"` form.
export default function exportCmd(ctx: Ctx): void {
  if (ctx.args.length === 0) {
    const entries = Object.entries(ctx.shell.env)
      .filter(([k]) => k !== '?' && !/^[0-9]$/.test(k))
      .sort(([a], [b]) => a.localeCompare(b))
    ctx.stdout(entries.map(([k, v]) => `declare -x ${k}="${v}"`).join('\n') + '\n')
    return
  }
  for (const a of ctx.args) {
    const eq = a.indexOf('=')
    if (eq < 0) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(a)) return ctx.err(a, 'not a valid identifier')
      continue
    }
    const name = a.slice(0, eq)
    const value = a.slice(eq + 1)
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return ctx.err(a, 'not a valid identifier')
    ctx.shell.env[name] = value
  }
}
