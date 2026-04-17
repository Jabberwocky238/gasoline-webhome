import type { Ctx } from '../context'

export default function uname(ctx: Ctx): void {
  if (ctx.args.includes('-a')) {
    ctx.stdout('Gasoline gasoline.network 1.0.0-webhome #1 SMP userspace-vxlan x86_64 GNU/Linux\n')
    return
  }
  ctx.stdout('Gasoline\n')
}
