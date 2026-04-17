import { useEffect, useRef } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'

import { makeShell, prompt } from './shell'
import { runForTerminal, runScript } from './registry'
import { complete } from './complete'
import { readFile, lookup, resolvePath, writeContent, USERS, type VFile } from '../fs/vfs'
import {
  loadVfs, seedDefault, loadProfile, scheduleSave, flushSave,
  isInitialized, markInitialized, prefetchInitialContent, saveVfs,
} from '../fs/persist'
import { flushAccountFiles, rehydrateFromFiles } from '../fs/accounts'
import { initProcesses } from '../fs/processes'
import { crlf } from './ansi'
import './cmds' // register all builtins

const NL = '\r\n'

const BANNER = [
  '\x1b[35m\x1b[1m',
  '   ____  _    ____ ___  _     ___ _   _ _____ ',
  '  / ___|/ \\  / ___/ _ \\| |   |_ _| \\ | | ____|',
  ' | |  _/ _ \\ \\___ \\ | | | |    | ||  \\| |  _|  ',
  ' | |_| / ___ \\ ___) | |_| | |___ | || |\\  | |___ ',
  '  \\____/_/   \\_\\____/\\___/|_____|___|_| \\_|_____|',
  '\x1b[0m',
  '',
  '\x1b[90m  userspace VXLAN overlay · L2 routing by (VNI, VMAC) · RFC 7348 wire\x1b[0m',
  '',
  '  Try: \x1b[36mls\x1b[0m   \x1b[36mcat README.md\x1b[0m   \x1b[36mabout\x1b[0m   \x1b[36mhelp\x1b[0m   \x1b[36mneofetch\x1b[0m',
  '',
].join(NL)

