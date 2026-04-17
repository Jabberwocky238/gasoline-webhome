import type { Ctx } from '../context'
import { C } from '../ansi'
import { readFile, writeContent, hasPerm, type VFile } from '../../fs/vfs'

// sed — single substitution script of the form `s/pat/rep/[gim]`. Also
// supports `s|pat|rep|` so slashes in paths don't need escaping. Flags:
// -i  in-place write to each file (creates backup only if `-i.bak` given).
// -n  suppress default auto-print (only matters with `p` flag — not impl).
// -E  treat pattern as ERE (JS regex anyway — no-op).
//
// Also supports `d` (delete matching lines): `/pat/d`.
export default async function sed(ctx: Ctx): Promise<void> {
  let inplace = false
  let backupSuffix = ''
  let script: string | null = null
  const files: string[] = []
  for (let i = 0; i < ctx.args.length; i++) {
    const a = ctx.args[i]
    if (a === '--') { files.push(...ctx.args.slice(i + 1)); break }
    if (a === '-i' || a.startsWith('-i')) {
      inplace = true
      backupSuffix = a.length > 2 ? a.slice(2) : ''
      continue
    }
    if (a === '-E' || a === '-r') continue
    if (a === '-e') { script = ctx.args[++i] ?? null; continue }
    if (a.startsWith('-') && a.length > 1) {
      return ctx.err(a, 'invalid option'), ctx.setExit(2)
    }
    if (script === null) script = a
    else files.push(a)
  }
  if (script === null) {
    ctx.stderr(`${C.red}sed: missing script${C.reset}\n`)
    ctx.setExit(2); return
  }
  let op: ScriptOp
  try { op = parseScript(script) }
  catch (e) {
    ctx.stderr(`${C.red}sed: ${(e as Error).message}${C.reset}\n`)
    ctx.setExit(2); return
  }
  const sources: { label: string; text: string; node: VFile | null }[] = []
  if (files.length === 0) {
    if (inplace) {
      ctx.stderr(`${C.red}sed: -i requires file arg${C.reset}\n`)
      ctx.setExit(2); return
    }
    sources.push({ label: '(stdin)', text: ctx.stdin, node: null })
  } else {
    for (const f of files) {
      const node = ctx.lookup(ctx.resolve(f))
      if (!node) { ctx.err(f, 'No such file or directory'); continue }
      if (node.kind !== 'file') { ctx.err(f, 'Is a directory'); continue }
      if (!hasPerm(ctx.user, node, 'r')) { ctx.err(f, 'Permission denied'); continue }
      sources.push({ label: f, text: await readFile(node as VFile), node: node as VFile })
    }
  }
  for (const s of sources) {
    const out = applyOp(op, s.text)
    if (inplace && s.node) {
      if (backupSuffix) {
        // Write backup file alongside: <name><suffix>.
        try { writeContent(ctx.user, ctx.resolve(s.label + backupSuffix), s.text) }
        catch (e) { ctx.reportVfs(e, s.label + backupSuffix); continue }
      }
      try { writeContent(ctx.user, ctx.resolve(s.label), out) }
      catch (e) { ctx.reportVfs(e, s.label); continue }
    } else {
      ctx.stdout(out)
    }
  }
}

type ScriptOp =
  | { kind: 'sub'; re: RegExp; rep: string; global: boolean }
  | { kind: 'del'; re: RegExp }

function parseScript(script: string): ScriptOp {
  // Delete form:  /pattern/d
  {
    const m = /^\/(.*)\/d$/s.exec(script)
    if (m) return { kind: 'del', re: new RegExp(m[1]) }
  }
  // Substitute form:  s<sep>pat<sep>rep<sep>flags
  if (!script.startsWith('s') || script.length < 4) {
    throw new Error(`unsupported script: ${script}`)
  }
  const sep = script[1]
  const parts = splitOnSep(script.slice(2), sep)
  if (parts.length !== 3) throw new Error(`malformed s-command: ${script}`)
  const [pat, rep, flags] = parts
  let re: RegExp
  let reFlags = ''
  if (flags.includes('i')) reFlags += 'i'
  if (flags.includes('g')) reFlags += 'g'
  if (flags.includes('m')) reFlags += 'm'
  try { re = new RegExp(pat, reFlags) }
  catch (e) { throw new Error(`bad regex: ${(e as Error).message}`) }
  return { kind: 'sub', re, rep: unescapeReplacement(rep), global: flags.includes('g') }
}

function splitOnSep(s: string, sep: string): string[] {
  const out: string[] = []
  let buf = ''
  let i = 0
  while (i < s.length) {
    const c = s[i]
    if (c === '\\' && i + 1 < s.length) { buf += s[i] + s[i + 1]; i += 2; continue }
    if (c === sep) { out.push(buf); buf = ''; i++; continue }
    buf += c; i++
  }
  out.push(buf)
  return out
}

// sed uses \1 \2 for capture groups; JS uses $1 $2. Convert.
function unescapeReplacement(rep: string): string {
  return rep
    .replace(/\\&/g, '\u0001') // guard sed's "&" escape
    .replace(/&/g, '$&')
    .replace(/\u0001/g, '&')
    .replace(/\\(\d)/g, '$$$1')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\\\/g, '\\')
}

function applyOp(op: ScriptOp, input: string): string {
  if (op.kind === 'del') {
    const keep: string[] = []
    const lines = input.split('\n')
    const hadTrailing = lines[lines.length - 1] === ''
    if (hadTrailing) lines.pop()
    for (const ln of lines) if (!op.re.test(ln)) keep.push(ln)
    return keep.join('\n') + (hadTrailing && keep.length ? '\n' : '')
  }
  const lines = input.split('\n')
  const hadTrailing = lines[lines.length - 1] === ''
  if (hadTrailing) lines.pop()
  const re = op.re
  const replaced = lines.map((ln) => {
    if (op.global && re.flags.includes('g')) return ln.replace(re, op.rep)
    // Non-global: replace first match only. For a non-/g regex, JS .replace
    // already stops after the first hit.
    return ln.replace(re, op.rep)
  })
  return replaced.join('\n') + (hadTrailing ? '\n' : '')
}
