// Mini-bash parser.
//
//   line  := seq
//   seq   := pipeline ( (';' | '&&' | '||') pipeline )*
//   pipe  := simple ( '|' simple )*
//   simple := (ASSIGN* WORD (WORD | REDIR)* )       // empty cmd ⇒ just env-apply
//   REDIR := ('>' | '>>' | '<') WORD
//
// Supports:
//   - "double" and 'single' quoted words
//   - \-escape of the next char (outside single quotes)
//   - trailing '\' joins the next line (handled by preprocess())
//   - inline comments starting with '#' at a word boundary
//
// Does NOT support: heredoc (<<), process substitution, subshells, background &.

export type Op = '|' | '&&' | '||' | ';' | '>' | '>>' | '<'

// Segments of a word carry a quote flag so the expander knows whether to
// honor $var / $() inside (double-quoted: yes, single-quoted: no).
export type WordSeg = { text: string; quote: 'none' | 'single' | 'double' }
export type Word = WordSeg[]

export interface Redirect {
  op: '>' | '>>' | '<'
  target: Word
}

export interface SimpleCmd {
  assigns: { name: string; value: Word }[]
  words: Word[]
  redirects: Redirect[]
}

export interface Pipeline {
  cmds: SimpleCmd[]
}

export interface Sequence {
  pipelines: Pipeline[]
  connectors: Array<'&&' | '||' | ';'>
}

// ---------------- line preprocessing ----------------

// Fold `\<newline>` into nothing so multi-line scripts read as one logical line.
export function joinContinuations(src: string): string {
  return src.replace(/\\\r?\n/g, '')
}

// ---------------- tokenizer ----------------

type Token =
  | { kind: 'word'; word: Word }
  | { kind: 'op'; op: Op }

const OP_CHARS = new Set(['|', '&', ';', '>', '<'])

function isWordBoundary(c: string) {
  return c === ' ' || c === '\t' || OP_CHARS.has(c)
}

function tokenize(line: string): Token[] {
  const out: Token[] = []
  let i = 0
  const len = line.length
  while (i < len) {
    const c = line[i]
    if (c === ' ' || c === '\t') { i++; continue }
    // comment to end-of-line
    if (c === '#' && (i === 0 || isWordBoundary(line[i - 1]))) break
    // operators
    if (c === '|') {
      if (line[i + 1] === '|') { out.push({ kind: 'op', op: '||' }); i += 2 }
      else                     { out.push({ kind: 'op', op: '|' });  i += 1 }
      continue
    }
    if (c === '&') {
      if (line[i + 1] === '&') { out.push({ kind: 'op', op: '&&' }); i += 2; continue }
      // bare '&' not supported — treat as syntax error by injecting a token
      // the parser will reject; simplest is to throw here.
      throw new SyntaxError(`unexpected '&' (background jobs unsupported)`)
    }
    if (c === ';') { out.push({ kind: 'op', op: ';' }); i++; continue }
    if (c === '>') {
      if (line[i + 1] === '>') { out.push({ kind: 'op', op: '>>' }); i += 2 }
      else                     { out.push({ kind: 'op', op: '>' });  i += 1 }
      continue
    }
    if (c === '<') { out.push({ kind: 'op', op: '<' }); i++; continue }
    // word
    const [word, next] = readWord(line, i)
    out.push({ kind: 'word', word })
    i = next
  }
  return out
}

