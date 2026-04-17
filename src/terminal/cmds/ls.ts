import type { Ctx } from '../context'
import { C } from '../ansi'
import {
  prettyPath,
  uidName,
  gidName,
  hasPerm,
  type VNode,
  type VDir,
  type VFile,
} from '../../fs/vfs'

// ls — supports -l, -a, -R (recursive), -h (human sizes), multiple path args.
// Error strings match coreutils: `ls: foo: No such file or directory`.
export default function ls(ctx: Ctx): void {
  let longFmt = false
  let showAll = false
  let recursive = false
  let human = false
  const paths: string[] = []
  for (const a of ctx.args) {
    if (a.startsWith('-') && a !== '-') {
      for (const ch of a.slice(1)) {
        if (ch === 'l') longFmt = true
        else if (ch === 'a') showAll = true
        else if (ch === 'R') recursive = true
        else if (ch === 'h') human = true
        else return ctx.err(`-${ch}`, 'invalid option')
      }
    } else paths.push(a)
  }
  if (paths.length === 0) paths.push('.')
  const blocks: string[] = []
  for (const p of paths) {
    const resolved = ctx.resolve(p)
    const node = ctx.lookup(resolved)
    if (!node) { ctx.err(p, 'No such file or directory'); continue }
    if (node.kind === 'dir' && !hasPerm(ctx.user, node, 'r')) {
      ctx.err(p, 'Permission denied'); continue
    }
    if (paths.length > 1 || recursive) blocks.push(prettyPath(resolved) + ':')
    blocks.push(formatLs(node, { longFmt, showAll, human }))
    if (recursive && node.kind === 'dir') {
      for (const c of node.children) {
        if (c.kind !== 'dir') continue
        if (!showAll && c.name.startsWith('.')) continue
        walkRecursive(c, [...resolved, c.name], { longFmt, showAll, human }, blocks)
      }
    }
  }
  ctx.stdout(blocks.join('\n') + '\n')
}

function walkRecursive(
  node: VDir,
  path: string[],
  opts: { longFmt: boolean; showAll: boolean; human: boolean },
  out: string[],
) {
  out.push('')
  out.push(prettyPath(path) + ':')
  out.push(formatLs(node, opts))
  for (const c of node.children) {
    if (c.kind !== 'dir') continue
    if (!opts.showAll && c.name.startsWith('.')) continue
    walkRecursive(c, [...path, c.name], opts, out)
  }
}

function formatLs(
  node: VNode,
  opts: { longFmt: boolean; showAll: boolean; human: boolean },
): string {
  if (node.kind === 'file') {
    return opts.longFmt ? longRow(node, opts.human) : colorName(node)
  }
  const kids: VNode[] = opts.showAll
    ? [
        { kind: 'dir' as const, name: '.',  mtime: node.mtime, uid: node.uid, gid: node.gid, mode: node.mode, children: [] },
        { kind: 'dir' as const, name: '..', mtime: node.mtime, uid: node.uid, gid: node.gid, mode: node.mode, children: [] },
        ...node.children,
      ]
    : node.children.filter((c) => !c.name.startsWith('.'))
  if (opts.longFmt) return kids.map((k) => longRow(k, opts.human)).join('\n')
  return kids.map(colorName).join('  ')
}

function longRow(n: VNode, human: boolean): string {
  const size = n.kind === 'file' ? n.size : 0
  const sizeStr = human ? humanSize(size) : size.toString().padStart(8)
  return `${C.gray}${permString(n)} 1 ${uidName(n.uid)} ${gidName(n.gid)} ${sizeStr} ${n.mtime}${C.reset} ${colorName(n)}`
}

function permString(n: VNode): string {
  const type = n.kind === 'dir' ? 'd' : '-'
  const bit = (shift: number) => {
    const m = n.mode >> shift
    return ((m & 4) ? 'r' : '-') + ((m & 2) ? 'w' : '-') + ((m & 1) ? 'x' : '-')
  }
  return type + bit(6) + bit(3) + bit(0)
}

function colorName(n: VNode): string {
  if (n.kind === 'dir') return `${C.blue}${C.bold}${n.name}${C.reset}`
  const f = n as VFile
  const exec = (f.mode & 0o111) !== 0
  if (exec || f.name.endsWith('.sh')) return `${C.green}${C.bold}${f.name}${C.reset}`
  return f.name
}

function humanSize(n: number): string {
  const u = ['B', 'K', 'M', 'G', 'T']
  let i = 0
  let v = n
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++ }
  return (i === 0 ? v.toString() : v.toFixed(1)) + u[i]
}
