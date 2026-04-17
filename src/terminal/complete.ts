// TAB completion. Pure function of (shell, line, cursor) → new line + cursor,
// plus an optional list of ambiguous options the caller should display.
//
// Two modes, decided by what precedes the token under the cursor:
//   - command position (start of line, or after | && || ;) and no '/' in
//     the token  →  match against registered command names
//   - otherwise                                           →  match against
//     directory entries of the token's parent path
//
// Single match: insert the remainder + a trailing space (or keep the '/' if
// the match is a directory, so the user can keep typing).
// Multiple matches: extend to the common prefix; if nothing new to insert,
// return them as `list` so the caller can print them above the prompt.

import { listCommands } from './registry'
import { lookup, resolvePath, type VDir } from '../fs/vfs'
import type { Shell } from './shell'

export interface CompletionResult {
  newLine: string
  newCursor: number
  list?: string[]
}

export function complete(sh: Shell, line: string, cursor: number): CompletionResult {
  const left = line.slice(0, cursor)
  // Current token = span of non-whitespace / non-operator chars ending at cursor.
  let s = cursor
  while (s > 0) {
    const c = left[s - 1]
    if (c === ' ' || c === '\t') break
    // Operators end a token too. Cheap check; the parser is the source of truth.
    if (c === '|' || c === '&' || c === ';') break
    s--
  }
  const token = left.slice(s)
  const beforeTrim = left.slice(0, s).replace(/\s+$/, '')
  const isCmdPos =
    beforeTrim === '' ||
    /[|;]$/.test(beforeTrim) ||
    beforeTrim.endsWith('&&') ||
    beforeTrim.endsWith('||')

  const doCommand = isCmdPos && !token.includes('/')
  const options = doCommand ? commandCompletions(token) : pathCompletions(sh, token)
  if (options.length === 0) return { newLine: line, newCursor: cursor }

  const anchor = doCommand ? token : tailOf(token)
  const cp = commonPrefix(options)
  let newLine = line
  let newCursor = cursor
  if (cp.length > anchor.length) {
    const ext = cp.slice(anchor.length)
    newLine = line.slice(0, cursor) + ext + line.slice(cursor)
    newCursor = cursor + ext.length
  }
  if (options.length === 1) {
    const only = options[0]
    // Directory: leave the '/' so the user can keep typing into it.
    // Everything else: append a space.
    if (!only.endsWith('/')) {
      newLine = newLine.slice(0, newCursor) + ' ' + newLine.slice(newCursor)
      newCursor++
    }
  }
  const res: CompletionResult = { newLine, newCursor }
  if (options.length > 1 && cp.length === anchor.length) {
    // Nothing to extend and multiple choices — surface them.
    res.list = options
  }
  return res
}

function tailOf(token: string): string {
  const slash = token.lastIndexOf('/')
  return slash < 0 ? token : token.slice(slash + 1)
}

function commonPrefix(strs: string[]): string {
  if (strs.length === 0) return ''
  let p = strs[0]
  for (let i = 1; i < strs.length; i++) {
    while (p.length > 0 && !strs[i].startsWith(p)) p = p.slice(0, -1)
    if (!p) return ''
  }
  return p
}

function commandCompletions(prefix: string): string[] {
  return listCommands().filter((n) => n.startsWith(prefix)).sort()
}

function pathCompletions(sh: Shell, token: string): string[] {
  let dirPart: string
  let filePart: string
  const slash = token.lastIndexOf('/')
  if (slash < 0) {
    dirPart = '.'
    filePart = token
  } else {
    dirPart = token.slice(0, slash) || '/'
    filePart = token.slice(slash + 1)
  }
  const resolved = resolvePath(sh.cwd, dirPart)
  const node = lookup(resolved)
  if (!node || node.kind !== 'dir') return []
  const hidden = filePart.startsWith('.')
  return (node as VDir).children
    .filter((c) => c.name.startsWith(filePart))
    .filter((c) => hidden || !c.name.startsWith('.'))
    .map((c) => (c.kind === 'dir' ? c.name + '/' : c.name))
    .sort()
}
