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
  // name → replacement string (`alias ll='ls -la'` stores `ls -la` here).
  aliases: Record<string, string>
  // Execution context (managed by registry.runScript).
  scriptDepth: number
  allowReboot: boolean
  // Interactive prompt: reboot asks "Reboot? [y]/n"; Terminal reads the next
  // submitted line and calls resolve() with it instead of running it.
  pendingPrompt?: { resolve: (answer: string) => void }
  // Terminal plugs a writer here so commands can emit real-time output
  // (prompts, progress) without waiting for the runLine to finish.
  writeTerm?: (s: string) => void
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
    aliases: {
      // A couple of shipped defaults mirroring common bash aliases.
      la: 'ls -a',
      l: 'ls -CF',
    },
    scriptDepth: 0,
    allowReboot: false,
  }
}

export function prompt(sh: Shell): string {
  const userColor = sh.user.uid === 0 ? C.red : C.green
  const sigil = sh.user.uid === 0 ? '#' : '$'
  return `${userColor}${C.bold}${sh.user.name}@gasoline.network${C.reset}:${C.blue}${C.bold}${prettyPath(sh.cwd)}${C.reset}${sigil} `
}
