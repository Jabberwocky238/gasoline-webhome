import type { Ctx } from '../context'

export default function uname(ctx: Ctx): void {
  if (ctx.args.includes('-a')) {
    ctx.stdout('Gasoline 1.0.0-webhome webhome #1 SMP userspace-vxlan x86_64 GNU/Linux\n')
    return
  }
  ctx.stdout('Gasoline\n')
}
