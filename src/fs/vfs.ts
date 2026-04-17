// Virtual filesystem for the gasoline webhome terminal.
//
// Design:
//   - Text files live at real HTTP paths under `public/`, so `cat README.md`
//     fetches `/home/visitor/README.md`. Content is cached after first read.
//   - Binary files (release artifacts, /bin/ stubs) never fetch — they're
//     stub-displayed by `cat`.
//   - Every node has a (uid, gid, mode) triple, mirroring Unix semantics so
//     visitor can read but not modify jabberwocky238's files.
//   - Mutation API (touch/mkdir/unlink/rmdir/rmTree/writeContent) gates
//     every write through `hasPerm` and throws typed `VfsError` on failure.

// ---------------- users & groups ----------------

export interface UserId {
  uid: number
  gid: number
  name: string
  group: string
  groups?: number[] // supplementary groups
}

export const USERS: Record<string, UserId> = {
  root:          { uid: 0,    gid: 0,    name: 'root',           group: 'root' },
  jabberwocky238:{ uid: 1000, gid: 1000, name: 'jabberwocky238', group: 'jabberwocky238' },
  visitor:       { uid: 1001, gid: 1001, name: 'visitor',        group: 'visitor' },
  bin:           { uid: 2,    gid: 2,    name: 'bin',            group: 'bin' },
}

const UID_NAME = new Map<number, string>()
const GID_NAME = new Map<number, string>()
for (const u of Object.values(USERS)) {
  UID_NAME.set(u.uid, u.name)
  GID_NAME.set(u.gid, u.group)
}

export const uidName = (uid: number) => UID_NAME.get(uid) ?? String(uid)
export const gidName = (gid: number) => GID_NAME.get(gid) ?? String(gid)

// Unix-style permission check. mode bits: 0o400 r 0o200 w 0o100 x (owner);
// 0o040/020/010 (group); 0o004/002/001 (other).
export type PermOp = 'r' | 'w' | 'x'
export function hasPerm(user: UserId, node: VNode, op: PermOp): boolean {
  if (user.uid === 0) return true // root bypass
  const bit = op === 'r' ? 4 : op === 'w' ? 2 : 1
  let shift: number
  if (user.uid === node.uid) shift = 6
  else if (user.gid === node.gid || user.groups?.includes(node.gid)) shift = 3
  else shift = 0
  return (node.mode & (bit << shift)) !== 0
}

// ---------------- error type ----------------

// Unix-style errno codes. Commands map these to the usual error strings.
export type VfsErrno =
  | 'ENOENT'
  | 'EACCES'
  | 'EEXIST'
  | 'EISDIR'
  | 'ENOTDIR'
  | 'ENOTEMPTY'
  | 'EPERM'
  | 'EINVAL'

export class VfsError extends Error {
  code: VfsErrno
  path: string
  constructor(code: VfsErrno, path: string, msg?: string) {
    super(msg ?? `${code}: ${path}`)
    this.name = 'VfsError'
    this.code = code
    this.path = path
  }
}

// Short phrase a command prints after "cmd: path: ".
export function errnoPhrase(code: VfsErrno): string {
  switch (code) {
    case 'ENOENT':    return 'No such file or directory'
    case 'EACCES':    return 'Permission denied'
    case 'EEXIST':    return 'File exists'
    case 'EISDIR':    return 'Is a directory'
    case 'ENOTDIR':   return 'Not a directory'
    case 'ENOTEMPTY': return 'Directory not empty'
    case 'EPERM':     return 'Operation not permitted'
    case 'EINVAL':    return 'Invalid argument'
  }
}

// ---------------- filesystem types ----------------

export type VFile = {
  kind: 'file'
  name: string
  size: number           // bytes (for ls -l); recomputed on content change
  mtime: string
  uid: number
  gid: number
  mode: number           // 0o644, 0o755, ...
  url?: string           // fetchable content URL (public/) or external download
  content?: string       // in-memory content; authoritative once set
  binBuiltin?: boolean   // /bin/ stub: cat shows "builtin executable program"
  extPlatform?: boolean  // release binary: running → "platform not supported"
}

