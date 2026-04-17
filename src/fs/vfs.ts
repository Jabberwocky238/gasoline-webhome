// Virtual filesystem for the gasoline webhome terminal.
//
// Design:
//   - Text files live at real HTTP paths under `public/`; binary / builtin
//     stubs never fetch. Content is cached after the first read.
//   - Every node has a (uid, gid, mode) triple, mirroring Unix semantics so
//     visitor can read but not modify jabberwocky238's files.
//   - Files go through an `Inode` object so hard links share content/mode/
//     owner: creating a second VFile with the same inode ref means chmod
//     or echo > on one visibly affects both, exactly like Linux.
//   - Symlinks are their own VNode kind; `lookup` follows them with a
//     40-hop ELOOP guard. `followLast:false` lets rm/ln operate on the
//     link itself instead of the target.

// ---------------- users & groups ----------------

export interface UserId {
  uid: number
  gid: number
  name: string
  group: string
  groups?: number[] // supplementary groups
  password?: string // demo-only, plaintext. Only used by `ssh` and `su`.
}

// gid 27 is the `sudo` group on Debian/Ubuntu. jabberwocky238 is a member,
// so `sudo <cmd>` works for them; visitor is not, so it doesn't.
export const SUDO_GID = 27

export const USERS: Record<string, UserId> = {
  root:          { uid: 0,    gid: 0,    name: 'root',           group: 'root' },
  jabberwocky238:{ uid: 1000, gid: 1000, name: 'jabberwocky238', group: 'jabberwocky238',
                   groups: [SUDO_GID], password: 'meandmydream' },
  visitor:       { uid: 1001, gid: 1001, name: 'visitor',        group: 'visitor' },
  bin:           { uid: 2,    gid: 2,    name: 'bin',            group: 'bin' },
}

const UID_NAME = new Map<number, string>()
const GID_NAME = new Map<number, string>()
for (const u of Object.values(USERS)) {
  UID_NAME.set(u.uid, u.name)
  GID_NAME.set(u.gid, u.group)
}
// Standalone groups (no primary user by that name).
GID_NAME.set(SUDO_GID, 'sudo')

export const uidName = (uid: number) => UID_NAME.get(uid) ?? String(uid)
export const gidName = (gid: number) => GID_NAME.get(gid) ?? String(gid)

// Does `user` belong to the sudo group (member of gid 27)?
export function isSudoer(user: UserId): boolean {
  if (user.uid === 0) return true
  if (user.gid === SUDO_GID) return true
  return !!user.groups?.includes(SUDO_GID)
}

// Unix-style permission check. mode bits: 0o400 r 0o200 w 0o100 x (owner);
// 0o040/020/010 (group); 0o004/002/001 (other).
export type PermOp = 'r' | 'w' | 'x'
export function hasPerm(user: UserId, node: VNode, op: PermOp): boolean {
  if (user.uid === 0) return true // root bypass
  const bit = op === 'r' ? 4 : op === 'w' ? 2 : 1
  // VFile aliases uid/gid/mode to its inode via getters — uniform access.
  const { uid, gid, mode } = node
  let shift: number
  if (user.uid === uid) shift = 6
  else if (user.gid === gid || user.groups?.includes(gid)) shift = 3
  else shift = 0
  return (mode & (bit << shift)) !== 0
}

// ---------------- error type ----------------

export type VfsErrno =
  | 'ENOENT'
  | 'EACCES'
  | 'EEXIST'
  | 'EISDIR'
  | 'ENOTDIR'
  | 'ENOTEMPTY'
  | 'EPERM'
  | 'EINVAL'
  | 'ELOOP'
  | 'EXDEV'

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
    case 'ELOOP':     return 'Too many levels of symbolic links'
    case 'EXDEV':     return 'Invalid cross-device link'
  }
}

// ---------------- filesystem types ----------------

