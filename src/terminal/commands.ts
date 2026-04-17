import { ABOUT_TEXT, lookup, prettyPath, resolvePath, type VNode, HOME_PATH } from '../fs/vfs'

// ANSI colour helpers — xterm.js interprets these escape sequences.
const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
}

export interface Shell {
  cwd: string[]
  env: Record<string, string>
}

export function makeShell(): Shell {
  return {
    cwd: [...HOME_PATH],
    env: {
      HOME: '/home/visitor',
      USER: 'visitor',
      SHELL: '/bin/vsh',
      PATH: '/usr/local/bin:/usr/bin:/bin',
      PWD: '/home/visitor',
      TERM: 'xterm-256color',
    },
  }
}

export function prompt(sh: Shell): string {
  return `${C.green}${C.bold}visitor@gasoline${C.reset}:${C.blue}${C.bold}${prettyPath(sh.cwd)}${C.reset}$ `
}

// One line of command output uses \r\n so xterm advances and carriage-returns.
const NL = '\r\n'

// lsEntry is the flat view used by formatLs for one row.
type lsEntry = {
  kind: 'dir' | 'file'
  name: string
  mtime: string
  size: number
  exec: boolean
}

function entryFromNode(c: VNode): lsEntry {
  return {
    kind: c.kind,
    name: c.name,
    mtime: c.mtime,
    size: c.kind === 'file' ? c.size : 0,
    exec: c.kind === 'file' ? !!c.exec : false,
  }
}

function colorName(e: lsEntry): string {
  if (e.kind === 'dir') return `${C.blue}${C.bold}${e.name}${C.reset}`
  if (e.exec || e.name.endsWith('.sh')) return `${C.green}${C.bold}${e.name}${C.reset}`
  return e.name
}

function permFor(e: lsEntry): string {
  if (e.kind === 'dir') return 'drwxr-xr-x'
  return e.exec ? '-rwxr-xr-x' : '-rw-r--r--'
}

function formatLs(node: VNode, longFmt: boolean, showAll: boolean): string {
  if (node.kind === 'file') {
    const entry = entryFromNode(node)
    if (longFmt) {
      return `${C.gray}${permFor(entry)} 1 visitor visitor ${entry.size.toString().padStart(8)} ${entry.mtime}${C.reset} ${colorName(entry)}`
    }
    return colorName(entry)
  }
  // directory
  const kids: lsEntry[] = showAll
    ? [
        { kind: 'dir', name: '.', mtime: node.mtime, size: 0, exec: false },
        { kind: 'dir', name: '..', mtime: node.mtime, size: 0, exec: false },
        ...node.children.map(entryFromNode),
      ]
    : node.children.map(entryFromNode)
  if (longFmt) {
    const lines = kids.map(
      (k) =>
        `${C.gray}${permFor(k)} 1 visitor visitor ${k.size.toString().padStart(8)} ${k.mtime}${C.reset} ${colorName(k)}`,
    )
    return lines.join(NL)
  }
  return kids.map(colorName).join('  ')
}

export interface CmdResult {
  output: string
  clear?: boolean
}

export function runCommand(sh: Shell, line: string): CmdResult {
  const trimmed = line.trim()
  if (trimmed === '') return { output: '' }

  const tokens = trimmed.split(/\s+/)
  const cmd = tokens[0]
  const args = tokens.slice(1)

  // Executable dispatch: `./name` or an absolute path to an exec file.
  if (cmd.startsWith('./') || cmd.startsWith('/')) {
    return runExecutable(sh, cmd, args)
  }

  switch (cmd) {
    case 'help':
    case '?':
      return { output: helpText() }

    case 'clear':
    case 'cls':
      return { output: '', clear: true }

    case 'pwd':
      return { output: '/' + sh.cwd.join('/') }

    case 'whoami':
      return { output: 'visitor' }

    case 'about':
      return { output: ABOUT_TEXT.replace(/\n/g, NL) }

    case 'uname': {
      if (args.includes('-a')) {
        return {
          output:
            'Gasoline 1.0.0-webhome webhome #1 SMP userspace-vxlan x86_64 GNU/Linux',
        }
      }
      return { output: 'Gasoline' }
    }

    case 'echo':
      return { output: args.join(' ') }

    case 'ls':
    case 'll':
    case 'dir':
      return cmdLs(sh, cmd === 'll' ? [...args, '-l'] : args)

    case 'cat':
    case 'less':
    case 'more':
      return cmdCat(sh, args)

    case 'cd':
      return cmdCd(sh, args)

    case 'tree':
      return { output: cmdTree(lookup(sh.cwd), '') }

    case 'neofetch':
      return { output: neofetch() }

    default:
      return { output: `${C.red}${cmd}: command not found${C.reset} (try ${C.cyan}help${C.reset})` }
  }
}

