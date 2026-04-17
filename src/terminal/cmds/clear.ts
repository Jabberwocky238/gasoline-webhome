import type { Ctx } from '../context'

// clear — xterm interprets these as: clear screen, clear scrollback, home.
export default function clear(ctx: Ctx): void {
  ctx.stdout('\x1b[2J\x1b[3J\x1b[H')
}