// Inode: content + metadata shared across hard links. nlinks is how many
// directory entries reference this inode (0 → eligible for GC).
export interface Inode {
  uid: number
  gid: number
  mode: number
  size: number
  mtime: string
  content?: string
  url?: string
  binBuiltin?: boolean
  extPlatform?: boolean
  nlinks: number
}

// VFile presents flat fields (uid, gid, mode, ...) as getter aliases backed
// by its Inode. Code written before the refactor still works: `file.mode =
// 0o755` delegates to `file.inode.mode = 0o755`, so every hard link sees
// the change.
export interface VFile {
  kind: 'file'
  name: string
  inode: Inode
  // Aliases (getters/setters to inode). Declared here for types only.
  uid: number
  gid: number
  mode: number
  size: number
  mtime: string
  content?: string
  url?: string
  binBuiltin?: boolean
  extPlatform?: boolean
}

export interface VDir {
  kind: 'dir'
  name: string
  mtime: string
  uid: number
  gid: number
  mode: number
  children: VNode[]
}

// Symlinks store their target as an unresolved string. Always mode 0o777
// on Linux — perm bits live on the target, not the link.
export interface VSymlink {
  kind: 'symlink'
  name: string
  target: string
  mtime: string
  uid: number
  gid: number
  mode: number
}

export type VNode = VFile | VDir | VSymlink

// ---------------- constructors ----------------

const JABBER = USERS.jabberwocky238
const ROOT_USER = USERS.root

