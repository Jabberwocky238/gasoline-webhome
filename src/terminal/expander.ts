// Word expander: variables, command substitution, globs.
//
// Run AFTER parsing. Converts each `Word` into 0..N strings:
//   - "$VAR" / "${VAR}" / "$?" / "$$" / "$0".."$9"
//   - "$(cmd)" — recursive runLine + trim trailing \n
//   - unquoted '*' / '?' / '[abc]' — glob-expand against the filesystem
//   - word splitting on unquoted $var containing whitespace
//
// NOT done here: brace expansion ({a,b}), history (!), arithmetic ($((…))).

import { minimatch } from 'minimatch'
import { lookup, resolvePath, type VDir } from '../fs/vfs'
import type { Word } from './parser'
import type { Shell } from './shell'

// Injected by registry to break circular import: expander needs to run
// command substitution, but runLine is defined in registry.ts. The registry
// calls `setSubstituteRunner` at module init.
export type Substitute = (sh: Shell, line: string) => Promise<string>
let _substitute: Substitute | null = null
export function setSubstituteRunner(fn: Substitute) { _substitute = fn }

function lookupVar(sh: Shell, name: string, positional: string[]): string {
  if (name === '?') return String(sh.lastStatus)
  if (name === '$') return '1' // fake PID
  if (/^[0-9]$/.test(name)) {
    const n = parseInt(name, 10)
    return positional[n] ?? ''
  }
  if (name === '#') return String(Math.max(0, positional.length - 1))
  return sh.env[name] ?? ''
}

