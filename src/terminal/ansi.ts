// ANSI colour helpers — xterm.js interprets these escape sequences directly.

export const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
}

// xterm.js wants \r\n for a clean newline — bare \n leaves the cursor in the
// same column on the next row.
export const NL = '\r\n'

// Replace internal \n with xterm's \r\n so output is shown correctly.
export const crlf = (s: string) => s.replace(/\n/g, NL)

// Red-prefixed one-line error, as coreutils style:  `cmd: target: phrase`.
export const errLine = (cmd: string, target: string, phrase: string) =>
  `${C.red}${cmd}: ${target}: ${phrase}${C.reset}`
