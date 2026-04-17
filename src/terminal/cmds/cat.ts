import type { Ctx } from '../context'
import { C } from '../ansi'
import { readFile, hasPerm, type VFile } from '../../fs/vfs'

// cat — if no args, copy stdin through. Otherwise concatenate each file's
// content. Binary-like files emit a stub so we don't spam the terminal.
export default async function cat(ctx: Ctx): Promise<void> {
  if (ctx.args.length === 0) {
    ctx.stdout(ctx.stdin)
    return
  }
  for (const a of ctx.args) {
    if (a === '-') { ctx.stdout(ctx.stdin); continue }
    const node = ctx.lookup(ctx.resolve(a))
    if (!node) { ctx.err(a, 'No such file or directory'); continue }
    if (node.kind === 'dir') { ctx.err(a, 'Is a directory'); continue }
    if (!hasPerm(ctx.user, node, 'r')) { ctx.err(a, 'Permission denied'); continue }
    const f = node as VFile
    if (f.extPlatform) {
      ctx.stdout(
        `${C.dim}[binary] ${f.name}  (${f.size.toLocaleString()} bytes, mode 0755)${C.reset}\n`,
      )
      if (f.url) ctx.stdout(`${C.dim}download:${C.reset} ${C.cyan}${f.url}${C.reset}\n`)
      ctx.stdout(`${C.dim}run it with${C.reset} ${C.cyan}./${f.name}${C.reset}\n`)
      continue
    }
    ctx.stdout(await readFile(f))
  }
}
