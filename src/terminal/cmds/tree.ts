import type { Ctx } from '../context'
import { C } from '../ansi'
import { type VNode } from '../../fs/vfs'

// tree — quick recursive layout. No options.
export default function tree(ctx: Ctx): void {
  const target = ctx.args[0] ?? '.'
  const node = ctx.lookup(ctx.resolve(target))
  if (!node) return ctx.err(target, 'No such file or directory')
  ctx.stdout(render(node, '') + '\n')
}

function render(node: VNode, prefix: string): string {
  if (node.kind === 'file') return node.name
  const lines: string[] = [`${C.blue}${C.bold}${node.name}${C.reset}`]
  const kids = node.children
  kids.forEach((c, i) => {
    const last = i === kids.length - 1
    const branch = last ? '└── ' : '├── '
    const sub    = last ? '    ' : '│   '
    if (c.kind === 'dir') {
      const nested = render(c, prefix + sub).split('\n')
      lines.push(prefix + branch + nested[0])
      for (let j = 1; j < nested.length; j++) lines.push(prefix + sub + nested[j].slice((prefix + sub).length))
    } else {
      lines.push(prefix + branch + c.name)
    }
  })
  return lines.join('\n')
}
