import type { Ctx } from '../context'
import { C } from '../ansi'
import { findByName, listProcesses, startProcess, stopProcess } from '../../fs/processes'
import { isSudoer } from '../../fs/vfs'

// systemctl — tiny subset: status / start / stop / restart / list-units / is-active.
const HANDLERS: Record<string, (ctx: Ctx, arg?: string) => void> = {
  status: (ctx, unit) => {
    if (!unit) return ctx.err('', 'usage: systemctl status <unit>')
    const name = unit.replace(/\.service$/, '')
    const p = findByName(name)
    if (!p) {
      ctx.stdout(`${C.red}●${C.reset} ${unit} - Not found or inactive\n     Loaded: not-found\n     Active: inactive (dead)\n`)
      ctx.setExit(3); return
    }
    ctx.stdout([
      `${C.green}●${C.reset} ${unit} - gasoline service`,
      `     Loaded: loaded (/etc/systemd/system/${name}.service; enabled)`,
      `     Active: ${C.green}active (running)${C.reset} since ${p.startTime}`,
      `   Main PID: ${p.pid} (${p.name})`,
      `   CGroup: /system.slice/${name}.service`,
      `           └─${p.pid} ${p.cmdline}`,
      '',
    ].join('\n'))
  },
  start: (ctx, unit) => {
    if (!unit) return ctx.err('', 'usage: systemctl start <unit>')
    if (!isSudoer(ctx.user)) return ctx.err(unit, 'Access denied')
    const name = unit.replace(/\.service$/, '')
    if (findByName(name)) { ctx.stdout(`${unit} is already running\n`); return }
    if (name !== 'gasoline') return ctx.err(unit, 'unit not loaded')
    startProcess('gasoline', '/usr/bin/gasoline operator --config /etc/gasoline/config.yaml', 0, 0)
  },
  stop: (ctx, unit) => {
    if (!unit) return ctx.err('', 'usage: systemctl stop <unit>')
    if (!isSudoer(ctx.user)) return ctx.err(unit, 'Access denied')
    const name = unit.replace(/\.service$/, '')
    if (!stopProcess(name)) ctx.err(unit, 'not running or cannot stop')
  },
  restart: (ctx, unit) => {
    if (!unit) return ctx.err('', 'usage: systemctl restart <unit>')
    if (!isSudoer(ctx.user)) return ctx.err(unit, 'Access denied')
    const name = unit.replace(/\.service$/, '')
    stopProcess(name)
    if (name === 'gasoline') startProcess('gasoline', '/usr/bin/gasoline operator --config /etc/gasoline/config.yaml', 0, 0)
  },
  'is-active': (ctx, unit) => {
    if (!unit) return ctx.err('', 'usage: systemctl is-active <unit>')
    const name = unit.replace(/\.service$/, '')
    if (findByName(name)) { ctx.stdout('active\n'); return }
    ctx.stdout('inactive\n'); ctx.setExit(3)
  },
  'list-units': (ctx) => {
    const procs = listProcesses().filter((p) => p.pid !== 1)
    const header = `${C.bold}UNIT                          LOAD   ACTIVE SUB     DESCRIPTION${C.reset}`
    const rows = procs.map((p) =>
      `${(p.name + '.service').padEnd(30)}loaded active running ${p.name}`,
    )
    ctx.stdout([header, ...rows, '', `${rows.length} loaded units listed.`, ''].join('\n'))
  },
}

export default function systemctl(ctx: Ctx): void {
  if (ctx.args.length === 0) { HANDLERS['list-units'](ctx); return }
  const sub = ctx.args[0]
  const fn = HANDLERS[sub]
  if (!fn) { ctx.err(sub, 'unknown verb'); return }
  fn(ctx, ctx.args[1])
}
