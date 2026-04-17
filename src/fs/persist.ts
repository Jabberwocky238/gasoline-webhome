// IndexedDB persistence for the virtual filesystem.
//
//   - load(): try to restore a snapshot from IDB into ROOT (in-place).
//              Returns true if a snapshot was found.
//   - save(): serialise the current ROOT and write the snapshot.
//              Debounced via scheduleSave() to coalesce rapid mutations.
//   - wipe(): remove the snapshot. Used by `reboot`.
//
// The serializer preserves hard-link relationships by assigning each Inode
// a numeric id on the way out, and rebuilding the `makeFile(name, inode)`
// shared-reference pattern on the way in.

import { openDB, type IDBPDatabase } from 'idb'
import {
  ROOT,
  buildDefaultTree,
  replaceRoot,
  makeFile,
  newInode,
  lookup,
  readFile,
  type Inode,
  type VDir,
  type VFile,
  type VNode,
} from './vfs'

const DB_NAME = 'gasoline-webhome'
const STORE = 'fs'
const ROOT_KEY = 'root'
const INIT_KEY = 'initialized'
const DB_VERSION = 1

// Content-bearing values in localStorage that should OUTLIVE an IDB wipe.
const PROFILE_KEY = 'gasoline.profile'

let dbPromise: Promise<IDBPDatabase> | null = null
function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
      },
    })
  }
  return dbPromise
}

// ---------------- serialisation ----------------

interface SerInode {
  id: number
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

type SerFile = { kind: 'file'; name: string; inode: number }
type SerDir  = { kind: 'dir'; name: string; uid: number; gid: number; mode: number; mtime: string; children: SerNode[] }
type SerLink = { kind: 'symlink'; name: string; target: string; uid: number; gid: number; mode: number; mtime: string }
type SerNode = SerFile | SerDir | SerLink

interface SerState {
  version: 1
  root: SerDir
  inodes: SerInode[]
}

function serialize(root: VDir): SerState {
  const inodeId = new Map<Inode, number>()
  const inodes: SerInode[] = []
  const captureInode = (ino: Inode): number => {
    const known = inodeId.get(ino)
    if (known !== undefined) return known
    const id = inodes.length
    inodeId.set(ino, id)
    inodes.push({
      id,
      uid: ino.uid, gid: ino.gid, mode: ino.mode, size: ino.size, mtime: ino.mtime,
      content: ino.content, url: ino.url,
      binBuiltin: ino.binBuiltin, extPlatform: ino.extPlatform,
      nlinks: ino.nlinks,
    })
    return id
  }
  const ser = (n: VNode): SerNode => {
    if (n.kind === 'file') return { kind: 'file', name: n.name, inode: captureInode(n.inode) }
    if (n.kind === 'symlink') return {
      kind: 'symlink', name: n.name, target: n.target,
      uid: n.uid, gid: n.gid, mode: n.mode, mtime: n.mtime,
    }
    return {
      kind: 'dir', name: n.name,
      uid: n.uid, gid: n.gid, mode: n.mode, mtime: n.mtime,
      children: n.children.map(ser),
    }
  }
  const rootSer = ser(root)
  if (rootSer.kind !== 'dir') throw new Error('root serializer produced non-dir')
  return { version: 1, root: rootSer, inodes }
}

function deserialize(s: SerState): VDir {
  const byId = new Map<number, Inode>()
  for (const si of s.inodes) {
    byId.set(si.id, newInode({
      uid: si.uid, gid: si.gid, mode: si.mode, size: si.size, mtime: si.mtime,
      content: si.content, url: si.url,
      binBuiltin: si.binBuiltin, extPlatform: si.extPlatform,
      nlinks: si.nlinks,
    }))
  }
  const de = (n: SerNode): VNode => {
    if (n.kind === 'file') {
      const inode = byId.get(n.inode)
      if (!inode) throw new Error(`missing inode id=${n.inode}`)
      return makeFile(n.name, inode)
    }
    if (n.kind === 'symlink') return {
      kind: 'symlink', name: n.name, target: n.target,
      uid: n.uid, gid: n.gid, mode: n.mode, mtime: n.mtime,
    }
    return {
      kind: 'dir', name: n.name,
      uid: n.uid, gid: n.gid, mode: n.mode, mtime: n.mtime,
      children: n.children.map(de),
    }
  }
  const root = de(s.root)
  if (root.kind !== 'dir') throw new Error('deserialized root is not a directory')
  return root
}

// ---------------- public API ----------------

export async function loadVfs(): Promise<boolean> {
  try {
    const db = await getDB()
    const saved = await db.get(STORE, ROOT_KEY) as SerState | undefined
    if (!saved || saved.version !== 1) return false
    replaceRoot(deserialize(saved))
    return true
  } catch {
    return false
  }
}

export async function saveVfs(): Promise<void> {
  try {
    const db = await getDB()
    await db.put(STORE, serialize(ROOT), ROOT_KEY)
  } catch { /* ignore */ }
}

export async function wipeVfs(): Promise<void> {
  try {
    const db = await getDB()
    await db.delete(STORE, ROOT_KEY)
    await db.delete(STORE, INIT_KEY)
  } catch { /* ignore */ }
}

export async function isInitialized(): Promise<boolean> {
  try {
    const db = await getDB()
    return (await db.get(STORE, INIT_KEY)) === true
  } catch { return false }
}
export async function markInitialized(): Promise<void> {
  try {
    const db = await getDB()
    await db.put(STORE, true, INIT_KEY)
  } catch { /* ignore */ }
}

export function seedDefault(): void {
  replaceRoot(buildDefaultTree())
}

// Walk the tree, readFile() every VFile that has a url but no content yet.
// Called at first boot so every shipped default file is captured in IDB,
// after which the site runs offline without re-fetching.
export async function prefetchInitialContent(): Promise<void> {
  const files: VFile[] = []
  collectFiles(ROOT, files)
  await Promise.all(files.map(async (f) => {
    if (f.inode.content === undefined && f.inode.url) {
      try { await readFile(f) } catch { /* leave empty */ }
    }
  }))
}

function collectFiles(node: VNode, out: VFile[]): void {
  if (node.kind === 'file') { out.push(node); return }
  if (node.kind !== 'dir') return
  for (const c of node.children) collectFiles(c, out)
}

// Before any snapshot hits the wire, mirror the user's ~/.profile content
// into localStorage so it survives an IDB wipe.
function syncProfileFromVfs(): void {
  const node = lookup(['home', 'visitor', '.profile'])
  if (node && node.kind === 'file') saveProfile(node.content ?? '')
}

// Debounced save so rapid mutations produce one IDB write.
let pendingTimer: ReturnType<typeof setTimeout> | null = null
export function scheduleSave(delay = 400): void {
  if (pendingTimer) clearTimeout(pendingTimer)
  pendingTimer = setTimeout(() => {
    pendingTimer = null
    syncProfileFromVfs()
    void saveVfs()
  }, delay)
}

// Flush any pending save right now.
export async function flushSave(): Promise<void> {
  if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null }
  syncProfileFromVfs()
  await saveVfs()
}

// ---------------- .profile (localStorage) ----------------

export function loadProfile(): string | null {
  try { return localStorage.getItem(PROFILE_KEY) } catch { return null }
}

export function saveProfile(text: string): void {
  try { localStorage.setItem(PROFILE_KEY, text) } catch { /* quota etc. */ }
}

export function wipeProfile(): void {
  try { localStorage.removeItem(PROFILE_KEY) } catch { /* ignore */ }
}
