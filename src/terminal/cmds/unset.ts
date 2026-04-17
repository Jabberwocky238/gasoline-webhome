import type { Ctx } from '../context'

export default function unset(ctx: Ctx): void {
  for (const a of ctx.args) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(a)) return ctx.err(a, 'not a valid identifier')
    delete ctx.shell.env[a]
  }
}
