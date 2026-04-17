import type { Ctx } from '../context'
import { C } from '../ansi'
import {
  prettyPath,
  uidName,
  gidName,
  hasPerm,
  type VNode,
  type VDir,
} from '../../fs/vfs'

// ls — supports -l, -a, -R (recursive), -h (human sizes), multiple path args.
// Columns in long-format are width-aligned to the widest entry in the listing,
// matching coreutils.  Symlinks are shown as `l...  name -> target`.
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
  if (node.kind !== 'dir') {
    // Single non-dir target — ls treats it as a 1-element listing.
    if (opts.longFmt) return longRow(node, columnWidths([node], opts.human), opts.human)
    return colorName(node)
  }
  const kids: VNode[] = opts.showAll
    ? [
        { kind: 'dir' as const, name: '.',  mtime: node.mtime, uid: node.uid, gid: node.gid, mode: node.mode, children: [] },
        { kind: 'dir' as const, name: '..', mtime: node.mtime, uid: node.uid, gid: node.gid, mode: node.mode, children: [] },
        ...node.children,
      ]
    : node.children.filter((c) => !c.name.startsWith('.'))
  if (opts.longFmt) {
    const widths = columnWidths(kids, opts.human)
    return kids.map((k) => longRow(k, widths, opts.human)).join('\n')
  }
  return kids.map(colorName).join('  ')
}

// ---- long-format column layout ----

interface Widths { links: number; user: number; group: number; size: number }

function nlinksOf(n: VNode): number {
  return n.kind === 'file' ? n.inode.nlinks : 1
}
function sizeOf(n: VNode): number {
  if (n.kind === 'file') return n.size
  if (n.kind === 'symlink') return n.target.length
  return 0
}

function columnWidths(nodes: VNode[], human: boolean): Widths {
  let links = 1, user = 1, group = 1, size = 1
  for (const n of nodes) {
    links = Math.max(links, String(nlinksOf(n)).length)
    user  = Math.max(user,  uidName(n.uid).length)
    group = Math.max(group, gidName(n.gid).length)
    const s = human ? humanSize(sizeOf(n)) : String(sizeOf(n))
    size  = Math.max(size, s.length)
  }
  return { links, user, group, size }
}

function longRow(n: VNode, w: Widths, human: boolean): string {
  const linksStr = String(nlinksOf(n)).padStart(w.links)
  const userStr  = uidName(n.uid).padEnd(w.user)
  const groupStr = gidName(n.gid).padEnd(w.group)
  const sizeRaw  = sizeOf(n)
  const sizeStr  = (human ? humanSize(sizeRaw) : String(sizeRaw)).padStart(w.size)
  return `${C.gray}${permString(n)} ${linksStr} ${userStr} ${groupStr} ${sizeStr} ${n.mtime}${C.reset} ${colorName(n)}`
}

function permString(n: VNode): string {
  const type =
    n.kind === 'dir'     ? 'd' :
    n.kind === 'symlink' ? 'l' :
                           '-'
  const bit = (shift: number) => {
    const m = n.mode >> shift
    return ((m & 4) ? 'r' : '-') + ((m & 2) ? 'w' : '-') + ((m & 1) ? 'x' : '-')
  }
  return type + bit(6) + bit(3) + bit(0)
}

function colorName(n: VNode): string {
  if (n.kind === 'dir') return `${C.blue}${C.bold}${n.name}${C.reset}`
  if (n.kind === 'symlink') {
    return `${C.cyan}${C.bold}${n.name}${C.reset} ${C.gray}->${C.reset} ${n.target}`
  }
  const exec = (n.mode & 0o111) !== 0
  if (exec || n.name.endsWith('.sh')) return `${C.green}${C.bold}${n.name}${C.reset}`
  return n.name
}

function humanSize(n: number): string {
  const u = ['B', 'K', 'M', 'G', 'T']
  let i = 0
  let v = n
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++ }
  return (i === 0 ? v.toString() : v.toFixed(1)) + u[i]
}
