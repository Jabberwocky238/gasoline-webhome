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
import ln from './ln'
import scp from './scp'
import alias from './alias'
import unalias from './unalias'
import reboot from './reboot'
import curl from './curl'
import sudo from './sudo'
import ssh from './ssh'
import useradd from './useradd'
import userdel from './userdel'
import groupadd from './groupadd'
import groupdel from './groupdel'
import passwd from './passwd'
import systemctl from './systemctl'
import ifconfig from './ifconfig'

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
registerCommand('ln', ln)
registerCommand('scp', scp)
registerCommand('alias', alias)
registerCommand('unalias', unalias)
registerCommand('reboot', reboot)
registerCommand('curl', curl)
registerCommand('sudo', sudo)
registerCommand('ssh', ssh)
registerCommand('useradd', useradd)
registerCommand('userdel', userdel)
registerCommand('groupadd', groupadd)
registerCommand('groupdel', groupdel)
registerCommand('passwd', passwd)
registerCommand('systemctl', systemctl)
registerCommand('ifconfig', ifconfig)

// `ll` is NOT registered as a command — it lives as an alias in .bashrc
// (`alias ll='ls -la'`). Aliases are expanded by runSimple before dispatch.
