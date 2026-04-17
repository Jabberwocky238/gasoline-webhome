// Ctx is the only thing a command sees. Every command takes a Ctx, writes
// to stdout/stderr, sets an exit code, and returns. Shared helpers live here
// so commands don't have to import vfs + ansi + shell + path-resolution.

import {
  lookup,
  resolvePath,
  VfsError,
  errnoPhrase,
  type VNode,
  type UserId,
} from '../fs/vfs'
import { C, errLine } from './ansi'
import type { Shell } from './shell'

export interface Ctx {
  // identity
  shell: Shell
  user: UserId
  name: string          // argv[0]
  args: string[]        // argv[1..]
  // io — plain strings; writer accumulates into a buffer owned by the runner
  stdin: string
  stdout: (s: string) => void
  stderr: (s: string) => void
  // exit
  exitCode: number
  setExit: (n: number) => void
  // helpers
  resolve: (arg: string) => string[]
  lookup: (path: string[]) => VNode | null
  // VfsError → nicely formatted stderr line with the right phrase.
  // Returns the exit code you should set (1) so call sites can one-line it.
  reportVfs: (e: unknown, target: string) => number
  // generic "cmd: target: phrase" line
  err: (target: string, phrase: string) => void
}

// Factory — given a shell + io wiring, produce a Ctx for one command run.
export function makeCtx(params: {
  shell: Shell
  name: string
  args: string[]
  stdin: string
  stdout: (s: string) => void
  stderr: (s: string) => void
}): Ctx {
  const { shell, name, args, stdin, stdout, stderr } = params
  const ctx: Ctx = {
    shell,
    user: shell.user,
    name,
    args,
    stdin,
    stdout,
    stderr,
    exitCode: 0,
    setExit: (n) => { ctx.exitCode = n },
    resolve: (arg) => resolvePath(shell.cwd, arg),
    lookup,
    reportVfs: (e, target) => {
      if (e instanceof VfsError) {
        stderr(errLine(name, target, errnoPhrase(e.code)) + '\n')
      } else {
        stderr(`${C.red}${name}: ${target}: ${(e as Error).message}${C.reset}\n`)
      }
      ctx.exitCode = 1
      return 1
    },
    err: (target, phrase) => {
      stderr(errLine(name, target, phrase) + '\n')
      ctx.exitCode = 1
    },
  }
  return ctx
}
