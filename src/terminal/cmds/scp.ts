import type { Ctx } from '../context'
import {
  readFile,
  writeContent,
  lookup,
  resolvePath,
  hasPerm,
  type VFile,
} from '../../fs/vfs'
import { C } from '../ansi'

// scp — browser-flavoured transfer:
//   scp user@host:/remote  local_name    → download (remote is our VFS,
//                                          result saved via <a download>)
//   scp local_name  user@host:/remote    → upload (open file picker, read
//                                          the picked file, write its text
//                                          into our VFS at /remote)
//
// Detection: exactly one side must match the user@host:/path pattern.
// We don't validate host/user — any non-empty values are accepted because
// there's no real network involved.

const REMOTE_RE = /^([^@\s]+)@([^:\s]+):(.+)$/

interface RemotePart { user: string; host: string; path: string }
function parseRemote(s: string): RemotePart | null {
  const m = REMOTE_RE.exec(s)
  if (!m) return null
  return { user: m[1], host: m[2], path: m[3] }
}

export default async function scp(ctx: Ctx): Promise<void> {
  if (ctx.args.length < 2) return ctx.err('', 'missing operand')
  const a = ctx.args[0]
  const b = ctx.args[1]
  const ra = parseRemote(a)
  const rb = parseRemote(b)
  if (ra && rb) {
    return ctx.err('', 'remote-to-remote copy not supported in this demo')
  }
  if (!ra && !rb) {
    return ctx.err('', 'one side must be user@host:/path')
  }

  if (ra && !rb) return download(ctx, ra, b)
  if (rb && !ra) return upload(ctx, a, rb)
}

// remote → local: read from VFS, trigger browser download of the bytes.
async function download(ctx: Ctx, remote: RemotePart, local: string): Promise<void> {
  const path = resolvePath(ctx.shell.cwd, remote.path)
  const node = lookup(path)
  if (!node) return ctx.err(remote.path, 'No such file or directory')
  if (node.kind !== 'file') return ctx.err(remote.path, 'Not a regular file')
  if (!hasPerm(ctx.user, node, 'r')) return ctx.err(remote.path, 'Permission denied')

  const f = node as VFile
  const suggested = local === '.' || local === '' ? f.name : local.split('/').pop() || f.name
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    ctx.stdout(
      `${C.dim}[scp] would download ${remote.path} → ${suggested}${C.reset}\n`,
    )
    return
  }
  // Platform binaries with a real release URL: hand off to the browser so
  // the bytes stream straight from the origin (Content-Disposition hits
  // disk). Saves us fetching + blobbing a 28MB binary in-tab.
  if (f.extPlatform && f.url) {
    const anchor = document.createElement('a')
    anchor.href = f.url
    anchor.download = suggested
    anchor.rel = 'noopener'
    document.body.appendChild(anchor)
    anchor.click()
    document.body.removeChild(anchor)
    ctx.stdout(`${C.dim}${remote.user}@${remote.host}:${remote.path}${C.reset} → ${suggested} ${C.green}(streaming from ${f.url})${C.reset}\n`)
    return
  }
  // Normal case — read the VFS content and save it as a blob.
  const text = await readFile(f)
  const blob = new Blob([text], { type: 'application/octet-stream' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = suggested
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  setTimeout(() => URL.revokeObjectURL(url), 1_000)
  ctx.stdout(`${C.dim}${remote.user}@${remote.host}:${remote.path}${C.reset} → ${suggested} ${C.green}(${text.length} B)${C.reset}\n`)
}

// local → remote: open a file picker so the user attaches an actual file
// from their machine; store its text at the remote path inside our VFS.
async function upload(ctx: Ctx, local: string, remote: RemotePart): Promise<void> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    ctx.stderr(`${C.red}scp: file picker unavailable in this environment${C.reset}\n`)
    ctx.setExit(1); return
  }
  const dest = resolvePath(ctx.shell.cwd, remote.path)
  const picked = await pickFile()
  if (!picked) {
    ctx.stdout(`${C.dim}scp: cancelled${C.reset}\n`); return
  }
  try {
    writeContent(ctx.user, dest, picked.text)
  } catch (e) {
    ctx.reportVfs(e, remote.path); return
  }
  ctx.stdout(
    `${picked.name} → ${C.dim}${remote.user}@${remote.host}:${remote.path}${C.reset} ${C.green}(${picked.text.length} B)${C.reset}\n`,
  )
  // eslint-disable-next-line no-void
  void local // unused; kept so the CLI signature matches real scp
}

// Single-file picker that resolves to {name, text} or null on cancel.
function pickFile(): Promise<{ name: string; text: string } | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.style.display = 'none'
    let settled = false
    const finish = (v: { name: string; text: string } | null) => {
      if (settled) return
      settled = true
      input.remove()
      resolve(v)
    }
    input.addEventListener('change', () => {
      const f = input.files?.[0]
      if (!f) return finish(null)
      const reader = new FileReader()
      reader.onload = () => finish({ name: f.name, text: (reader.result as string) ?? '' })
      reader.onerror = () => finish(null)
      reader.readAsText(f)
    })
    // "cancel" only fires in modern browsers; fall back to a window-focus
    // heuristic for older ones.
    input.addEventListener('cancel', () => finish(null))
    document.body.appendChild(input)
    input.click()
    const onFocus = () => setTimeout(() => {
      if (!input.files || input.files.length === 0) finish(null)
    }, 400)
    window.addEventListener('focus', onFocus, { once: true })
  })
}