export type VDir = {
  kind: 'dir'
  name: string
  mtime: string
  uid: number
  gid: number
  mode: number
  children: VNode[]
}

export type VNode = VFile | VDir

// ---------------- constructors ----------------

const JABBER = USERS.jabberwocky238
const ROOT_USER = USERS.root

const nowStamp = () => {
  const d = new Date()
  const p = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

// f: text file under public/, owned by jabberwocky238, mode 0644.
const f = (
  name: string,
  url: string,
  size: number,
  mtime = '2026-04-17 15:00',
): VFile => ({
  kind: 'file',
  name,
  size,
  mtime,
  uid: JABBER.uid,
  gid: JABBER.gid,
  mode: 0o644,
  url,
})

// x: release binary stub — external download URL, non-runnable in browser.
const x = (
  name: string,
  size: number,
  url: string,
  mtime = '2026-04-14 12:00',
): VFile => ({
  kind: 'file',
  name,
  size,
  mtime,
  uid: JABBER.uid,
  gid: JABBER.gid,
  mode: 0o755,
  url,
  extPlatform: true,
})

// b: /bin/ builtin stub — cat says "builtin executable program".
const b = (name: string, size = 16_384, mtime = '2026-04-01 09:00'): VFile => ({
  kind: 'file',
  name,
  size,
  mtime,
  uid: ROOT_USER.uid,
  gid: ROOT_USER.gid,
  mode: 0o755,
  binBuiltin: true,
})

// d: directory with the given owner (defaults to jabberwocky238).
const d = (
  name: string,
  children: VNode[],
  owner: UserId = JABBER,
  mode = 0o755,
  mtime = '2026-04-17 15:00',
): VDir => ({
  kind: 'dir',
  name,
  mtime,
  uid: owner.uid,
  gid: owner.gid,
  mode,
  children,
})

// ---------------- /bin/ population ----------------

// Every builtin also has a file in /bin/ so `ls /bin` shows them as exec.
export const BUILTINS = [
  'ls', 'll', 'dir', 'cat', 'less', 'more', 'head', 'tail',
  'cd', 'pwd', 'whoami', 'id', 'tree', 'clear', 'cls',
  'echo', 'uname', 'env', 'export', 'history',
  'about', 'help', 'neofetch',
  'grep', 'sed', 'man', 'touch', 'rm', 'mkdir', 'rmdir',
  'bash', 'sh', 'true', 'false',
] as const

const BIN_CHILDREN: VNode[] = BUILTINS.map((n) => b(n))

// ---------------- /home/visitor content map ----------------
const P = '/home/visitor'
const PUB_HELLO  = `${P}/hello.sh`

// ---------------- root tree ----------------

export const ROOT: VDir = d('/', [
  d('bin', BIN_CHILDREN, ROOT_USER),
  d('usr', [
    d('bin', BIN_CHILDREN.slice(), ROOT_USER),
    d('local', [d('bin', [], ROOT_USER)], ROOT_USER),
    d('share', [d('man', [d('man1', [], ROOT_USER)], ROOT_USER)], ROOT_USER),
  ], ROOT_USER),
  d('etc', [], ROOT_USER),
  d('tmp', [], ROOT_USER, 0o777),
  d('root', [], ROOT_USER, 0o700),
  d('home', [
    d('jabberwocky238', [], JABBER, 0o750),
    d('visitor', [
      f('README.md',        `${P}/README.md`,        600),
      f('architecture.txt', `${P}/architecture.txt`, 1700),
      f('features.md',      `${P}/features.md`,      900),
      f('quickstart.sh',    `${P}/quickstart.sh`,    700),
      f('hello.sh',         PUB_HELLO,               380),
      f('about.txt',        `${P}/about.txt`,        700),
      x('gasoline-linux-amd64', 28_456_912,
        'https://github.com/Jabberwocky238/gasoline/releases/download/Beta0.1.0/gasoline-linux-amd64'),
      x('gasoline-linux-arm64', 28_102_432,
        'https://github.com/Jabberwocky238/gasoline/releases/download/Beta0.1.0/gasoline-linux-arm64'),
      d('transport', [
        f('udp.md',  `${P}/transport/udp.md`,  620),
        f('tcp.md',  `${P}/transport/tcp.md`,  520),
        f('tls.md',  `${P}/transport/tls.md`,  380),
        f('quic.md', `${P}/transport/quic.md`, 440),
      ]),
      d('protocol', [
        f('handshake.md', `${P}/protocol/handshake.md`, 700),
        f('vxlan.md',     `${P}/protocol/vxlan.md`,     800),
      ]),
      d('demo', [
        f('client.yaml',   `${P}/demo/client.yaml`,   220),
        f('operator.yaml', `${P}/demo/operator.yaml`, 240),
      ]),
    ], JABBER, 0o755),
  ], ROOT_USER),
])

export const HOME_PATH = ['home', 'visitor']

// ---------------- path utilities ----------------

export function resolvePath(cwd: string[], arg: string): string[] {
  if (!arg || arg === '.') return [...cwd]
  if (arg === '/') return []
  let parts: string[]
  if (arg.startsWith('/')) {
    parts = arg.split('/').filter(Boolean)
  } else if (arg === '~') {
    return [...HOME_PATH]
  } else if (arg.startsWith('~/')) {
    parts = [...HOME_PATH, ...arg.slice(2).split('/').filter(Boolean)]
  } else {
    parts = [...cwd, ...arg.split('/').filter(Boolean)]
  }
  const stack: string[] = []
  for (const p of parts) {
    if (p === '..') stack.pop()
    else if (p !== '.') stack.push(p)
  }
  return stack
}

export function lookup(path: string[]): VNode | null {
  let node: VNode = ROOT
  for (const seg of path) {
    if (node.kind !== 'dir') return null
    const child: VNode | undefined = node.children.find((c) => c.name === seg)
    if (!child) return null
    node = child
  }
  return node
}

export function parentDir(path: string[]): VDir | null {
  if (path.length === 0) return null
  const p = lookup(path.slice(0, -1))
  return p && p.kind === 'dir' ? p : null
}

export function prettyPath(path: string[]): string {
  const abs = '/' + path.join('/')
  const home = '/' + HOME_PATH.join('/')
  if (abs === home) return '~'
  if (abs.startsWith(home + '/')) return '~' + abs.slice(home.length)
  return abs
}

export function absPath(path: string[]): string {
  return path.length === 0 ? '/' : '/' + path.join('/')
}

// ---------------- content I/O ----------------

// Async read. Returns cached `content`; else fetches `url`; else synthesises
// a stub for /bin/ or release-binary files. Never throws — fetch failures
// surface as error text in the returned string so `cat` prints something.
export async function readFile(node: VFile): Promise<string> {
  if (node.content !== undefined) return node.content
  if (node.binBuiltin) {
    node.content = 'gasoline.network builtin executable program\n'
    return node.content
  }
  if (node.extPlatform) {
    node.content = `[binary] ${node.name} (${node.size.toLocaleString()} bytes)\ndownload: ${node.url ?? ''}\n`
    return node.content
  }
  if (!node.url) {
    node.content = ''
    return ''
  }
  try {
    const r = await fetch(node.url)
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const t = await r.text()
    node.content = t
    node.size = t.length
    return t
  } catch (e) {
    return `cat: ${node.name}: ${(e as Error).message}\n`
  }
}

// Synchronous peek — returns cached content or undefined.
export function cachedContent(node: VFile): string | undefined {
  return node.content
}

// ---------------- mutation API ----------------

// Resolve a path's parent dir + leaf name, throwing ENOENT/ENOTDIR if the
// parent chain is broken. Used by all mutation entry points.
function resolveParent(path: string[]): { parent: VDir; name: string } {
  if (path.length === 0) {
    throw new VfsError('EINVAL', '/')
  }
  const name = path[path.length - 1]
  const parentPath = path.slice(0, -1)
  let node: VNode = ROOT
  for (const seg of parentPath) {
    if (node.kind !== 'dir') throw new VfsError('ENOTDIR', '/' + parentPath.join('/'))
    const child: VNode | undefined = node.children.find((c) => c.name === seg)
    if (!child) throw new VfsError('ENOENT', '/' + parentPath.join('/'))
    node = child
  }
  if (node.kind !== 'dir') throw new VfsError('ENOTDIR', '/' + parentPath.join('/'))
  return { parent: node, name }
}

// Mutating a dir requires both w (modify entries) and x (traverse into it).
function requireWriteDir(user: UserId, dir: VDir, pathStr: string) {
  if (!hasPerm(user, dir, 'w') || !hasPerm(user, dir, 'x')) {
    throw new VfsError('EACCES', pathStr)
  }
}

// touch — create empty file if missing, else update mtime.
export function touch(user: UserId, path: string[]): VFile {
  const pathStr = absPath(path)
  const { parent, name } = resolveParent(path)
  const parentStr = absPath(path.slice(0, -1))
  const existing = parent.children.find((c) => c.name === name)
  if (existing) {
    if (existing.kind !== 'file') throw new VfsError('EISDIR', pathStr)
    if (!hasPerm(user, existing, 'w')) throw new VfsError('EACCES', pathStr)
    existing.mtime = nowStamp()
    return existing
  }
  requireWriteDir(user, parent, parentStr)
  const file: VFile = {
    kind: 'file',
    name,
    size: 0,
    mtime: nowStamp(),
    uid: user.uid,
    gid: user.gid,
    mode: 0o644,
    content: '',
  }
  parent.children.push(file)
  parent.mtime = file.mtime
  return file
}

// mkdir — fails EEXIST if the target exists. Caller passes mode (default 0o755).
export function mkdir(user: UserId, path: string[], mode = 0o755): VDir {
  const pathStr = absPath(path)
  const { parent, name } = resolveParent(path)
  const parentStr = absPath(path.slice(0, -1))
  if (parent.children.some((c) => c.name === name)) {
    throw new VfsError('EEXIST', pathStr)
  }
  requireWriteDir(user, parent, parentStr)
  const dir: VDir = {
    kind: 'dir',
    name,
    mtime: nowStamp(),
    uid: user.uid,
    gid: user.gid,
    mode,
    children: [],
  }
  parent.children.push(dir)
  parent.mtime = dir.mtime
  return dir
}

// mkdirP — mkdir -p. Creates every missing intermediate dir.
export function mkdirP(user: UserId, path: string[], mode = 0o755): VDir {
  let current: VDir = ROOT
  for (let i = 0; i < path.length; i++) {
    const seg = path[i]
    const existing = current.children.find((c) => c.name === seg)
    if (existing) {
      if (existing.kind !== 'dir') {
        throw new VfsError('ENOTDIR', '/' + path.slice(0, i + 1).join('/'))
      }
      current = existing
      continue
    }
    requireWriteDir(user, current, '/' + path.slice(0, i).join('/'))
    const dir: VDir = {
      kind: 'dir',
      name: seg,
      mtime: nowStamp(),
      uid: user.uid,
      gid: user.gid,
      mode,
      children: [],
    }
    current.children.push(dir)
    current.mtime = dir.mtime
    current = dir
  }
  return current
}

// unlink — remove a single file. Fails EISDIR on directories.
export function unlink(user: UserId, path: string[]): void {
  const pathStr = absPath(path)
  const { parent, name } = resolveParent(path)
  const parentStr = absPath(path.slice(0, -1))
  const idx = parent.children.findIndex((c) => c.name === name)
  if (idx < 0) throw new VfsError('ENOENT', pathStr)
  const node = parent.children[idx]
  if (node.kind !== 'file') throw new VfsError('EISDIR', pathStr)
  requireWriteDir(user, parent, parentStr)
  parent.children.splice(idx, 1)
  parent.mtime = nowStamp()
}

// rmdir — remove an empty directory.
export function rmdir(user: UserId, path: string[]): void {
  const pathStr = absPath(path)
  const { parent, name } = resolveParent(path)
  const parentStr = absPath(path.slice(0, -1))
  const idx = parent.children.findIndex((c) => c.name === name)
  if (idx < 0) throw new VfsError('ENOENT', pathStr)
  const node = parent.children[idx]
  if (node.kind !== 'dir') throw new VfsError('ENOTDIR', pathStr)
  if (node.children.length > 0) throw new VfsError('ENOTEMPTY', pathStr)
  requireWriteDir(user, parent, parentStr)
  parent.children.splice(idx, 1)
  parent.mtime = nowStamp()
}

// rmTree — recursive remove (rm -r). Pre-checks every subtree for write
// permission and throws on the first denial, matching coreutils behaviour
// ("rm: cannot remove '…': Permission denied"). Path /  is refused EPERM.
export function rmTree(user: UserId, path: string[]): void {
  if (path.length === 0) throw new VfsError('EPERM', '/')
  const pathStr = absPath(path)
  const { parent, name } = resolveParent(path)
  const parentStr = absPath(path.slice(0, -1))
  const idx = parent.children.findIndex((c) => c.name === name)
  if (idx < 0) throw new VfsError('ENOENT', pathStr)
  const node = parent.children[idx]
  requireWriteDir(user, parent, parentStr)
  checkRecursiveWritable(user, node, pathStr)
  parent.children.splice(idx, 1)
  parent.mtime = nowStamp()
}

function checkRecursiveWritable(user: UserId, node: VNode, pathStr: string) {
  if (node.kind === 'dir') {
    if (!hasPerm(user, node, 'w') || !hasPerm(user, node, 'x')) {
      throw new VfsError('EACCES', pathStr)
    }
    for (const c of node.children) {
      checkRecursiveWritable(user, c, pathStr + '/' + c.name)
    }
  }
}

// writeContent — truncate-write a file's content (used by `>` redirect).
// Creates the file if missing.
export function writeContent(user: UserId, path: string[], data: string): VFile {
  let node: VNode | null = lookup(path)
  if (!node) {
    const file = touch(user, path)
    file.content = data
    file.size = data.length
    file.mtime = nowStamp()
    return file
  }
  if (node.kind !== 'file') throw new VfsError('EISDIR', absPath(path))
  if (!hasPerm(user, node, 'w')) throw new VfsError('EACCES', absPath(path))
  node.content = data
  node.size = data.length
  node.mtime = nowStamp()
  return node
}

// appendContent — `>>` redirect. Creates missing file, else appends.
export async function appendContent(user: UserId, path: string[], data: string): Promise<VFile> {
  const node = lookup(path)
  if (!node) {
    const file = touch(user, path)
    file.content = data
    file.size = data.length
    file.mtime = nowStamp()
    return file
  }
  if (node.kind !== 'file') throw new VfsError('EISDIR', absPath(path))
  if (!hasPerm(user, node, 'w')) throw new VfsError('EACCES', absPath(path))
  const existing = node.content ?? (await readFile(node))
  node.content = existing + data
  node.size = node.content.length
  node.mtime = nowStamp()
  return node
}

// chmod — no args parsing here; caller passes the final mode.
export function chmod(user: UserId, path: string[], mode: number): void {
  const node = lookup(path)
  if (!node) throw new VfsError('ENOENT', absPath(path))
  if (user.uid !== 0 && user.uid !== node.uid) {
    throw new VfsError('EPERM', absPath(path))
  }
  node.mode = mode & 0o7777
  node.mtime = nowStamp()
}

// ---------------- about text ----------------

export const ABOUT_TEXT = [
  'gasoline — a userspace VXLAN overlay for flat L2 between hosts.',
  '',
  'this web home is a simulated shell. it speaks enough of bash to',
  'let you poke around: cat, ls, cd, grep, sed, touch, mkdir, rm …',
  'write a shell script with echo > file.sh, chmod is implied,',
  'then run ./file.sh and the parser will actually execute it.',
  '',
  'source:  https://github.com/Jabberwocky238/gasoline',
].join('\n')
