import type { Ctx } from '../context'
import { ABOUT_TEXT } from '../../fs/vfs'

export default function about(ctx: Ctx): void {
  ctx.stdout(ABOUT_TEXT + '\n')
}
