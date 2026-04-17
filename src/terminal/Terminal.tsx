import { useEffect, useRef } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'

import { makeShell, prompt } from './shell'
import { runForTerminal } from './registry'
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

    writeLn(BANNER)
    write(prompt(shell))

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
        write(prompt(shell))
      }
    }

    term.onData((data) => {
      // Split multi-byte paste into chunks so arrow sequences work
      for (let i = 0; i < data.length; i++) {
        const ch = data[i]
        const code = data.charCodeAt(i)

        // Escape sequences (arrow keys etc)
        if (ch === '\x1b' && data[i + 1] === '[') {
          const seq = data[i + 2]
          i += 2
          switch (seq) {
            case 'A': // up — history prev
              if (history.length > 0) {
                if (histIdx === -1) histIdx = history.length - 1
                else if (histIdx > 0) histIdx--
                line = history[histIdx]
                cursor = line.length
                redrawLine()
              }
              break
            case 'B': // down — history next
              if (histIdx !== -1) {
                histIdx++
                if (histIdx >= history.length) {
                  histIdx = -1
                  line = ''
                } else {
                  line = history[histIdx]
                }
                cursor = line.length
                redrawLine()
              }
              break
            case 'C': // right
              if (cursor < line.length) {
                cursor++
                write('\x1b[C')
              }
              break
            case 'D': // left
              if (cursor > 0) {
                cursor--
                write('\x1b[D')
              }
              break
          }
          continue
        }

        if (code === 13) {
          // Enter
          submitLine()
          continue
        }
        if (code === 127 || code === 8) {
          // Backspace
          if (cursor > 0) {
            line = line.slice(0, cursor - 1) + line.slice(cursor)
            cursor--
            redrawLine()
          }
          continue
        }
        if (code === 3) {
          // Ctrl-C — abandon current line
          write('^C' + NL)
          line = ''
          cursor = 0
          histIdx = -1
          write(prompt(shell))
          continue
        }
        if (code === 12) {
          // Ctrl-L — clear
          term.clear()
          write(prompt(shell) + line)
          continue
        }
        if (code < 32) {
          // unhandled control char
          continue
        }
        // Regular printable char — insert at cursor
        line = line.slice(0, cursor) + ch + line.slice(cursor)
        cursor++
        if (cursor === line.length) {
          write(ch)
        } else {
          redrawLine()
        }
      }
    })

    return () => {
      window.removeEventListener('resize', onResize)
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