function cmdLs(sh: Shell, args: string[]): CmdResult {
  let longFmt = false
  let showAll = false
  const paths: string[] = []
  for (const a of args) {
    if (a.startsWith('-')) {
      if (a.includes('l')) longFmt = true
      if (a.includes('a')) showAll = true
    } else {
      paths.push(a)
    }
  }
  if (paths.length === 0) paths.push('.')
  const blocks: string[] = []
  for (const p of paths) {
    const resolved = resolvePath(sh.cwd, p)
    const node = lookup(resolved)
    if (!node) {
      blocks.push(`${C.red}ls: ${p}: No such file or directory${C.reset}`)
      continue
    }
    if (paths.length > 1) blocks.push(`${prettyPath(resolved)}:`)
    blocks.push(formatLs(node, longFmt, showAll))
  }
  return { output: blocks.join(NL) }
}

function cmdCat(sh: Shell, args: string[]): CmdResult {
  if (args.length === 0) {
    return { output: `${C.red}cat: missing operand${C.reset}` }
  }
  const out: string[] = []
  for (const a of args) {
    const node = lookup(resolvePath(sh.cwd, a))
    if (!node) {
      out.push(`${C.red}cat: ${a}: No such file or directory${C.reset}`)
      continue
    }
    if (node.kind === 'dir') {
      out.push(`${C.red}cat: ${a}: Is a directory${C.reset}`)
      continue
    }
    // Binary file: show a pointer to the download URL instead of garbage.
    if (node.exec && !node.content) {
      out.push(
        `${C.dim}[binary] ${node.name}  (${node.size.toLocaleString()} bytes, mode 0755)${C.reset}`,
      )
      if (node.url) {
        out.push(`${C.dim}download:${C.reset} ${C.cyan}${node.url}${C.reset}`)
      }
      out.push(
        `${C.dim}run it with${C.reset} ${C.cyan}./${node.name}${C.reset}`,
      )
      continue
    }
    out.push(node.content.replace(/\n/g, NL))
  }
  return { output: out.join(NL) }
}

// runExecutable resolves `./name` or `/abs/path/name` against the VFS and
// "runs" it.  The web demo can't actually execute Linux binaries, so the
// well-known gasoline-linux-* targets produce a friendly error.
function runExecutable(sh: Shell, cmd: string, _args: string[]): CmdResult {
  const node = lookup(resolvePath(sh.cwd, cmd))
  if (!node) {
    return {
      output: `${C.red}bash: ${cmd}: No such file or directory${C.reset}`,
    }
  }
  if (node.kind !== 'file') {
    return { output: `${C.red}bash: ${cmd}: Is a directory${C.reset}` }
  }
  if (!node.exec) {
    return {
      output: `${C.red}bash: ${cmd}: Permission denied${C.reset} ${C.dim}(file is not executable; chmod +x it first)${C.reset}`,
    }
  }
  // Known Linux binaries → platform-mismatch message.
  if (/^gasoline-linux-/.test(node.name)) {
    return {
      output: [
        `${C.red}${C.bold}您所在的平台不支持${C.reset}`,
        `${C.dim}this browser terminal is a simulation — the real binary runs on Linux only.${C.reset}`,
        `${C.dim}download for your platform:${C.reset}`,
        `  ${C.cyan}${node.url ?? ''}${C.reset}`,
        '',
        `${C.dim}on Linux:${C.reset}`,
        `  ${C.yellow}wget ${node.url ?? ''}${C.reset}`,
        `  ${C.yellow}chmod +x ${node.name}${C.reset}`,
        `  ${C.yellow}./${node.name} --help${C.reset}`,
      ].join(NL),
    }
  }
  // Any other executable we claim to ship is just a stub.
  return {
    output: `${C.dim}[exec] '${node.name}' is a placeholder in this web demo.${C.reset}`,
  }
}

