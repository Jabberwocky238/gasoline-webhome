import type { Ctx } from '../context'

// echo — join args with a single space, append \n unless -n.
export default function echo(ctx: Ctx): void {
  let noNewline = false
  const parts: string[] = []
  for (const a of ctx.args) {
    if (a === '-n' && parts.length === 0) { noNewline = true; continue }
    parts.push(a)
  }
  ctx.stdout(parts.join(' ') + (noNewline ? '' : '\n'))
}
