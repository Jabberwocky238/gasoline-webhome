import type { Ctx } from '../context'
import { C } from '../ansi'

export default function neofetch(ctx: Ctx): void {
  const agent = typeof navigator !== 'undefined' ? navigator.userAgent.split(' ')[0] : 'tsx'
  const user = ctx.user.name
  const lines = [
    `${C.magenta}       .--------.${C.reset}     ${C.bold}${user}${C.reset}@${C.bold}gasoline${C.reset}`,
    `${C.magenta}      /          \\${C.reset}    ${C.dim}---------------${C.reset}`,
    `${C.magenta}     |   gasoline |${C.reset}   ${C.cyan}OS${C.reset}:        Gasoline 1.0.0-webhome`,
    `${C.magenta}      \\          /${C.reset}    ${C.cyan}Kernel${C.reset}:    userspace-vxlan`,
    `${C.magenta}       '--------'${C.reset}     ${C.cyan}Shell${C.reset}:     vsh (xterm.js)`,
    `       ${C.yellow}//${C.reset}              ${C.cyan}Terminal${C.reset}:  ${agent}`,
    `      ${C.yellow}//${C.reset}               ${C.cyan}Transport${C.reset}: QUIC | TLS | TCP | UDP`,
    `     ${C.yellow}//${C.reset}                ${C.cyan}Encap${C.reset}:     VXLAN (RFC 7348)`,
    `    ${C.yellow}//${C.reset}                 ${C.cyan}Crypto${C.reset}:    ChaCha20-Poly1305`,
    `   ${C.yellow}//${C.reset}                  ${C.cyan}L2 Identity${C.reset}: VNI (24-bit) + VMAC (6 B)`,
  ]
  ctx.stdout(lines.join('\n') + '\n')
}