const nowStamp = () => {
  const d = new Date()
  const p = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

// Wire flat aliases so `file.mode` <→> `file.inode.mode`. Any hard-link
// sharing the same inode sees the mutation.
function defineAliases(file: any, inode: Inode) {
  const props = ['uid', 'gid', 'mode', 'size', 'mtime', 'content', 'url', 'binBuiltin', 'extPlatform'] as const
  for (const p of props) {
    Object.defineProperty(file, p, {
      get: () => (inode as any)[p],
      set: (v: unknown) => { (inode as any)[p] = v },
      enumerable: true,
      configurable: true,
    })
  }
}

export function makeFile(name: string, inode: Inode): VFile {
  const f: any = { kind: 'file', name, inode }
  defineAliases(f, inode)
  return f as VFile
}

export function newInode(attrs: Omit<Inode, 'nlinks'> & Partial<Pick<Inode, 'nlinks'>>): Inode {
  return {
    uid: attrs.uid,
    gid: attrs.gid,
    mode: attrs.mode,
    size: attrs.size,
    mtime: attrs.mtime,
    content: attrs.content,
    url: attrs.url,
    binBuiltin: attrs.binBuiltin,
    extPlatform: attrs.extPlatform,
    nlinks: attrs.nlinks ?? 1,
  }
}

// f: text file under public/, owned by jabberwocky238, mode 0644.
const f = (
  name: string,
  url: string,
  size: number,
  mtime = '2026-04-17 15:00',
): VFile => makeFile(name, newInode({
  uid: JABBER.uid, gid: JABBER.gid, mode: 0o644, size, mtime, url,
}))

// x: release binary stub — external download URL, non-runnable in browser.
const x = (
  name: string,
  size: number,
  url: string,
  mtime = '2026-04-14 12:00',
): VFile => makeFile(name, newInode({
  uid: JABBER.uid, gid: JABBER.gid, mode: 0o755, size, mtime, url, extPlatform: true,
}))

// b: /bin/ builtin stub.
const b = (name: string, size = 16_384, mtime = '2026-04-01 09:00'): VFile =>
  makeFile(name, newInode({
    uid: ROOT_USER.uid, gid: ROOT_USER.gid, mode: 0o755, size, mtime, binBuiltin: true,
  }))

// d: directory.
const d = (
  name: string,
  children: VNode[],
  owner: UserId = JABBER,
  mode = 0o755,
  mtime = '2026-04-17 15:00',
): VDir => ({
  kind: 'dir', name, mtime, uid: owner.uid, gid: owner.gid, mode, children,
})

// s: symlink.
const s = (
  name: string,
  target: string,
  owner: UserId = ROOT_USER,
  mtime = '2026-04-01 09:00',
): VSymlink => ({
  kind: 'symlink', name, target, mtime, uid: owner.uid, gid: owner.gid, mode: 0o777,
})

// ---------------- /bin/ population ----------------

export const BUILTINS = [
  'ls', 'll', 'dir', 'cat', 'less', 'more', 'head', 'tail',
  'cd', 'pwd', 'whoami', 'id', 'tree', 'clear', 'cls',
  'echo', 'uname', 'env', 'export', 'history',
  'about', 'help', 'neofetch',
  'grep', 'sed', 'man', 'touch', 'rm', 'mkdir', 'rmdir',
  'bash', 'sh', 'true', 'false', 'ln', 'chmod', 'chown', 'chgrp',
  'groups', 'su', 'sudo', 'ssh', 'unset', 'alias', 'unalias',
  'scp', 'curl', 'reboot', 'systemctl', 'ifconfig',
  'useradd', 'userdel', 'groupadd', 'groupdel', 'passwd',
] as const

const BIN_CHILDREN: VNode[] = BUILTINS.map((n) => b(n))

// ---------------- /home/visitor content map ----------------
const P = '/home/visitor'
const PUB_HELLO  = `${P}/hello.sh`

// ---------------- root tree ----------------

// Tree factory — produces a fresh default VFS. `replaceRoot` swaps ROOT's
// children for a loaded snapshot or for a reboot's fresh seed.
export function buildDefaultTree(): VDir {
  return makeDefaultRoot()
}

export function replaceRoot(newRoot: VDir): void {
  ROOT.children.length = 0
  for (const c of newRoot.children) ROOT.children.push(c)
  ROOT.uid = newRoot.uid
  ROOT.gid = newRoot.gid
  ROOT.mode = newRoot.mode
  ROOT.mtime = newRoot.mtime
}

function makeDefaultRoot(): VDir {
  return d('/', makeTreeChildren(), ROOT_USER)
}

function makeTreeChildren(): VNode[] {
  const binChildren: VNode[] = [
    ...BUILTINS.map((n) => b(n)),
    // gasoline + systemd binaries live here; marked extPlatform so running
    // them goes through the simulator rather than emitting garbage.
    makeFile('gasoline', newInode({
      uid: 0, gid: 0, mode: 0o755, size: 28_456_912,
      mtime: '2026-04-01 09:00',
      url: 'https://github.com/Jabberwocky238/gasoline/releases/download/Beta0.1.0/gasoline-linux-amd64',
      extPlatform: true,
    })),
    makeFile('systemd', newInode({
      uid: 0, gid: 0, mode: 0o755, size: 1_548_232,
      mtime: '2026-04-01 09:00', binBuiltin: true,
    })),
  ]
  return [
    d('bin', binChildren, ROOT_USER),
    d('sbin', [
      makeFile('init', newInode({
        uid: 0, gid: 0, mode: 0o755, size: 1_548_232,
        mtime: '2026-04-01 09:00', binBuiltin: true,
      })),
      s('systemd', '/bin/systemd', ROOT_USER),
    ], ROOT_USER),
    d('usr', [
      s('bin', '/bin', ROOT_USER),
      d('local', [d('bin', [], ROOT_USER)], ROOT_USER),
      d('share', [d('man', [d('man1', [], ROOT_USER)], ROOT_USER)], ROOT_USER),
    ], ROOT_USER),
    d('etc', [
      d('systemd', [
        d('system', [
          makeFile('gasoline.service', newInode({
            uid: 0, gid: 0, mode: 0o644, size: 0,
            mtime: '2026-04-01 09:00',
            url: '/etc/systemd/system/gasoline.service',
          })),
        ], ROOT_USER),
      ], ROOT_USER),
      d('gasoline', [
        makeFile('config.yaml', newInode({
          uid: 0, gid: 0, mode: 0o644, size: 0,
          mtime: '2026-04-01 09:00',
          url: '/etc/gasoline/config.yaml',
        })),
      ], ROOT_USER),
    ], ROOT_USER),
    d('proc', [], ROOT_USER, 0o555),
    d('var', [
      d('run', [], ROOT_USER, 0o755),
      d('log', [], ROOT_USER, 0o755),
    ], ROOT_USER),
    d('tmp', [], ROOT_USER, 0o777),
    d('root', [], ROOT_USER, 0o700),
    d('home', [
      d('jabberwocky238', [], JABBER, 0o750),
      d('visitor', visitorHome(), USERS.visitor, 0o755),
    ], ROOT_USER),
  ]
}

function visitorHome(): VNode[] {
  // Dotfile contents live under public/ — fetched on first read and then
  // cached in the inode. A fresh reboot re-fetches them.
  const dotFile = (name: string, url: string): VFile =>
    makeFile(name, newInode({
      uid: USERS.visitor.uid, gid: USERS.visitor.gid, mode: 0o644,
      size: 0, mtime: '2026-04-17 15:00', url,
    }))
  // Shipped helper scripts — executable (mode 0o755) so `./download-*.sh`
  // works out of the box.
  const scriptFile = (name: string, url: string): VFile =>
    makeFile(name, newInode({
      uid: USERS.visitor.uid, gid: USERS.visitor.gid, mode: 0o755,
      size: 0, mtime: '2026-04-17 15:00', url,
    }))
  return [
    dotFile('.bashrc', `${P}/.bashrc`),
    dotFile('.profile', `${P}/.profile`),
    scriptFile('download-amd64.sh', `${P}/download-amd64.sh`),
    scriptFile('download-arm64.sh', `${P}/download-arm64.sh`),
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
  ]
}

// /usr/bin is a symlink to /bin — classic Linux filesystem layout.
export const ROOT: VDir = d('/', [
  d('bin', BIN_CHILDREN, ROOT_USER),
  d('usr', [
    s('bin', '/bin', ROOT_USER),
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
    ], USERS.visitor, 0o755),
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

const MAX_SYMLINK_HOPS = 40

// lookup walks a path, optionally following a symlink at the final segment.
// Intermediate symlinks are always followed (otherwise you couldn't
// `cd /usr/bin` at all when /usr/bin is a link). Returns null for ENOENT
// and — with `throws:true` — throws ELOOP on an oversized chain.
export function lookup(
  path: string[],
  options: { followLast?: boolean } = {},
): VNode | null {
  return lookupWithHops(path, options.followLast ?? true, 0)
}

function lookupWithHops(path: string[], followLast: boolean, hops: number): VNode | null {
  if (hops > MAX_SYMLINK_HOPS) return null
  let node: VNode = ROOT
  for (let i = 0; i < path.length; i++) {
    const seg = path[i]
    if (node.kind !== 'dir') return null
    const child: VNode | undefined = node.children.find((c) => c.name === seg)
    if (!child) return null
    const isLast = i === path.length - 1
    if (child.kind === 'symlink' && (!isLast || followLast)) {
      const parentPath = path.slice(0, i)
      const target = resolvePath(parentPath, child.target)
      const resolved = lookupWithHops(target, true, hops + 1)
      if (!resolved) return null
      node = resolved
    } else {
      node = child
    }
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

export function cachedContent(node: VFile): string | undefined {
  return node.content
}

// ---------------- mutation API ----------------

// Resolve a path's parent dir + leaf name. Intermediate symlinks are
// followed; the leaf is returned unresolved so callers can operate on the
// directory entry itself (rm, ln, chown symlink, ...).
function resolveParent(path: string[]): { parent: VDir; name: string } {
  if (path.length === 0) throw new VfsError('EINVAL', '/')
  const parentPath = path.slice(0, -1)
  const parent = lookup(parentPath)
  if (!parent) throw new VfsError('ENOENT', '/' + parentPath.join('/'))
  if (parent.kind !== 'dir') throw new VfsError('ENOTDIR', '/' + parentPath.join('/'))
  return { parent, name: path[path.length - 1] }
}

function requireWriteDir(user: UserId, dir: VDir, pathStr: string) {
  if (!hasPerm(user, dir, 'w') || !hasPerm(user, dir, 'x')) {
    throw new VfsError('EACCES', pathStr)
  }
}

export function touch(user: UserId, path: string[]): VFile {
  const pathStr = absPath(path)
  const { parent, name } = resolveParent(path)
  const parentStr = absPath(path.slice(0, -1))
  const existing = parent.children.find((c) => c.name === name)
  if (existing) {
    if (existing.kind === 'dir') throw new VfsError('EISDIR', pathStr)
    if (existing.kind === 'symlink') {
      existing.mtime = nowStamp()
      return existing as unknown as VFile // caller should follow if needed
    }
    if (!hasPerm(user, existing, 'w')) throw new VfsError('EACCES', pathStr)
    existing.mtime = nowStamp()
    return existing
  }
  requireWriteDir(user, parent, parentStr)
  const file = makeFile(name, newInode({
    uid: user.uid, gid: user.gid, mode: 0o644, size: 0, mtime: nowStamp(), content: '',
  }))
  parent.children.push(file)
  parent.mtime = file.mtime
  return file
}

export function mkdir(user: UserId, path: string[], mode = 0o755): VDir {
  const pathStr = absPath(path)
  const { parent, name } = resolveParent(path)
  const parentStr = absPath(path.slice(0, -1))
  if (parent.children.some((c) => c.name === name)) {
    throw new VfsError('EEXIST', pathStr)
  }
  requireWriteDir(user, parent, parentStr)
  const dir: VDir = {
    kind: 'dir', name, mtime: nowStamp(),
    uid: user.uid, gid: user.gid, mode, children: [],
  }
  parent.children.push(dir)
  parent.mtime = dir.mtime
  return dir
}

export function mkdirP(user: UserId, path: string[], mode = 0o755): VDir {
  let current: VDir = ROOT
  for (let i = 0; i < path.length; i++) {
    const seg = path[i]
    const existing = current.children.find((c) => c.name === seg)
    if (existing) {
      if (existing.kind === 'symlink') {
        const resolved = lookup([...path.slice(0, i), seg])
        if (!resolved || resolved.kind !== 'dir') {
          throw new VfsError('ENOTDIR', '/' + path.slice(0, i + 1).join('/'))
        }
        current = resolved
        continue
      }
      if (existing.kind !== 'dir') {
        throw new VfsError('ENOTDIR', '/' + path.slice(0, i + 1).join('/'))
      }
      current = existing
      continue
    }
    requireWriteDir(user, current, '/' + path.slice(0, i).join('/'))
    const dir: VDir = {
      kind: 'dir', name: seg, mtime: nowStamp(),
      uid: user.uid, gid: user.gid, mode, children: [],
    }
    current.children.push(dir)
    current.mtime = dir.mtime
    current = dir
  }
  return current
}

// unlink — remove a single file or symlink. Decrements nlinks on the inode
// so content only gets collected when the last link goes away (VFile
// objects become unreachable and the inode with them).
export function unlink(user: UserId, path: string[]): void {
  const pathStr = absPath(path)
  const { parent, name } = resolveParent(path)
  const parentStr = absPath(path.slice(0, -1))
  const idx = parent.children.findIndex((c) => c.name === name)
  if (idx < 0) throw new VfsError('ENOENT', pathStr)
  const node = parent.children[idx]
  if (node.kind === 'dir') throw new VfsError('EISDIR', pathStr)
  requireWriteDir(user, parent, parentStr)
  if (node.kind === 'file') node.inode.nlinks = Math.max(0, node.inode.nlinks - 1)
  parent.children.splice(idx, 1)
  parent.mtime = nowStamp()
}

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

// rmTree — recursive remove. Always operates on the leaf entry itself:
// `rm -rf /usr/bin` removes the *symlink*, never the target.
export function rmTree(user: UserId, path: string[]): void {
  if (path.length === 0) throw new VfsError('EPERM', '/')
  const pathStr = absPath(path)
  const { parent, name } = resolveParent(path)
  const parentStr = absPath(path.slice(0, -1))
  const idx = parent.children.findIndex((c) => c.name === name)
  if (idx < 0) throw new VfsError('ENOENT', pathStr)
  const node = parent.children[idx]
  requireWriteDir(user, parent, parentStr)
  if (node.kind === 'dir') checkRecursiveWritable(user, node, pathStr)
  if (node.kind === 'dir') decRefsInTree(node)
  else if (node.kind === 'file') node.inode.nlinks = Math.max(0, node.inode.nlinks - 1)
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

function decRefsInTree(node: VNode) {
  if (node.kind === 'file') node.inode.nlinks = Math.max(0, node.inode.nlinks - 1)
  else if (node.kind === 'dir') for (const c of node.children) decRefsInTree(c)
}

export function writeContent(user: UserId, path: string[], data: string): VFile {
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
  node.content = data
  node.size = data.length
  node.mtime = nowStamp()
  return node
}

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

// chmod — mode on the target's inode / dir / symlink node. For symlinks
// Linux lchmod usually does nothing; we accept it for uniformity.
export function chmod(user: UserId, path: string[], mode: number): void {
  const node = lookup(path)
  if (!node) throw new VfsError('ENOENT', absPath(path))
  if (user.uid !== 0 && user.uid !== node.uid) {
    throw new VfsError('EPERM', absPath(path))
  }
  node.mode = mode & 0o7777
  node.mtime = nowStamp()
}

// symlink — create a symbolic link at `linkPath` pointing to `target`.
// Target is stored verbatim (may be absolute, relative, or dangling).
export function symlink(user: UserId, linkPath: string[], target: string): VSymlink {
  const pathStr = absPath(linkPath)
  const { parent, name } = resolveParent(linkPath)
  const parentStr = absPath(linkPath.slice(0, -1))
  if (parent.children.some((c) => c.name === name)) {
    throw new VfsError('EEXIST', pathStr)
  }
  requireWriteDir(user, parent, parentStr)
  const link: VSymlink = {
    kind: 'symlink', name, target, mtime: nowStamp(),
    uid: user.uid, gid: user.gid, mode: 0o777,
  }
  parent.children.push(link)
  parent.mtime = link.mtime
  return link
}

// link — hard link. Only valid from file → file (directory hard links not
// allowed on Linux either). Bumps nlinks on the shared inode.
export function link(user: UserId, srcPath: string[], dstPath: string[]): VFile {
  const src = lookup(srcPath)
  if (!src) throw new VfsError('ENOENT', absPath(srcPath))
  if (src.kind !== 'file') throw new VfsError('EPERM', absPath(srcPath))
  const pathStr = absPath(dstPath)
  const { parent, name } = resolveParent(dstPath)
  const parentStr = absPath(dstPath.slice(0, -1))
  if (parent.children.some((c) => c.name === name)) {
    throw new VfsError('EEXIST', pathStr)
  }
  requireWriteDir(user, parent, parentStr)
  const dup = makeFile(name, src.inode)
  src.inode.nlinks++
  parent.children.push(dup)
  parent.mtime = nowStamp()
  src.inode.mtime = parent.mtime
  return dup
}

// ---------------- about text ----------------

export const ABOUT_TEXT = [
  'gasoline — a userspace VXLAN overlay for flat L2 between hosts.',
  '',
  'this web home is a simulated shell. it speaks enough of bash to',
  'let you poke around: cat, ls, cd, grep, sed, touch, mkdir, rm,',
  'ln (hard + symlink), chmod, chown, pipes, $VAR, $(…)',
  '',
  'source:  https://github.com/Jabberwocky238/gasoline',
].join('\n')
