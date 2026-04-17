import type { Ctx } from '../context'
import { C } from '../ansi'

// man — tiny summary table. Not a full man page.
const MAN: Record<string, string> = {
  ls:    'ls [-laRh] [path ...]     list directory contents',
  cat:   'cat [file ...]            concatenate & print files (or stdin)',
  cd:    'cd [dir]                  change working directory',
  pwd:   'pwd                        print working directory',
  echo:  'echo [-n] [args ...]       print args',
  grep:  'grep [-iEnvcHh] pat [file] regex line filter',
  sed:   "sed [-iE] 's/pat/rep/flags' [file]   stream editor",
  head:  'head [-n N] [file]         first N lines (default 10)',
  tail:  'tail [-n N] [file]         last N lines',
  touch: 'touch <file>               create empty / update mtime',
  mkdir: 'mkdir [-p] <dir>           create directory',
  rm:    'rm [-rf] <target ...>      remove files / directories',
  rmdir: 'rmdir <dir>                remove empty directory',
  chmod: 'chmod <mode> <path>        change mode bits (octal or symbolic)',
  chown: 'chown user[:group] <path>  change owner',
  chgrp: 'chgrp <group> <path>       change group',
  id:    'id [user]                  print identity',
  groups:'groups [user]              print groups',
  env:   'env                        print environment',
  export:'export VAR=value           set env variable',
  unset: 'unset VAR                  delete env variable',
  su:    'su <user>                  switch identity (no password)',
  tree:  'tree [path]                recursive layout',
  clear: 'clear                      clear screen',
  history: 'history                  list recent commands',
  uname: 'uname [-a]                 system info',
  about: 'about                      about this demo',
  help:  'help                       list builtins',
}

export default function man(ctx: Ctx): void {
  const topic = ctx.args[0]
  if (!topic) {
    ctx.stderr(`${C.red}What manual page do you want?${C.reset}\n`)
    ctx.setExit(1); return
  }
  const entry = MAN[topic]
  if (!entry) {
    ctx.stderr(`${C.red}No manual entry for ${topic}${C.reset}\n`)
    ctx.setExit(16); return
  }
  ctx.stdout(`${C.bold}NAME${C.reset}\n        ${topic}\n\n${C.bold}SYNOPSIS${C.reset}\n        ${entry}\n`)
}
