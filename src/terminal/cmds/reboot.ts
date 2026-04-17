import type { Ctx } from '../context'
import { wipeVfs, flushSave } from '../../fs/persist'

// reboot — wipe the IDB snapshot and reload the tab so the VFS boots from
// defaults. Prompts for [y]/n unless `-f` is given. Refused inside any
// script unless that script is .bashrc (shell.allowReboot is set).
export default async function reboot(ctx: Ctx): Promise<void> {
  if (ctx.script && !ctx.shell.allowReboot) {
    return ctx.err('reboot', 'cannot reboot from a script')
  }
  const force = ctx.args.includes('-f') || ctx.args.includes('--force')
  let answer = 'y'
  if (!force) answer = (await ctx.ask('Reboot? [y]/n ')).trim()
  const yes = answer === '' || /^y/i.test(answer)
  if (!yes) { ctx.stdout('aborted\n'); return }
  await flushSave()     // make sure we don't race an outgoing save
  await wipeVfs()
  // Give the terminal a chance to render the final message before reload.
  ctx.stdout('rebooting...\n')
  if (typeof location !== 'undefined') {
    setTimeout(() => location.reload(), 50)
  }
}
