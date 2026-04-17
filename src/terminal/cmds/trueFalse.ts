import type { Ctx } from '../context'

// /bin/true and /bin/false — they exist only to set $?.
export function trueCmd(ctx: Ctx): void { ctx.setExit(0) }
export function falseCmd(ctx: Ctx): void { ctx.setExit(1) }
