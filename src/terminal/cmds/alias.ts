import type { Ctx } from '../context'

// alias — three modes:
//   alias                    list all aliases as `alias name='value'`
//   alias name               show one alias (or "not found")
//   alias name=value ...     define one or more aliases
//
// Bash is permissive about alias names — `..`, `-`, `!foo` and even `/abc`
// are accepted. We reject only characters the parser would choke on
// (whitespace, `=`, and shell metachars) plus the empty string.
const INVALID_NAME = /[=\s|&;<>()`$\\'"]/

export default function alias(ctx: Ctx): void {
  if (ctx.args.length === 0) {
    const names = Object.keys(ctx.shell.aliases).sort()
    for (const n of names) {
      ctx.stdout(`alias ${n}='${ctx.shell.aliases[n]}'\n`)
    }
    return
  }
  for (const a of ctx.args) {
    const eq = a.indexOf('=')
    if (eq < 0) {
      const v = ctx.shell.aliases[a]
      if (v === undefined) { ctx.err(a, 'not found'); continue }
      ctx.stdout(`alias ${a}='${v}'\n`)
      continue
    }
    const name = a.slice(0, eq)
    const value = a.slice(eq + 1)
    if (!name || INVALID_NAME.test(name)) { ctx.err(a, 'invalid alias name'); continue }
    ctx.shell.aliases[name] = stripQuotes(value)
  }
}

function stripQuotes(s: string): string {
  if ((s.startsWith("'") && s.endsWith("'") && s.length >= 2) ||
      (s.startsWith('"') && s.endsWith('"') && s.length >= 2)) {
    return s.slice(1, -1)
  }
  return s
}
