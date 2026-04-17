import type { Ctx } from '../context'
import { C } from '../ansi'

export default function help(ctx: Ctx): void {
  const lines = [
    `${C.bold}Builtin commands${C.reset}`,
    `  ${C.cyan}ls${C.reset} [-laRh] [path]   list directory`,
    `  ${C.cyan}cd${C.reset} <dir>           change directory`,
    `  ${C.cyan}pwd${C.reset}                print working directory`,
    `  ${C.cyan}cat${C.reset} [file ...]      dump content (or stdin)`,
    `  ${C.cyan}head${C.reset}/${C.cyan}tail${C.reset} [-n N] file`,
    `  ${C.cyan}tree${C.reset} [path]         recursive layout`,
    `  ${C.cyan}grep${C.reset} [-iEnv] pat [file]`,
    `  ${C.cyan}sed${C.reset}  's/pat/rep/gi' [-i] [file]`,
    `  ${C.cyan}echo${C.reset} <text>`,
    `  ${C.cyan}touch${C.reset} <file>        create empty / update mtime`,
    `  ${C.cyan}mkdir${C.reset} [-p] <dir>    create dir(s)`,
    `  ${C.cyan}rm${C.reset}    [-rf] <target>`,
    `  ${C.cyan}rmdir${C.reset} <dir>         remove empty dir`,
    `  ${C.cyan}chmod${C.reset} <mode> <path>`,
    `  ${C.cyan}chown${C.reset}/${C.cyan}chgrp${C.reset}    owner/group change`,
    `  ${C.cyan}id${C.reset}/${C.cyan}groups${C.reset}/${C.cyan}whoami${C.reset}  identity`,
    `  ${C.cyan}env${C.reset}/${C.cyan}export${C.reset}/${C.cyan}unset${C.reset} VAR[=value]`,
    `  ${C.cyan}su${C.reset} <user>           switch identity (no password)`,
    `  ${C.cyan}history${C.reset}             recent commands`,
    `  ${C.cyan}about${C.reset}/${C.cyan}neofetch${C.reset}/${C.cyan}uname${C.reset}/${C.cyan}man${C.reset}  info`,
    `  ${C.cyan}clear${C.reset}               clear screen`,
    `  ${C.cyan}true${C.reset}/${C.cyan}false${C.reset}           exit 0 / 1`,
    '',
    `${C.bold}Shell features${C.reset}  ${C.dim}pipes (|), &&, ||, ;, > >> <,${C.reset}`,
    `                ${C.dim}\$VAR / \${VAR} / \$(cmd), globs (* ? [abc]),${C.reset}`,
    `                ${C.dim}quotes ('' ""), ./script.sh executes${C.reset}`,
    '',
    `${C.dim}Try:${C.reset} ${C.yellow}cat README.md${C.reset}  ${C.yellow}./hello.sh${C.reset}  ${C.yellow}ls /bin | grep se${C.reset}`,
  ]
  ctx.stdout(lines.join('\n') + '\n')
}