export default function Terminal() {
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!containerRef.current) return

    const term = new XTerm({
      cursorBlink: true,
      fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
      fontSize: 14,
      lineHeight: 1.25,
      theme: {
        background: '#0d0f14',
        foreground: '#d1d5db',
        cursor: '#c084fc',
        cursorAccent: '#0d0f14',
        selectionBackground: 'rgba(192,132,252,0.3)',
        black: '#16171d',
        red: '#f87171',
        green: '#4ade80',
        yellow: '#fbbf24',
        blue: '#60a5fa',
        magenta: '#c084fc',
        cyan: '#22d3ee',
        white: '#e5e7eb',
        brightBlack: '#4b5563',
        brightRed: '#fca5a5',
        brightGreen: '#86efac',
        brightYellow: '#fcd34d',
        brightBlue: '#93c5fd',
        brightMagenta: '#d8b4fe',
        brightCyan: '#67e8f9',
        brightWhite: '#f3f4f6',
      },
      scrollback: 2000,
    })
    const fit = new FitAddon()
    const links = new WebLinksAddon()
    term.loadAddon(fit)
    term.loadAddon(links)
    term.open(containerRef.current)
    // Defer the first fit — some browsers report 0×0 for a flex child until the
    // layout pass completes. One microtask later we always have real dimensions.
    queueMicrotask(() => {
      try {
        fit.fit()
      } catch {
        /* container detached */
      }
    })

    const onResize = () => {
      try {
        fit.fit()
      } catch {
        /* noop */
      }
    }
    window.addEventListener('resize', onResize)
    const ro = new ResizeObserver(onResize)
    ro.observe(containerRef.current)

    // ------- REPL state -------
    const shell = makeShell()
    let line = ''
    let cursor = 0 // column position within `line`
    const history: string[] = []
    let histIdx = -1 // -1 = editing fresh line

    const write = (s: string) => term.write(s)
    const writeLn = (s = '') => term.writeln(s)

    // Real-time writer used by ctx.ask so interactive prompts like
    // `Reboot? [y]/n ` surface before the calling command's runLine settles.
    shell.writeTerm = (s) => term.write(s)

    writeLn(BANNER)
    // `initializing...` placeholder while we load IDB / run .profile / .bashrc.
    write('\x1b[90minitializing...\x1b[0m')
    // Async boot: load VFS, run .profile (no-reboot), run .bashrc (reboot ok).
    let booting = true
    ;(async () => {
      try {
        // First-boot decision hinges on the `initialized` flag. If absent,
        // seed defaults, pre-fetch shipped file content, and persist so
        // subsequent reloads come straight from IDB without network I/O.
        const already = await isInitialized()
        if (already) {
          await loadVfs()
        } else {
          seedDefault()
          await prefetchInitialContent()
          await saveVfs()
          await markInitialized()
        }
        // Rehydrate accounts from /etc/{passwd,group,shadow} (if we just
        // restored from IDB those files may already hold user edits).
        await rehydrateFromFiles()
        flushAccountFiles()
        // Bring up pid 1 + autostart gasoline service.
        initProcesses()
        // Re-inject persisted .profile (localStorage) into the VFS.
        const profileText = loadProfile()
        if (profileText && profileText.length > 0) {
          const target = resolvePath(shell.cwd, '/home/visitor/.profile')
          try { writeContent(USERS.visitor, target, profileText) } catch { /* ignore */ }
        }
        // Run .profile (reboot disallowed).
        const profileNode = lookup(['home', 'visitor', '.profile'])
        if (profileNode && profileNode.kind === 'file') {
          const txt = await readFile(profileNode as VFile)
          if (txt.trim()) {
            const r = await runScript(shell, txt, ['~/.profile'], { allowReboot: false })
            if (r.out) term.write(crlf(r.out))
          }
        }
        // Run .bashrc (reboot allowed — user can self-destruct on boot, weird
        // but explicitly requested).
        const bashrcNode = lookup(['home', 'visitor', '.bashrc'])
        if (bashrcNode && bashrcNode.kind === 'file') {
          const txt = await readFile(bashrcNode as VFile)
          if (txt.trim()) {
            const r = await runScript(shell, txt, ['~/.bashrc'], { allowReboot: true })
            if (r.out) term.write(crlf(r.out))
          }
        }
      } finally {
        booting = false
        // Wipe the `initializing...` line and paint the prompt.
        write('\x1b[2K\r')
        write(prompt(shell))
      }
    })()

    const redrawLine = () => {
      // Erase current input line and redraw. Prompt stays as-is.
      write('\x1b[2K\r')
      write(prompt(shell) + line)
      // move cursor back if not at end
      const overshoot = line.length - cursor
      if (overshoot > 0) write(`\x1b[${overshoot}D`)
    }

    let busy = false
    const submitLine = async () => {
      // Still booting — ignore keystrokes so we don't race .profile/.bashrc.
      if (booting) return
      // Outstanding ctx.ask? Resolve with what the user typed. The runLine
      // that initiated the ask is still awaiting its promise — it will
      // finish and hit the finally block below, which handles the prompt.
      if (shell.pendingPrompt) {
        const q = shell.pendingPrompt
        shell.pendingPrompt = undefined
        write(NL)
        const answer = line
        line = ''; cursor = 0; histIdx = -1
        q.resolve(answer)
        return
      }
      if (busy) return
      busy = true
      write(NL)
      const cmd = line
      if (cmd.trim()) {
        history.push(cmd)
        shell.history.push(cmd)
        if (history.length > 500) history.shift()
      }
      histIdx = -1
      line = ''
      cursor = 0
      try {
        const out = await runForTerminal(shell, cmd)
        if (out) writeLn(out)
      } catch (e) {
        writeLn(`\x1b[31m${(e as Error).message}\x1b[0m`)
      } finally {
        busy = false
        scheduleSave()
        write(prompt(shell))
      }
    }

    // ---------- line editing primitives ----------
    const moveHome = () => {
      if (cursor === 0) return
      cursor = 0
      redrawLine()
    }
    const moveEnd = () => {
      if (cursor === line.length) return
      cursor = line.length
      redrawLine()
    }
    const moveLeft = () => {
      if (cursor > 0) { cursor--; write('\x1b[D') }
    }
    const moveRight = () => {
      if (cursor < line.length) { cursor++; write('\x1b[C') }
    }
    const backspace = () => {
      if (cursor > 0) {
        line = line.slice(0, cursor - 1) + line.slice(cursor)
        cursor--
        redrawLine()
      }
    }
    const forwardDelete = () => {
      if (cursor < line.length) {
        line = line.slice(0, cursor) + line.slice(cursor + 1)
        redrawLine()
      }
    }
    const killBefore = () => {
      if (cursor === 0) return
      line = line.slice(cursor)
      cursor = 0
      redrawLine()
    }
    const killAfter = () => {
      if (cursor === line.length) return
      line = line.slice(0, cursor)
      redrawLine()
    }
    const killWordBack = () => {
      let p = cursor
      while (p > 0 && /\s/.test(line[p - 1])) p--
      while (p > 0 && !/\s/.test(line[p - 1])) p--
      if (p === cursor) return
      line = line.slice(0, p) + line.slice(cursor)
      cursor = p
      redrawLine()
    }
    const historyPrev = () => {
      if (history.length === 0) return
      if (histIdx === -1) histIdx = history.length - 1
      else if (histIdx > 0) histIdx--
      line = history[histIdx]
      cursor = line.length
      redrawLine()
    }
    const historyNext = () => {
      if (histIdx === -1) return
      histIdx++
      if (histIdx >= history.length) { histIdx = -1; line = '' }
      else line = history[histIdx]
      cursor = line.length
      redrawLine()
    }
    const insertText = (s: string) => {
      if (!s) return
      // Normalize CR so pasted text flows through the same edit path.
      // \n in pasted text is intentionally left alone — it triggers submit
      // below when handleChar sees code 13.
      const text = s.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
      for (const ch of text) {
        const code = ch.charCodeAt(0)
        if (code === 10) { submitLine(); continue }
        if (code < 32) continue
        line = line.slice(0, cursor) + ch + line.slice(cursor)
        cursor++
        if (cursor === line.length) write(ch); else redrawLine()
      }
    }
    const completeTab = () => {
      const r = complete(shell, line, cursor)
      if (r.list && r.list.length > 1) {
        write(NL)
        write(r.list.join('  ') + NL)
        line = r.newLine
        cursor = r.newCursor
        write(prompt(shell) + line)
        const overshoot = line.length - cursor
        if (overshoot > 0) write(`\x1b[${overshoot}D`)
        return
      }
      line = r.newLine
      cursor = r.newCursor
      redrawLine()
    }

    // ---------- key dispatch ----------
    const handleCSI = (params: string, final: string) => {
      switch (final) {
        case 'A': historyPrev(); break
        case 'B': historyNext(); break
        case 'C': moveRight(); break
        case 'D': moveLeft(); break
        case 'H': moveHome(); break
        case 'F': moveEnd(); break
        case '~':
          if (params === '1' || params === '7') moveHome()
          else if (params === '4' || params === '8') moveEnd()
          else if (params === '3') forwardDelete()
          break
      }
    }
    const handleChar = (code: number, ch: string) => {
      if (code === 13) { submitLine(); return }              // Enter
      if (code === 9)  { completeTab(); return }             // Tab
      if (code === 127 || code === 8) { backspace(); return }
      if (code === 1)  { moveHome(); return }                // Ctrl-A
      if (code === 5)  { moveEnd();  return }                // Ctrl-E
      if (code === 21) { killBefore(); return }              // Ctrl-U
      if (code === 11) { killAfter();  return }              // Ctrl-K
      if (code === 23) { killWordBack(); return }            // Ctrl-W
      if (code === 3)  {                                      // Ctrl-C
        write('^C' + NL)
        line = ''; cursor = 0; histIdx = -1
        write(prompt(shell))
        return
      }
      if (code === 12) {                                      // Ctrl-L
        term.clear()
        write(prompt(shell) + line)
        return
      }
      if (code === 4)  { return }                            // Ctrl-D (no-op)
      if (code < 32)   return
      insertText(ch)
    }

    term.onData((data) => {
      let i = 0
      while (i < data.length) {
        const ch = data[i]
        // CSI:  ESC [ <params> <final>
        if (ch === '\x1b' && data[i + 1] === '[') {
          let j = i + 2
          while (j < data.length && !/[A-Za-z~]/.test(data[j])) j++
          if (j >= data.length) break
          handleCSI(data.slice(i + 2, j), data[j])
          i = j + 1
          continue
        }
        // SS3:  ESC O <final>  (application-mode cursor keys)
        if (ch === '\x1b' && data[i + 1] === 'O') {
          if (i + 2 >= data.length) break
          handleCSI('', data[i + 2])
          i += 3
          continue
        }
        if (ch === '\x1b') { i++; continue } // stray ESC
        handleChar(ch.charCodeAt(0), ch)
        i++
      }
    })

    // ---------- browser-key hijack + paste ----------
    // Keep keys the browser would swallow (Tab, Ctrl-W, Ctrl-V) inside the
    // terminal. For Ctrl-V we also go read the clipboard ourselves, because
    // xterm's default Ctrl-V is "insert the literal \x16 char".
    term.attachCustomKeyEventHandler((ev) => {
      if (ev.type !== 'keydown') return true
      if (ev.key === 'Tab') { ev.preventDefault(); return true }
      const modV = (ev.ctrlKey || ev.metaKey) && !ev.shiftKey && ev.key.toLowerCase() === 'v'
      if (modV) {
        ev.preventDefault()
        navigator.clipboard
          ?.readText()
          .then((t) => { if (t) insertText(t) })
          .catch(() => { /* permission denied — user will use the context menu */ })
        return false
      }
      const modW = (ev.ctrlKey || ev.metaKey) && !ev.shiftKey && ev.key.toLowerCase() === 'w'
      if (modW) { ev.preventDefault(); return true }
      return true
    })

    // Middle-click paste and context-menu paste: the container fires a
    // standard DOM `paste` event with clipboardData available synchronously.
    const onPaste = (ev: ClipboardEvent) => {
      const text = ev.clipboardData?.getData('text') ?? ''
      if (!text) return
      ev.preventDefault()
      insertText(text)
    }
    containerRef.current.addEventListener('paste', onPaste)

    const onBeforeUnload = () => { void flushSave() }
    window.addEventListener('beforeunload', onBeforeUnload)

    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('beforeunload', onBeforeUnload)
      containerRef.current?.removeEventListener('paste', onPaste)
      ro.disconnect()
      term.dispose()
    }
  }, [])

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        background: '#0d0f14',
        padding: '16px',
        boxSizing: 'border-box',
        display: 'flex',
      }}
    >
      <div
        ref={containerRef}
        style={{ flex: 1, minHeight: 0, minWidth: 0, overflow: 'hidden' }}
      />
    </div>
  )
}
