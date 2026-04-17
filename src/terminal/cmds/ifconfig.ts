import type { Ctx } from '../context'
import { C } from '../ansi'

// ifconfig — always shows `lo` (127.0.0.1) and `eth0`. The eth0 IPv4 is
// fetched live from a public lookup service on first call, then cached for
// the lifetime of the tab. Falls back to "unknown" if the request fails.

let cachedIp: string | null = null
let cachedMac: string | null = null

async function fetchPublicIp(): Promise<string | null> {
  // ipify is CORS-friendly; ipinfo works too. Try both.
  const endpoints = [
    'https://api.ipify.org?format=json',
    'https://ipinfo.io/json',
  ]
  for (const url of endpoints) {
    try {
      const r = await fetch(url)
      if (!r.ok) continue
      const j = await r.json()
      const ip = j.ip ?? j.query
      if (typeof ip === 'string') return ip
    } catch { /* try next */ }
  }
  return null
}

function randomMac(): string {
  const hex = () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0')
  // Locally administered unicast — set b1 of first octet, clear b0.
  return ['02', hex(), hex(), hex(), hex(), hex()].join(':')
}

export default async function ifconfig(ctx: Ctx): Promise<void> {
  if (cachedIp === null) cachedIp = (await fetchPublicIp()) ?? 'unknown'
  if (cachedMac === null) cachedMac = randomMac()
  const eth0 = cachedIp
  const mac = cachedMac
  const lines = [
    `${C.bold}eth0${C.reset}: flags=4163<UP,BROADCAST,RUNNING,MULTICAST>  mtu 1500`,
    `        inet ${eth0}  netmask 255.255.255.0  broadcast ${broadcastFor(eth0)}`,
    `        inet6 fe80::${mac.slice(0,2)}${mac.slice(3,5)}:${mac.slice(6,8)}ff:fe${mac.slice(9,11)}:${mac.slice(12,14)}${mac.slice(15,17)}  prefixlen 64  scopeid 0x20<link>`,
    `        ether ${mac}  txqueuelen 1000  (Ethernet)`,
    `        RX packets 12345  bytes 1234567 (1.2 MiB)`,
    `        TX packets  6789  bytes  456789 (445.9 KiB)`,
    '',
    `${C.bold}lo${C.reset}: flags=73<UP,LOOPBACK,RUNNING>  mtu 65536`,
    `        inet 127.0.0.1  netmask 255.0.0.0`,
    `        inet6 ::1  prefixlen 128  scopeid 0x10<host>`,
    `        loop  txqueuelen 1000  (Local Loopback)`,
    `        RX packets 789  bytes 12345 (12.3 KiB)`,
    `        TX packets 789  bytes 12345 (12.3 KiB)`,
    '',
  ]
  ctx.stdout(lines.join('\n'))
}

function broadcastFor(ip: string): string {
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(ip)
  if (!m) return '255.255.255.255'
  return `${m[1]}.${m[2]}.${m[3]}.255`
}
