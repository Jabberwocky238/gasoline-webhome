// Gasoline CLI simulator.  Mirrors the real binary's behaviour enough that
// users see meaningful errors: missing subcommand, unknown flag, invalid
// config. Only once flags + config are valid does it fall through to the
// "platform not supported" stub (the real binary is a Linux amd64/arm64
// executable we cannot run in the browser).
//
// Sourced from ../gasoline/main.go and common/flags.go behaviour:
//   gasoline <operator|client> [flags]
//
// Operator flags (subset):
//   --config <path>
//   --enable-fswatch    --watch-vni <dir>
//   --enable-sigreload
//   --enable-k8s
//   --listen <addr>
//
// Client flags (subset):
//   --config <path>
//   --server <addr>
//   --vni <n>
//   --transport <udp|tcp|tls|quic>

import { readFile, lookup, resolvePath, type VFile } from '../fs/vfs'
import type { Shell } from './shell'
import { C } from './ansi'

const USAGE = `Usage: gasoline <operator|client> [flags]\n`

export async function runGasoline(
  sh: Shell,
  args: string[],
): Promise<{ out: string; status: number }> {
  if (args.length === 0) return { out: USAGE, status: 1 }
  const sub = args[0]
  if (sub !== 'operator' && sub !== 'client') {
    return { out: `gasoline: unknown subcommand '${sub}'\n${USAGE}`, status: 1 }
  }
  const rest = args.slice(1)
  const flags = parseFlags(rest, sub)
  if ('error' in flags) return { out: flags.error, status: 2 }

  if (flags.config) {
    const configPath = resolvePath(sh.cwd, flags.config)
    const cfgNode = lookup(configPath)
    if (!cfgNode) {
      return { out: redErr(`failed to read config ${flags.config}: no such file or directory`), status: 1 }
    }
    if (cfgNode.kind !== 'file') {
      return { out: redErr(`failed to read config ${flags.config}: is a directory`), status: 1 }
    }
    const text = await readFile(cfgNode as VFile)
    const err = validateYamlish(text, sub)
    if (err) return { out: redErr(`config parse error: ${err}`), status: 1 }
  }

  // Operator needs --watch-vni when fswatch/sigreload/k8s is enabled.
  if (sub === 'operator') {
    if ((flags.enableFswatch || flags.enableSigreload) && !flags.watchVni) {
      return {
        out: redErr('--enable-fswatch / --enable-sigreload requires --watch-vni=<dir>'),
        status: 1,
      }
    }
    if (flags.enableK8s && !flags.k8sNamespace) {
      return { out: redErr('k8s reloader: $POD_NAMESPACE not set'), status: 1 }
    }
  }

  // All CLI-level validation passed. Fall back to the platform-mismatch
  // message — the user's config is OK, but we still can't execute the
  // Linux binary here.
  return {
    out:
      `${C.red}${C.bold}the real gasoline binary is Linux-only — this demo is a browser shell.${C.reset}\n` +
      `${C.dim}your ${sub} configuration parsed OK; on a Linux box you'd now run:${C.reset}\n` +
      `  ${C.yellow}gasoline ${sub}${flagSummary(flags)}${C.reset}\n`,
    status: 0,
  }
}

interface ParsedFlags {
  config?: string
  enableFswatch?: boolean
  enableSigreload?: boolean
  enableK8s?: boolean
  watchVni?: string
  k8sNamespace?: string
  listen?: string
  server?: string
  vni?: string
  transport?: string
}

function parseFlags(rest: string[], sub: 'operator' | 'client'): ParsedFlags | { error: string } {
  const out: ParsedFlags = {}
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]
    if (!a.startsWith('-')) return { error: `gasoline ${sub}: unexpected positional argument '${a}'\n` }
    const eq = a.indexOf('=')
    let name: string, val: string | undefined
    if (eq >= 0) { name = a.slice(0, eq); val = a.slice(eq + 1) }
    else         { name = a;              val = undefined }
    const take = (): string | undefined => {
      if (val !== undefined) return val
      if (i + 1 >= rest.length) return undefined
      i++; return rest[i]
    }
    switch (name) {
      case '--config':         out.config = take(); break
      case '--enable-fswatch': out.enableFswatch = true; break
      case '--enable-sigreload': out.enableSigreload = true; break
      case '--enable-k8s':     out.enableK8s = true; break
      case '--watch-vni':      out.watchVni = take(); break
      case '--k8s-namespace':  out.k8sNamespace = take(); break
      case '--listen':         out.listen = take(); break
      case '--server':         out.server = take(); break
      case '--vni':            out.vni = take(); break
      case '--transport':      out.transport = take(); break
      default:
        return { error: `gasoline ${sub}: unknown flag '${name}'\n` }
    }
  }
  return out
}

// Very loose YAML-ish validator: indentation must be consistent, colons
// must have keys, unclosed brackets detected.  Enough to catch the common
// typo and emit a line number the user can fix.
function validateYamlish(text: string, _sub: 'operator' | 'client'): string | null {
  const lines = text.split('\n')
  let inBlock = false
  let blockChar = ''
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const stripped = raw.replace(/#.*$/, '').replace(/\s+$/, '')
    if (!stripped.trim()) continue
    // tab indentation is invalid in YAML
    if (/^\t/.test(raw)) return `line ${i + 1}: tabs not allowed for indentation`
    // track bracket balance for inline JSON-ish values
    for (const ch of stripped) {
      if (ch === '{' || ch === '[') { inBlock = true; blockChar = ch }
      if (ch === '}' || ch === ']') inBlock = false
    }
    if (!inBlock && /:[^\s]/.test(stripped) && !/https?:\/\//.test(stripped)) {
      return `line ${i + 1}: missing space after ':'`
    }
    // scalar line at zero indent, no colon -> stray literal
    if (/^[a-zA-Z]/.test(raw) && !stripped.includes(':')) {
      return `line ${i + 1}: expected key-value, got '${stripped}'`
    }
  }
  if (inBlock) return `unclosed '${blockChar}' block`
  return null
}

function redErr(msg: string): string {
  return `${C.red}error:${C.reset} ${msg}\n`
}

function flagSummary(f: ParsedFlags): string {
  const out: string[] = []
  if (f.config)       out.push(`--config=${f.config}`)
  if (f.watchVni)     out.push(`--watch-vni=${f.watchVni}`)
  if (f.server)       out.push(`--server=${f.server}`)
  if (f.vni)          out.push(`--vni=${f.vni}`)
  if (f.transport)    out.push(`--transport=${f.transport}`)
  return out.length ? ' ' + out.join(' ') : ''
}
