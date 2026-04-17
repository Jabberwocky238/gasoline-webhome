// Single registration hub. Import this once from Terminal.tsx so every
// command is wired. Adding a new command = one more file + one line here.

import { registerCommand, registerAliases } from '../registry'

import echo from './echo'
import pwd from './pwd'
import whoami from './whoami'
import cd from './cd'
import ls from './ls'
import cat from './cat'
import tree from './tree'
import about from './about'
import help from './help'
import clear from './clear'
import neofetch from './neofetch'
import uname from './uname'
import env from './env'
import exportCmd from './export'
import unset from './unset'
import history from './history'
import { trueCmd, falseCmd } from './trueFalse'
import { head, tail } from './headTail'
import touch from './touch'
import mkdir from './mkdir'
import rm from './rm'
import rmdir from './rmdir'
import chmod from './chmod'
import chown from './chown'
import chgrp from './chgrp'
import id from './id'
import groups from './groups'
import su from './su'
import grep from './grep'
import sed from './sed'
import man from './man'
import bash from './bash'

registerCommand('echo', echo)
registerCommand('pwd', pwd)
registerCommand('whoami', whoami)
registerCommand('cd', cd)
registerCommand('ls', ls)
registerAliases('ls', ['dir'])
registerCommand('cat', cat)
registerAliases('cat', ['less', 'more'])
registerCommand('tree', tree)
registerCommand('about', about)
registerCommand('help', help)
registerAliases('help', ['?'])
registerCommand('clear', clear)
registerAliases('clear', ['cls'])
registerCommand('neofetch', neofetch)
registerCommand('uname', uname)
registerCommand('env', env)
registerCommand('export', exportCmd)
registerCommand('unset', unset)
registerCommand('history', history)
registerCommand('true', trueCmd)
registerCommand('false', falseCmd)
registerCommand('head', head)
registerCommand('tail', tail)
registerCommand('touch', touch)
registerCommand('mkdir', mkdir)
registerCommand('rm', rm)
registerCommand('rmdir', rmdir)
registerCommand('chmod', chmod)
registerCommand('chown', chown)
registerCommand('chgrp', chgrp)
registerCommand('id', id)
registerCommand('groups', groups)
registerCommand('su', su)
registerCommand('grep', grep)
registerCommand('sed', sed)
registerCommand('man', man)
registerCommand('bash', bash)
registerAliases('bash', ['sh'])

// ll is just 'ls -l' — register as a thin wrapper so args keep flowing.
registerCommand('ll', (ctx) => ls({ ...ctx, args: [...ctx.args, '-l'] }))
