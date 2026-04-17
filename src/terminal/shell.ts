import { HOME_PATH, USERS, prettyPath, type UserId } from '../fs/vfs'
import { C } from './ansi'

// Per-session shell state. One instance lives for the lifetime of the xterm.
export interface Shell {
  cwd: string[]
  env: Record<string, string>
  user: UserId
  history: string[]
  // Last `?`-style exit status — lets scripts test command success via $?.
  lastStatus: number
}

export function makeShell(user: UserId = USERS.visitor): Shell {
  return {
    cwd: [...HOME_PATH],
    env: {
      HOME: '/home/visitor',
      USER: user.name,
      SHELL: '/bin/vsh',
      PATH: '/usr/local/bin:/usr/bin:/bin',
      PWD: '/home/visitor',
      TERM: 'xterm-256color',
      '?': '0',
    },
    user,
    history: [],
    lastStatus: 0,
  }
}

export function prompt(sh: Shell): string {
  const userColor = sh.user.uid === 0 ? C.red : C.green
  const sigil = sh.user.uid === 0 ? '#' : '$'
  return `${userColor}${C.bold}${sh.user.name}@gasoline${C.reset}:${C.blue}${C.bold}${prettyPath(sh.cwd)}${C.reset}${sigil} `
}
