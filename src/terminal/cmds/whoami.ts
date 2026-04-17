import type { Ctx } from '../context'

export default function whoami(ctx: Ctx): void {
  ctx.stdout(ctx.user.name + '\n')
}
