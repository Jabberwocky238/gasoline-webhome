// Accounts service — keeps USERS in sync with Linux-standard /etc/passwd and
// /etc/group files living inside the VFS.
//
//   /etc/passwd    name:x:uid:gid:gecos:home:shell
//   /etc/group     name:x:gid:members   (comma-separated member list)
//   /etc/shadow    name:password:…      (demo stores plain-text passwords
//                                       in a :-separated form, no hashes)
//
// Mutations (useradd/groupadd/userdel/groupdel/passwd) go through this
// service: they edit the in-memory USERS table AND rewrite the matching
// file.  Persistence piggybacks on the normal VFS save, so user DB survives
// reloads.

import {
  USERS,
  lookup,
  writeContent,
  readFile,
  SUDO_GID,
  type UserId,
  type VFile,
} from './vfs'

const PASSWD_PATH = ['etc', 'passwd']
const GROUP_PATH  = ['etc', 'group']
const SHADOW_PATH = ['etc', 'shadow']

export interface GroupEntry {
  name: string
  gid: number
  members: string[]
}

const GROUPS: Record<string, GroupEntry> = {
  root:          { name: 'root',          gid: 0,    members: [] },
  bin:           { name: 'bin',           gid: 2,    members: [] },
  sudo:          { name: 'sudo',          gid: SUDO_GID, members: ['jabberwocky238'] },
  jabberwocky238:{ name: 'jabberwocky238',gid: 1000, members: [] },
  visitor:       { name: 'visitor',       gid: 1001, members: [] },
}

// ---------------- file I/O ----------------

// Build /etc/passwd content from USERS.
export function renderPasswd(): string {
  const lines: string[] = []
  for (const u of Object.values(USERS)) {
    const home = u.name === 'root' ? '/root' : `/home/${u.name}`
    const shell = '/bin/vsh'
    lines.push(`${u.name}:x:${u.uid}:${u.gid}::${home}:${shell}`)
  }
  return lines.join('\n') + '\n'
}

export function renderGroup(): string {
  const lines: string[] = []
  for (const g of Object.values(GROUPS)) {
    lines.push(`${g.name}:x:${g.gid}:${g.members.join(',')}`)
  }
  return lines.join('\n') + '\n'
}

export function renderShadow(): string {
  const lines: string[] = []
  for (const u of Object.values(USERS)) {
    const pw = u.password ?? '!'
    lines.push(`${u.name}:${pw}:::::::`)
  }
  return lines.join('\n') + '\n'
}

// Write files (as root, since /etc is root-owned). Silent if /etc is absent.
export function flushAccountFiles(): void {
  const root = lookup(['etc'])
  if (!root || root.kind !== 'dir') return
  try { writeContent(USERS.root, PASSWD_PATH, renderPasswd()) } catch { /* ignore */ }
  try { writeContent(USERS.root, GROUP_PATH,  renderGroup()) }  catch { /* ignore */ }
  try { writeContent(USERS.root, SHADOW_PATH, renderShadow()) } catch { /* ignore */ }
}

// ---------------- mutations ----------------

function nextFreeId(taken: Set<number>, start: number): number {
  let id = start
  while (taken.has(id)) id++
  return id
}

export function addUser(params: {
  name: string
  uid?: number
  gid?: number
  password?: string
  groups?: number[]
}): UserId {
  if (USERS[params.name]) throw new Error(`user ${params.name} already exists`)
  const takenUids = new Set(Object.values(USERS).map((u) => u.uid))
  const uid = params.uid ?? nextFreeId(takenUids, 1002)
  // Default primary group = gid of same-named group if present, else uid.
  const primaryGroup = GROUPS[params.name]
  const gid = params.gid ?? (primaryGroup ? primaryGroup.gid : uid)
  if (!GROUPS[params.name] && !Object.values(GROUPS).find((g) => g.gid === gid)) {
    GROUPS[params.name] = { name: params.name, gid, members: [] }
  }
  const user: UserId = {
    name: params.name,
    uid,
    gid,
    group: Object.values(GROUPS).find((g) => g.gid === gid)?.name ?? params.name,
    groups: params.groups,
    password: params.password,
  }
  USERS[params.name] = user
  flushAccountFiles()
  return user
}

export function removeUser(name: string): void {
  if (!USERS[name]) throw new Error(`user ${name} does not exist`)
  delete USERS[name]
  // Strip from any group memberships.
  for (const g of Object.values(GROUPS)) {
    g.members = g.members.filter((m) => m !== name)
  }
  flushAccountFiles()
}

export function addGroup(name: string, gid?: number): GroupEntry {
  if (GROUPS[name]) throw new Error(`group ${name} already exists`)
  const taken = new Set(Object.values(GROUPS).map((g) => g.gid))
  const actualGid = gid ?? nextFreeId(taken, 1002)
  GROUPS[name] = { name, gid: actualGid, members: [] }
  flushAccountFiles()
  return GROUPS[name]
}

export function removeGroup(name: string): void {
  if (!GROUPS[name]) throw new Error(`group ${name} does not exist`)
  const gid = GROUPS[name].gid
  const primaryUser = Object.values(USERS).find((u) => u.gid === gid)
  if (primaryUser) throw new Error(`group ${name} is the primary group of ${primaryUser.name}`)
  delete GROUPS[name]
  flushAccountFiles()
}

export function setPassword(name: string, password: string): void {
  const u = USERS[name]
  if (!u) throw new Error(`user ${name} does not exist`)
  u.password = password
  flushAccountFiles()
}

export function listGroups(): GroupEntry[] {
  return Object.values(GROUPS)
}

// Try to refresh USERS/GROUPS from existing /etc files if they exist.
// Called during boot after VFS load so a persisted snapshot repopulates
// any accounts the user created before reloading.
export async function rehydrateFromFiles(): Promise<void> {
  const passwdNode = lookup(PASSWD_PATH)
  if (passwdNode?.kind === 'file') {
    const text = await readFile(passwdNode as VFile)
    parsePasswd(text)
  }
  const groupNode = lookup(GROUP_PATH)
  if (groupNode?.kind === 'file') {
    const text = await readFile(groupNode as VFile)
    parseGroup(text)
  }
  const shadowNode = lookup(SHADOW_PATH)
  if (shadowNode?.kind === 'file') {
    const text = await readFile(shadowNode as VFile)
    parseShadow(text)
  }
}

function parsePasswd(text: string): void {
  for (const line of text.split('\n')) {
    const f = line.split(':')
    if (f.length < 7) continue
    const [name, , uidS, gidS] = f
    const uid = parseInt(uidS, 10)
    const gid = parseInt(gidS, 10)
    if (!name || isNaN(uid) || isNaN(gid)) continue
    if (!USERS[name]) {
      USERS[name] = {
        name, uid, gid,
        group: Object.values(GROUPS).find((g) => g.gid === gid)?.name ?? name,
      }
    }
  }
}
function parseGroup(text: string): void {
  for (const line of text.split('\n')) {
    const f = line.split(':')
    if (f.length < 4) continue
    const [name, , gidS, memberStr] = f
    const gid = parseInt(gidS, 10)
    if (!name || isNaN(gid)) continue
    const members = memberStr ? memberStr.split(',').filter(Boolean) : []
    GROUPS[name] = { name, gid, members }
  }
}
function parseShadow(text: string): void {
  for (const line of text.split('\n')) {
    const f = line.split(':')
    if (f.length < 2) continue
    const [name, pw] = f
    if (!USERS[name]) continue
    if (pw && pw !== '!' && pw !== 'x') USERS[name].password = pw
  }
}