function cmdCd(sh: Shell, args: string[]): CmdResult {
  const target = args[0] ?? '~'
  const resolved = resolvePath(sh.cwd, target)
  const node = lookup(resolved)
  if (!node) {
    return { output: `${C.red}cd: ${target}: No such file or directory${C.reset}` }
  }
  if (node.kind !== 'dir') {
    return { output: `${C.red}cd: ${target}: Not a directory${C.reset}` }
  }
  sh.cwd = resolved
  return { output: '' }
}

function cmdTree(node: VNode | null, prefix: string): string {
  if (!node) return `${C.red}tree: no such node${C.reset}`
  if (node.kind === 'file') return node.name
  const lines: string[] = [`${C.blue}${C.bold}${node.name}${C.reset}`]
  const kids = node.children
  kids.forEach((c, i) => {
    const last = i === kids.length - 1
    const branch = last ? '└── ' : '├── '
    const sub = last ? '    ' : '│   '
    if (c.kind === 'dir') {
      const nested = cmdTree(c, prefix + sub).split(NL)
      lines.push(prefix + branch + nested[0])
      for (let j = 1; j < nested.length; j++) lines.push(prefix + sub + nested[j].slice((prefix + sub).length))
    } else {
      lines.push(prefix + branch + c.name)
    }
  })
  return lines.join(NL)
}

function helpText(): string {
  return [
    `${C.bold}Available commands${C.reset}`,
    `  ${C.cyan}ls${C.reset} [-la] [path]   list directory contents`,
    `  ${C.cyan}ll${C.reset}               alias for 'ls -l'`,
    `  ${C.cyan}cd${C.reset} <dir>          change directory`,
    `  ${C.cyan}pwd${C.reset}              print working directory`,
    `  ${C.cyan}cat${C.reset} <file>        dump file contents`,
    `  ${C.cyan}tree${C.reset}              recursive layout`,
    `  ${C.cyan}about${C.reset}            what is gasoline?`,
    `  ${C.cyan}neofetch${C.reset}         the usual brag`,
    `  ${C.cyan}echo${C.reset} <text>       echo`,
    `  ${C.cyan}whoami${C.reset}            you are 'visitor'`,
    `  ${C.cyan}uname${C.reset} [-a]        system identification`,
    `  ${C.cyan}clear${C.reset}            clear the screen`,
    `  ${C.cyan}help${C.reset}             this message`,
    '',
    `${C.dim}Hint: start with${C.reset} ${C.yellow}cat README.md${C.reset}`,
  ].join(NL)
}

function neofetch(): string {
  return [
    `${C.magenta}       .--------.${C.reset}     ${C.bold}visitor${C.reset}@${C.bold}gasoline${C.reset}`,
    `${C.magenta}      /          \\${C.reset}    ${C.dim}---------------${C.reset}`,
    `${C.magenta}     |   gasoline |${C.reset}   ${C.cyan}OS${C.reset}:        Gasoline 1.0.0-webhome`,
    `${C.magenta}      \\          /${C.reset}    ${C.cyan}Kernel${C.reset}:    userspace-vxlan`,
    `${C.magenta}       '--------'${C.reset}     ${C.cyan}Shell${C.reset}:     vsh (xterm.js)`,
    `       ${C.yellow}//${C.reset}              ${C.cyan}Terminal${C.reset}:  ${navigator.userAgent.split(' ')[0]}`,
    `      ${C.yellow}//${C.reset}               ${C.cyan}Transport${C.reset}: QUIC | TLS | TCP | UDP`,
    `     ${C.yellow}//${C.reset}                ${C.cyan}Encap${C.reset}:     VXLAN (RFC 7348)`,
    `    ${C.yellow}//${C.reset}                 ${C.cyan}Crypto${C.reset}:    ChaCha20-Poly1305`,
    `   ${C.yellow}//${C.reset}                  ${C.cyan}L2 Identity${C.reset}: VNI (24-bit) + VMAC (6 B)`,
  ].join(NL)
}
