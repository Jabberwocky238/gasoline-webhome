import type { Ctx } from '../context'

// unalias — remove one or more named aliases.
export default function unalias(ctx: Ctx): void {
  if (ctx.args.length === 0) return ctx.err('', 'usage: unalias name [name ...]')
  let allMode = false
  const names: string[] = []
  for (const a of ctx.args) {
    if (a === '-a') { allMode = true; continue }
    names.push(a)
  }
  if (allMode) {
    ctx.shell.aliases = {}
    return
  }
  for (const n of names) {
    if (!(n in ctx.shell.aliases)) { ctx.err(n, 'not found'); continue }
    delete ctx.shell.aliases[n]
  }
}
