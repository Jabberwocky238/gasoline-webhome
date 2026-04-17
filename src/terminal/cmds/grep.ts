import type { Ctx } from '../context'
import { C } from '../ansi'
import { readFile, hasPerm, type VFile } from '../../fs/vfs'

// grep — regex line filter. Flags: -i (ignore case), -v (invert),
// -n (show line numbers), -E (ERE; we use JS regex anyway so no-op here),
// -c (count only), -H (always filename), -h (never filename).
// Exit: 0 if any match, 1 if none, 2 on error — mirrors GNU grep.
export default async function grep(ctx: Ctx): Promise<void> {
  let ignoreCase = false
  let invert = false
  let showNum = false
  let countOnly = false
  let forceH: boolean | null = null  // null = default (show if multiple files)
  let pattern: string | null = null
  const files: string[] = []
  for (let i = 0; i < ctx.args.length; i++) {
    const a = ctx.args[i]
    if (a === '--') { files.push(...ctx.args.slice(i + 1)); break }
    if (a.startsWith('-') && a.length > 1 && pattern === null) {
      for (const ch of a.slice(1)) {
        if (ch === 'i') ignoreCase = true
        else if (ch === 'v') invert = true
        else if (ch === 'n') showNum = true
        else if (ch === 'E') {/* JS regex already */}
        else if (ch === 'c') countOnly = true
        else if (ch === 'H') forceH = true
        else if (ch === 'h') forceH = false
        else return ctx.err(`-${ch}`, 'invalid option'), ctx.setExit(2)
      }
      continue
    }
    if (pattern === null) pattern = a
    else files.push(a)
  }
  if (pattern === null) {
    ctx.stderr(`${C.red}grep: missing pattern${C.reset}\n`)
    ctx.setExit(2); return
  }
  let re: RegExp
  try {
    re = new RegExp(pattern, ignoreCase ? 'i' : '')
  } catch (e) {
    ctx.stderr(`${C.red}grep: invalid regex: ${(e as Error).message}${C.reset}\n`)
    ctx.setExit(2); return
  }
  const sources: { label: string; text: string }[] = []
  if (files.length === 0) {
    sources.push({ label: '(stdin)', text: ctx.stdin })
  } else {
    for (const f of files) {
      const node = ctx.lookup(ctx.resolve(f))
      if (!node) { ctx.err(f, 'No such file or directory'); continue }
      if (node.kind !== 'file') { ctx.err(f, 'Is a directory'); continue }
      if (!hasPerm(ctx.user, node, 'r')) { ctx.err(f, 'Permission denied'); continue }
      sources.push({ label: f, text: await readFile(node as VFile) })
    }
  }
  const showFile =
    forceH !== null ? forceH : sources.length > 1
  let anyMatch = false
  for (const s of sources) {
    const lines = s.text.split('\n')
    if (lines[lines.length - 1] === '') lines.pop()
    let count = 0
    const out: string[] = []
    for (let i = 0; i < lines.length; i++) {
      const hit = re.test(lines[i])
      if (hit === invert) continue
      count++
      if (countOnly) continue
      const hl = invert
        ? lines[i]
        : lines[i].replace(re, (m) => `${C.red}${C.bold}${m}${C.reset}`)
      let prefix = ''
      if (showFile) prefix += `${C.magenta}${s.label}${C.reset}:`
      if (showNum)  prefix += `${C.green}${i + 1}${C.reset}:`
      out.push(prefix + hl)
    }
    if (countOnly) {
      const prefix = showFile ? `${s.label}:` : ''
      ctx.stdout(prefix + count + '\n')
    } else if (out.length) {
      ctx.stdout(out.join('\n') + '\n')
    }
    if (count > 0) anyMatch = true
  }
  ctx.setExit(anyMatch ? 0 : 1)
}
