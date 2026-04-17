// Tiny process service. Mirrors a subset of /proc/<pid>/ into the VFS so
// files like /proc/1/status and /proc/<pid-of-gasoline>/cmdline actually
// reflect runtime state — `cat /proc/1/status` returns the live data.
//
// Systemd (pid 1) and the gasoline service boot on startup. `systemctl`
// starts/stops the gasoline unit by toggling its process entry here.

import { writeContent, mkdirP, lookup, USERS } from './vfs'

export interface Process {
  pid: number
  name: string
  cmdline: string
  state: 'R' | 'S' | 'Z' | 'T'
  uid: number
  gid: number
  startTime: string
}

const procs = new Map<number, Process>()
let nextPid = 2

export function listProcesses(): Process[] {
  return [...procs.values()].sort((a, b) => a.pid - b.pid)
}
export function findByName(name: string): Process | undefined {
  for (const p of procs.values()) if (p.name === name) return p
  return undefined
}
export function getProcess(pid: number): Process | undefined {
  return procs.get(pid)
}

// Seed systemd (pid 1). Always present.
function boot(): void {
  if (procs.has(1)) return
  procs.set(1, {
    pid: 1,
    name: 'systemd',
    cmdline: '/sbin/systemd --switched-root --system --deserialize 30',
    state: 'S',
    uid: 0, gid: 0,
    startTime: nowStamp(),
  })
}

export function startProcess(name: string, cmdline: string, uid = 0, gid = 0): Process {
  const existing = findByName(name)
  if (existing) return existing
  const pid = nextPid++
  const p: Process = { pid, name, cmdline, state: 'R', uid, gid, startTime: nowStamp() }
  procs.set(pid, p)
  writeProcFiles(p)
  writePidFile(p)
  return p
}

export function stopProcess(name: string): boolean {
  const p = findByName(name)
  if (!p || p.pid === 1) return false
  procs.delete(p.pid)
  removeProcFiles(p.pid)
  removePidFile(p.name)
  return true
}

// ---------------- /proc files ----------------

function writeProcFiles(p: Process): void {
  const dir = ['proc', String(p.pid)]
  try { mkdirP(USERS.root, dir, 0o555) } catch { /* may already exist */ }
  try { writeContent(USERS.root, [...dir, 'status'], renderStatus(p)) } catch { /* ignore */ }
  try { writeContent(USERS.root, [...dir, 'cmdline'], p.cmdline + '\0') } catch { /* ignore */ }
  try { writeContent(USERS.root, [...dir, 'comm'], p.name + '\n') } catch { /* ignore */ }
}
function removeProcFiles(pid: number): void {
  const parent = lookup(['proc'])
  if (!parent || parent.kind !== 'dir') return
  const idx = parent.children.findIndex((c) => c.name === String(pid))
  if (idx >= 0) parent.children.splice(idx, 1)
}
function writePidFile(p: Process): void {
  if (p.name === 'systemd') return
  try { writeContent(USERS.root, ['var', 'run', `${p.name}.pid`], String(p.pid) + '\n') } catch { /* ignore */ }
}
function removePidFile(name: string): void {
  try { writeContent(USERS.root, ['var', 'run', `${name}.pid`], '') } catch { /* ignore */ }
  // Or unlink — but writeContent is enough to zero it.
}

function renderStatus(p: Process): string {
  return [
    `Name:\t${p.name}`,
    `State:\t${p.state} (${stateName(p.state)})`,
    `Pid:\t${p.pid}`,
    `PPid:\t${p.pid === 1 ? 0 : 1}`,
    `Uid:\t${p.uid}\t${p.uid}\t${p.uid}\t${p.uid}`,
    `Gid:\t${p.gid}\t${p.gid}\t${p.gid}\t${p.gid}`,
    `Threads:\t1`,
    `VmRSS:\t${(1024 * (p.name === 'systemd' ? 12 : 8)).toString()} kB`,
    `Started:\t${p.startTime}`,
    '',
  ].join('\n')
}
const stateName = (s: string) => s === 'R' ? 'running' : s === 'S' ? 'sleeping' : s === 'Z' ? 'zombie' : 'stopped'

function nowStamp() {
  const d = new Date()
  const p = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

// ---------------- boot sequence ----------------

// Call once after the VFS is ready. Seeds /proc/1 (systemd) and autostarts
// the gasoline service if /etc/systemd/system/gasoline.service says so.
export function initProcesses(): void {
  boot()
  writeProcFiles(getProcess(1)!)
  // Auto-start gasoline if the service unit requests it.
  const unit = lookup(['etc', 'systemd', 'system', 'gasoline.service'])
  let autostart = true
  if (unit && unit.kind === 'file') {
    const text = unit.content ?? ''
    // naive parse: look for `WantedBy` or an explicit `Disabled` marker
    if (/^\s*Disabled\s*=\s*true/mi.test(text)) autostart = false
  }
  if (autostart) startProcess('gasoline', '/usr/bin/gasoline operator --config /etc/gasoline/config.yaml', 0, 0)
}
