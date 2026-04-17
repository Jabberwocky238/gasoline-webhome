import type { Ctx } from '../context'
import { C } from '../ansi'
import { writeContent } from '../../fs/vfs'

// curl — backed by browser fetch(). Flags:
//   -o FILE       write body to FILE instead of stdout (into the VFS)
//   -O            write body to a file named after the URL's last segment
//   -I            HEAD request; print headers only
//   -L            follow redirects (fetch follows by default)
//   -s            silent (no extra output)
//   -X METHOD     HTTP method (default GET, HEAD with -I)
//   -H "K: V"     extra header (repeatable)
//   -d DATA       request body (implies POST if no -X)
//   -f            fail silently on HTTP error (exit 22)
export default async function curl(ctx: Ctx): Promise<void> {
  let outPath: string | null = null
  let useRemoteName = false
  let headOnly = false
  let silent = false
  let failOnError = false
  let method: string | null = null
  const headers: [string, string][] = []
  let body: string | null = null
  const urls: string[] = []

  for (let i = 0; i < ctx.args.length; i++) {
    const a = ctx.args[i]
    if (a === '--') { urls.push(...ctx.args.slice(i + 1)); break }
    if (a === '-o') { outPath = ctx.args[++i] ?? null; continue }
    if (a === '-O') { useRemoteName = true; continue }
    if (a === '-I' || a === '--head') { headOnly = true; continue }
    if (a === '-L' || a === '--location') continue // fetch already follows
    if (a === '-s' || a === '--silent') { silent = true; continue }
    if (a === '-f' || a === '--fail') { failOnError = true; continue }
    if (a === '-X') { method = ctx.args[++i] ?? null; continue }
    if (a === '-H') {
      const h = ctx.args[++i] ?? ''
      const idx = h.indexOf(':')
      if (idx > 0) headers.push([h.slice(0, idx).trim(), h.slice(idx + 1).trim()])
      continue
    }
    if (a === '-d' || a === '--data') {
      body = ctx.args[++i] ?? ''
      if (method === null) method = 'POST'
      continue
    }
    if (a.startsWith('-')) { ctx.err(a, 'unknown option'); ctx.setExit(2); return }
    urls.push(a)
  }
  if (urls.length === 0) {
    ctx.stderr(`${C.red}curl: try 'curl <url>'${C.reset}\n`)
    ctx.setExit(2); return
  }

  const finalMethod = method ?? (headOnly ? 'HEAD' : 'GET')

  for (const url of urls) {
    let res: Response
    try {
      res = await fetch(url, {
        method: finalMethod,
        headers: Object.fromEntries(headers),
        body: body ?? undefined,
        redirect: 'follow',
      })
    } catch (e) {
      ctx.stderr(`${C.red}curl: (6) ${(e as Error).message}${C.reset}\n`)
      ctx.setExit(6); continue
    }
    if (!res.ok && failOnError) {
      if (!silent) ctx.stderr(`${C.red}curl: (22) HTTP ${res.status}${C.reset}\n`)
      ctx.setExit(22); continue
    }
    if (headOnly) {
      const lines: string[] = [`HTTP/1.1 ${res.status} ${res.statusText}`]
      res.headers.forEach((v, k) => lines.push(`${k}: ${v}`))
      ctx.stdout(lines.join('\n') + '\n')
      continue
    }
    const text = await res.text()
    const target = useRemoteName
      ? (url.split('?')[0].split('/').filter(Boolean).pop() ?? 'download.bin')
      : outPath
    if (target) {
      try { writeContent(ctx.user, ctx.resolve(target), text) }
      catch (e) { ctx.reportVfs(e, target); continue }
      if (!silent) {
        ctx.stdout(
          `${C.dim}  % Total    % Received  Time${C.reset}\n` +
          `${C.dim}  100       ${text.length.toString().padStart(10)}  0.0s${C.reset}\n`,
        )
      }
    } else {
      ctx.stdout(text)
    }
  }
}