function readWord(line: string, start: number): [Word, number] {
  const segs: WordSeg[] = []
  let buf = ''
  let quote: 'none' | 'single' | 'double' = 'none'
  const flush = () => { if (buf.length > 0 || segs.length === 0) { segs.push({ text: buf, quote }); buf = '' } }
  let i = start
  const len = line.length
  while (i < len) {
    const c = line[i]
    if (quote === 'none') {
      if (c === ' ' || c === '\t') break
      if (OP_CHARS.has(c)) break
      if (c === "'") { flush(); quote = 'single'; buf = ''; i++; continue }
      if (c === '"') { flush(); quote = 'double'; buf = ''; i++; continue }
      if (c === '\\' && i + 1 < len) { buf += line[i + 1]; i += 2; continue }
      buf += c; i++; continue
    }
    if (quote === 'single') {
      if (c === "'") { segs.push({ text: buf, quote: 'single' }); buf = ''; quote = 'none'; i++; continue }
      buf += c; i++; continue
    }
    // double
    if (c === '"') { segs.push({ text: buf, quote: 'double' }); buf = ''; quote = 'none'; i++; continue }
    if (c === '\\' && i + 1 < len) {
      const nxt = line[i + 1]
      // In double quotes only \$ \` \" \\ \newline escape — other \x stays as \x.
      if (nxt === '$' || nxt === '`' || nxt === '"' || nxt === '\\') {
        buf += nxt; i += 2; continue
      }
      buf += c; i++; continue
    }
    buf += c; i++; continue
  }
  if (quote !== 'none') throw new SyntaxError(`unterminated ${quote} quote`)
  flush()
  // Drop a trailing empty unquoted segment unless it's the whole word (empty string).
  const nonEmpty = segs.filter((s) => s.text !== '' || s.quote !== 'none')
  return [nonEmpty.length ? nonEmpty : segs, i]
}

// ---------------- grammar ----------------

// Is this word a plausible NAME=VALUE prefix? NAME must match [A-Za-z_][A-Za-z0-9_]*
// and the first segment must be unquoted up to the `=`.
function splitAssign(word: Word): { name: string; value: Word } | null {
  if (word.length === 0) return null
  const first = word[0]
  if (first.quote !== 'none') return null
  const eq = first.text.indexOf('=')
  if (eq <= 0) return null
  const name = first.text.slice(0, eq)
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return null
  const rest = first.text.slice(eq + 1)
  const valueSegs: WordSeg[] = []
  if (rest.length > 0) valueSegs.push({ text: rest, quote: 'none' })
  for (let i = 1; i < word.length; i++) valueSegs.push(word[i])
  if (valueSegs.length === 0) valueSegs.push({ text: '', quote: 'none' })
  return { name, value: valueSegs }
}

function parseSimple(tokens: Token[], i: number): [SimpleCmd | null, number] {
  const cmd: SimpleCmd = { assigns: [], words: [], redirects: [] }
  let sawAssignOnly = true
  while (i < tokens.length) {
    const t = tokens[i]
    if (t.kind === 'op') {
      if (t.op === '>' || t.op === '>>' || t.op === '<') {
        const nxt = tokens[i + 1]
        if (!nxt || nxt.kind !== 'word') throw new SyntaxError(`expected filename after '${t.op}'`)
        cmd.redirects.push({ op: t.op, target: nxt.word })
        i += 2
        continue
      }
      break // pipeline / seq separator
    }
    // word
    if (sawAssignOnly) {
      const a = splitAssign(t.word)
      if (a) { cmd.assigns.push(a); i++; continue }
      sawAssignOnly = false
    }
    cmd.words.push(t.word)
    i++
  }
  if (cmd.assigns.length === 0 && cmd.words.length === 0 && cmd.redirects.length === 0) {
    return [null, i]
  }
  return [cmd, i]
}

function parsePipeline(tokens: Token[], i: number): [Pipeline, number] {
  const cmds: SimpleCmd[] = []
  const [first, j] = parseSimple(tokens, i)
  if (!first) throw new SyntaxError(`expected command`)
  cmds.push(first)
  let k = j
  while (k < tokens.length && tokens[k].kind === 'op' && (tokens[k] as any).op === '|') {
    k++
    const [next, m] = parseSimple(tokens, k)
    if (!next) throw new SyntaxError(`expected command after '|'`)
    cmds.push(next)
    k = m
  }
  return [{ cmds }, k]
}

export function parse(line: string): Sequence {
  const tokens = tokenize(joinContinuations(line))
  const seq: Sequence = { pipelines: [], connectors: [] }
  let i = 0
  while (i < tokens.length) {
    const [pl, j] = parsePipeline(tokens, i)
    seq.pipelines.push(pl)
    i = j
    if (i >= tokens.length) break
    const t = tokens[i]
    if (t.kind !== 'op') throw new SyntaxError(`unexpected token`)
    if (t.op !== '&&' && t.op !== '||' && t.op !== ';') {
      throw new SyntaxError(`unexpected '${t.op}'`)
    }
    seq.connectors.push(t.op)
    i++
  }
  return seq
}
