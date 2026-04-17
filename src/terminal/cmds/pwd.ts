import type { Ctx } from '../context'
import { absPath } from '../../fs/vfs'

export default function pwd(ctx: Ctx): void {
  ctx.stdout(absPath(ctx.shell.cwd) + '\n')
}
