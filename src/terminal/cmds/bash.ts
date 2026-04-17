import type { Ctx } from '../context'
import { runScript, runLine } from '../registry'
import { readFile, hasPerm, type VFile } from '../../fs/vfs'

// bash / sh — three modes:
//   bash -c "echo hi"      → run the string as a script
//   bash script.sh args    → execute the file's contents
//   bash                   → no-op (we're already in a shell)
export default async function bash(ctx: Ctx): Promise<void> {
  const args = ctx.args
  if (args.length === 0) return
  if (args[0] === '-c') {
    const script = args[1] ?? ''
    const r = await runLine(ctx.shell, script)
    ctx.stdout(r.out)
    ctx.setExit(r.status)
    return
  }
  const filename = args[0]
  const rest = args.slice(1)
  const node = ctx.lookup(ctx.resolve(filename))
  if (!node) return ctx.err(filename, 'No such file or directory')
  if (node.kind !== 'file') return ctx.err(filename, 'Is a directory')
  if (!hasPerm(ctx.user, node, 'r')) return ctx.err(filename, 'Permission denied')
  const text = await readFile(node as VFile)
  const r = await runScript(ctx.shell, text, [filename, ...rest])
  ctx.stdout(r.out)
  ctx.setExit(r.status)
}
