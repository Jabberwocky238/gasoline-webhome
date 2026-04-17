// Registry + runner. Takes a line string, parses, expands, dispatches, and
// returns the merged output as a single string (xterm-ready after crlf()).
//
// Pipelines:  cmd1 | cmd2 | cmd3  →  each cmd's stdout feeds next cmd's stdin.
// Sequence:   a ; b               →  always run b.
//             a && b              →  run b only if a.exitCode === 0.
//             a || b              →  run b only if a.exitCode !== 0.
// Redirects:  >  truncate-write last cmd's stdout to file.
//             >> append.
//             <  feed file contents to first cmd's stdin.

import {
  parse,
  type Pipeline,
  type SimpleCmd,
  type Sequence,
} from './parser'
import {
  expandToPath,
  expandWord,
  setSubstituteRunner,
} from './expander'
import { makeCtx, type Ctx } from './context'
import type { Shell } from './shell'
import { C, errLine, crlf } from './ansi'
import {
  lookup,
  readFile,
  resolvePath,
  writeContent,
  appendContent,
  VfsError,
  errnoPhrase,
} from '../fs/vfs'

// A command is an async function over Ctx. Commands live in cmds/*.ts.
export type CommandFn = (ctx: Ctx) => Promise<void> | void

const TABLE = new Map<string, CommandFn>()

export function registerCommand(name: string, fn: CommandFn) {
  TABLE.set(name, fn)
}
export function registerAliases(src: string, aliases: string[]) {
  const fn = TABLE.get(src)
  if (!fn) throw new Error(`alias target missing: ${src}`)
  for (const a of aliases) TABLE.set(a, fn)
}
export function getCommand(name: string): CommandFn | undefined {
  return TABLE.get(name)
}

// ---------------- exec dispatch ----------------
// ./name or /abs/path → load file and run its content as a script.
// The exec command itself is registered under '__exec__' and invoked here.

export async function runExec(sh: Shell, path: string, args: string[]): Promise<{ out: string; status: number }> {
  const resolved = resolvePath(sh.cwd, path)
  const node = lookup(resolved)
  if (!node) {
    return { out: `${C.red}bash: ${path}: No such file or directory${C.reset}\n`, status: 127 }
  }
  if (node.kind !== 'file') {
    return { out: errLine('bash', path, 'Is a directory') + '\n', status: 126 }
  }
  // exec bit: owner/group/other × x
  if ((node.mode & 0o111) === 0) {
    return { out: errLine('bash', path, 'Permission denied') + '\n', status: 126 }
  }
  // Linux-only release binaries: friendly platform message.
  if (node.extPlatform) {
    const NL = '\n'
    const url = node.url ?? ''
    return {
      out:
        `${C.red}${C.bold}您所在的平台不支持${C.reset}${NL}` +
        `${C.dim}this browser terminal is a simulation — the real binary runs on Linux only.${C.reset}${NL}` +
        `${C.dim}download for your platform:${C.reset}${NL}` +
        `  ${C.cyan}${url}${C.reset}${NL}${NL}` +
        `${C.dim}on Linux:${C.reset}${NL}` +
        `  ${C.yellow}wget ${url}${C.reset}${NL}` +
        `  ${C.yellow}chmod +x ${node.name}${C.reset}${NL}` +
        `  ${C.yellow}./${node.name} --help${C.reset}${NL}`,
      status: 0,
    }
  }
  if (node.binBuiltin) {
    return { out: `${C.dim}[exec] '${node.name}' is a placeholder in this web demo.${C.reset}\n`, status: 0 }
  }
  const text = await readFile(node)
  return runScript(sh, text, [path, ...args])
}

// runScript: walk each logical line, run it, accumulate output. `positional`
// is argv as seen from within the script (so $0 is the script name, $1 etc).
export async function runScript(
  sh: Shell,
  source: string,
  positional: string[],
): Promise<{ out: string; status: number }> {
  // Join \<newline> into one logical line per the parser's own rule, but we
  // still need to split on \n for script execution.
  const joined = source.replace(/\\\r?\n/g, '')
  const lines = joined.split('\n')
  let out = ''
  let status = 0
  // Push positional params; restore at end.
  const saved = { ...sh.env }
  positional.forEach((p, idx) => { sh.env[String(idx)] = p })
  try {
    for (const raw of lines) {
      const line = raw.replace(/^\s+|\s+$/g, '')
      if (!line || line.startsWith('#')) continue
      const r = await runLine(sh, line, { positional })
      out += r.out
      status = r.status
    }
  } finally {
    // only restore the numeric slots we set — user exports should persist
    for (let i = 0; i < positional.length; i++) {
      if (saved[String(i)] === undefined) delete sh.env[String(i)]
      else sh.env[String(i)] = saved[String(i)]
    }
  }
  return { out, status }
}

// ---------------- one logical line ----------------

export async function runLine(
  sh: Shell,
  line: string,
  opts: { positional?: string[] } = {},
): Promise<{ out: string; status: number }> {
  const positional = opts.positional ?? []
  let seq: Sequence
  try {
    seq = parse(line)
  } catch (e) {
    return { out: `${C.red}bash: syntax error: ${(e as Error).message}${C.reset}\n`, status: 2 }
  }
  let out = ''
  let status = 0
  for (let i = 0; i < seq.pipelines.length; i++) {
    const prevConn = i === 0 ? null : seq.connectors[i - 1]
    if (prevConn === '&&' && status !== 0) continue
    if (prevConn === '||' && status === 0) continue
    const r = await runPipeline(sh, seq.pipelines[i], positional)
    out += r.out
    status = r.status
    sh.lastStatus = status
    sh.env['?'] = String(status)
  }
  return { out, status }
}

