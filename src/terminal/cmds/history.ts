import type { Ctx } from '../context'

// history — number each line right-aligned in a 5-wide column.
export default function history(ctx: Ctx): void {
  const lines = ctx.shell.history.map(
    (line, i) => `${(i + 1).toString().padStart(5)}  ${line}`,
  )
  ctx.stdout(lines.join('\n') + (lines.length ? '\n' : ''))
}