// Walk the text of a segment. Replace $-expansions, emit a single string.
async function substituteSegText(
  sh: Shell,
  text: string,
  positional: string[],
  quoted: boolean,
): Promise<string> {
  let out = ''
  let i = 0
  const len = text.length
  while (i < len) {
    const c = text[i]
    if (c !== '$') { out += c; i++; continue }
    if (i + 1 >= len) { out += c; i++; continue }
    const nxt = text[i + 1]
    // $(...)
    if (nxt === '(') {
      let depth = 1
      let j = i + 2
      while (j < len && depth > 0) {
        if (text[j] === '(') depth++
        else if (text[j] === ')') depth--
        if (depth === 0) break
        j++
      }
      if (depth !== 0) throw new SyntaxError(`unterminated $(`)
      const inner = text.slice(i + 2, j)
      const result = _substitute ? await _substitute(sh, inner) : ''
      out += result.replace(/\n+$/, '')
      i = j + 1
      continue
    }
    // ${NAME}
    if (nxt === '{') {
      const close = text.indexOf('}', i + 2)
      if (close < 0) throw new SyntaxError(`unterminated \${`)
      const name = text.slice(i + 2, close)
      out += lookupVar(sh, name, positional)
      i = close + 1
      continue
    }
    // $NAME / $? / $$ / $0..9
    if (nxt === '?' || nxt === '$' || nxt === '#' || /[A-Za-z0-9_]/.test(nxt)) {
      if (/[0-9?$#]/.test(nxt)) {
        out += lookupVar(sh, nxt, positional)
        i += 2
        continue
      }
      let j = i + 1
      while (j < len && /[A-Za-z0-9_]/.test(text[j])) j++
      const name = text.slice(i + 1, j)
      out += lookupVar(sh, name, positional)
      i = j
      continue
    }
    out += c; i++
    // eslint-disable-next-line no-void
    void quoted // reserved for future behaviour differences
  }
  return out
}

// Glob against the FS. Pattern may contain / — we split, walk segment by
// segment, globbing each leaf with minimatch. Absolute vs. relative honored.
function globExpand(sh: Shell, pattern: string): string[] {
  if (!/[*?\[]/.test(pattern)) return [pattern]
  const isAbs = pattern.startsWith('/')
  const parts = pattern.split('/').filter((s) => s.length > 0 || !isAbs)
  // Start set: one "cursor" path.
  type Cursor = { path: string[] }
  let cursors: Cursor[] = [{ path: isAbs ? [] : [...sh.cwd] }]
  for (const part of parts) {
    const next: Cursor[] = []
    const isGlob = /[*?\[]/.test(part)
    for (const cur of cursors) {
      const node = lookup(cur.path)
      if (!node || node.kind !== 'dir') continue
      if (!isGlob) {
        const child = (node as VDir).children.find((c) => c.name === part)
        if (child) next.push({ path: [...cur.path, part] })
        continue
      }
      const matched = (node as VDir).children
        .filter((c) => !c.name.startsWith('.') && minimatch(c.name, part))
        .map((c) => ({ path: [...cur.path, c.name] }))
      next.push(...matched)
    }
    cursors = next
    if (cursors.length === 0) break
  }
  if (cursors.length === 0) return [pattern] // no match → literal, bash default
  if (isAbs) return cursors.map((c) => '/' + c.path.join('/'))
  // Relative glob: return paths relative to the shell's cwd, not from root.
  const cwdLen = sh.cwd.length
  return cursors.map((c) => c.path.slice(cwdLen).join('/'))
}

// Expand one Word into strings. Field-splitting on whitespace for unquoted
// expansions so `$FILES` with "a b c" becomes three args. Quoted text is
// never field-split. Globs run only on unquoted words.
export async function expandWord(
  sh: Shell,
  word: Word,
  positional: string[] = [],
): Promise<string[]> {
  // Compose into "fields" separated by unquoted whitespace from expansions.
  const parts: { text: string; quoted: boolean }[] = []
  for (const seg of word) {
    if (seg.quote === 'single') {
      parts.push({ text: seg.text, quoted: true })
      continue
    }
    const substituted = await substituteSegText(sh, seg.text, positional, seg.quote === 'double')
    parts.push({ text: substituted, quoted: seg.quote === 'double' })
  }
  // Field-split: glue parts, then split on unquoted whitespace runs.
  // We do this by walking parts char by char.
  const fields: string[] = ['']
  for (const p of parts) {
    if (p.quoted) {
      fields[fields.length - 1] += p.text
      continue
    }
    let cur = fields[fields.length - 1] ?? ''
    for (const ch of p.text) {
      if (ch === ' ' || ch === '\t' || ch === '\n') {
        if (cur.length > 0) { fields[fields.length - 1] = cur; fields.push(''); cur = '' }
      } else {
        cur += ch
      }
    }
    fields[fields.length - 1] = cur
  }
  // Drop trailing empty field if last part was unquoted whitespace.
  if (fields.length > 1 && fields[fields.length - 1] === '') fields.pop()
  // Empty-word case (e.g. ""): keep a single empty string.
  if (fields.length === 0) return ['']
  // Glob each unquoted field. Quoted fields bypass globbing because we'd
  // need per-char metadata; approximation: glob only if field contains [*?[]
  // AND no part was fully quoted. For simplicity, glob any field whose word
  // had no quoted segment. Detect: all segs of this word are unquoted.
  const anyQuoted = word.some((s) => s.quote !== 'none')
  const out: string[] = []
  for (const f of fields) {
    if (!anyQuoted) out.push(...globExpand(sh, f))
    else out.push(f)
  }
  return out
}

// Convenience: expand a tilde prefix once. Bash does this before field-split,
// but for a demo shell we handle ~ and ~/... in resolvePath itself, so we
// only need to expand a bare leading '~' that survived quoting as 'none'.
export function tildeExpand(sh: Shell, s: string): string {
  if (s === '~') return sh.env.HOME ?? '~'
  if (s.startsWith('~/')) return (sh.env.HOME ?? '~') + s.slice(1)
  return s
}

// For redirect targets: resolve a Word to a single path string, expanding and
// applying tilde. Too many args or empty → syntax error to caller.
export async function expandToPath(
  sh: Shell,
  word: Word,
  positional: string[] = [],
): Promise<string> {
  const fields = await expandWord(sh, word, positional)
  if (fields.length !== 1) throw new SyntaxError(`ambiguous redirect`)
  return tildeExpand(sh, fields[0])
}

// Re-export for external convenience.
export { resolvePath }