async function runPipeline(
  sh: Shell,
  pipeline: Pipeline,
  positional: string[],
): Promise<{ out: string; status: number }> {
  let stdin = ''
  let aggregated = ''
  let status = 0
  for (let i = 0; i < pipeline.cmds.length; i++) {
    const cmd = pipeline.cmds[i]
    const isLast = i === pipeline.cmds.length - 1
    const r = await runSimple(sh, cmd, stdin, positional, /*tailOfPipe*/ isLast)
    status = r.status
    if (isLast) aggregated += r.stderr + r.stdout
    else aggregated += r.stderr
    stdin = r.stdout
  }
  return { out: aggregated, status }
}

// Run one simple command. Handles assignments, redirects, builtin vs exec
// dispatch. `tailOfPipe` = this is the last cmd in a pipeline — only then
// does > / >> apply; mid-pipe redirects would swallow the connection.
async function runSimple(
  sh: Shell,
  cmd: SimpleCmd,
  stdin: string,
  positional: string[],
  tailOfPipe: boolean,
): Promise<{ stdout: string; stderr: string; status: number }> {
  // Apply assignments. If no command follows, they persist (export-free in
  // bash is technically just "set"; we put them in env for simplicity).
  const hasCmd = cmd.words.length > 0
  const envBackup: Record<string, string | undefined> = {}
  try {
    for (const a of cmd.assigns) {
      const fields = await expandWord(sh, a.value, positional)
      const v = fields.join(' ')
      if (hasCmd) envBackup[a.name] = sh.env[a.name]
      sh.env[a.name] = v
    }
    if (!hasCmd) {
      return { stdout: '', stderr: '', status: 0 }
    }
    // Expand argv.
    const argv: string[] = []
    for (const w of cmd.words) argv.push(...(await expandWord(sh, w, positional)))
    if (argv.length === 0) return { stdout: '', stderr: '', status: 0 }

    // Handle input redirect first — it replaces stdin.
    let effectiveStdin = stdin
    for (const r of cmd.redirects) {
      if (r.op === '<') {
        const path = await expandToPath(sh, r.target, positional)
        const node = lookup(resolvePath(sh.cwd, path))
        if (!node) {
          return { stdout: '', stderr: errLine('bash', path, 'No such file or directory') + '\n', status: 1 }
        }
        if (node.kind !== 'file') {
          return { stdout: '', stderr: errLine('bash', path, 'Is a directory') + '\n', status: 1 }
        }
        effectiveStdin = await readFile(node)
      }
    }

    // Dispatch.
    let stdoutBuf = ''
    let stderrBuf = ''
    const name = argv[0]
    const args = argv.slice(1)
    let status = 0
    if (name.startsWith('./') || name.startsWith('/')) {
      const r = await runExec(sh, name, args)
      stdoutBuf = r.out
      status = r.status
    } else {
      const fn = TABLE.get(name)
      if (!fn) {
        stderrBuf = `${C.red}${name}: command not found${C.reset}\n`
        status = 127
      } else {
        const ctx = makeCtx({
          shell: sh,
          name,
          args,
          stdin: effectiveStdin,
          stdout: (s) => { stdoutBuf += s },
          stderr: (s) => { stderrBuf += s },
        })
        try {
          await fn(ctx)
          status = ctx.exitCode
        } catch (e) {
          if (e instanceof VfsError) {
            stderrBuf += errLine(name, e.path, errnoPhrase(e.code)) + '\n'
          } else {
            stderrBuf += `${C.red}${name}: ${(e as Error).message}${C.reset}\n`
          }
          status = 1
        }
      }
    }

    // Apply output redirects (last write wins). Only the tail of a pipeline
    // honors > / >> — mid-pipe redirects would break the connection.
    if (tailOfPipe) {
      for (const r of cmd.redirects) {
        if (r.op !== '>' && r.op !== '>>') continue
        const path = await expandToPath(sh, r.target, positional)
        try {
          const resolved = resolvePath(sh.cwd, path)
          if (r.op === '>') writeContent(sh.user, resolved, stdoutBuf)
          else await appendContent(sh.user, resolved, stdoutBuf)
          stdoutBuf = '' // redirected — don't also print to terminal
        } catch (e) {
          if (e instanceof VfsError) {
            stderrBuf += errLine('bash', path, errnoPhrase(e.code)) + '\n'
          } else {
            stderrBuf += `${C.red}bash: ${path}: ${(e as Error).message}${C.reset}\n`
          }
          status = 1
        }
      }
    }

    return { stdout: stdoutBuf, stderr: stderrBuf, status }
  } finally {
    if (hasCmd) {
      for (const k of Object.keys(envBackup)) {
        if (envBackup[k] === undefined) delete sh.env[k]
        else sh.env[k] = envBackup[k]!
      }
    }
  }
}

// Wire expander's command-substitution back-reference once the runner exists.
setSubstituteRunner(async (sh, inner) => {
  const r = await runLine(sh, inner)
  return r.out.replace(/\x1b\[[0-9;]*m/g, '') // strip ANSI for substitution
})

// Convenience for Terminal.tsx — produces a single xterm-ready blob.
export async function runForTerminal(sh: Shell, line: string): Promise<string> {
  const r = await runLine(sh, line)
  return crlf(r.out).replace(/\r?\n$/, '') // trim one trailing newline
}
