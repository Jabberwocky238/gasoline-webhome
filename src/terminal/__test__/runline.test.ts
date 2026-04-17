// tsx-runnable test: npx tsx src/terminal/__test__/runline.test.ts
//
// This file exercises every headline feature the user asked for:
//   - grep / sed / regex replacement
//   - touch → real in-memory file, ./script.sh → real execution
//   - rm / rmdir / mkdir / rm -rf → OS-like errno output
//   - unsupported features → "command not found" / coreutils errors
//   - pipes, &&, ||, > >>, $VAR, $(cmd), globs
//   - permission groups: id / chmod / chown / chgrp / su
//
// Runs entirely in-memory. No fetch, no browser, no xterm.

import assert from 'node:assert/strict'
import { makeShell } from '../shell'
import { runLine } from '../registry'
import { USERS } from '../../fs/vfs'
import '../cmds'

// Strip ANSI colour so assertions can check literal text.
const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '')

type Case = { name: string; fn: () => Promise<void> | void }
const cases: Case[] = []
const test = (name: string, fn: () => Promise<void> | void) => cases.push({ name, fn })

async function run(line: string, sh = makeShell()) {
  const r = await runLine(sh, line)
  return { text: strip(r.out), status: r.status, shell: sh }
}

// ---------------- basics ----------------

test('echo prints args with newline', async () => {
  const r = await run('echo hello world')
  assert.equal(r.text, 'hello world\n')
  assert.equal(r.status, 0)
})

test('pwd prints cwd', async () => {
  const r = await run('pwd')
  assert.equal(r.text, '/home/visitor\n')
})

test('whoami is visitor by default', async () => {
  const r = await run('whoami')
  assert.equal(r.text, 'visitor\n')
})

test('cd updates cwd', async () => {
  const sh = makeShell()
  await runLine(sh, 'cd /tmp')
  assert.deepEqual(sh.cwd, ['tmp'])
  const r = await run('pwd', sh)
  assert.equal(r.text, '/tmp\n')
})

// ---------------- errors match OS ----------------

test('unknown command = command not found', async () => {
  const r = await run('doesnotexist')
  assert.match(r.text, /command not found/)
  assert.equal(r.status, 127)
})

test('cat missing file = No such file', async () => {
  const r = await run('cat /nope/also_nope')
  assert.match(r.text, /No such file or directory/)
})

test('cd into a file = Not a directory', async () => {
  const sh = makeShell()
  await runLine(sh, 'cd /tmp')
  await runLine(sh, 'touch a.txt')
  const r = await run('cd a.txt', sh)
  assert.match(r.text, /Not a directory/)
})

test('rmdir non-empty = Directory not empty', async () => {
  const sh = makeShell()
  await runLine(sh, 'cd /tmp')
  await runLine(sh, 'mkdir d')
  await runLine(sh, 'touch d/f')
  const r = await run('rmdir d', sh)
  assert.match(r.text, /Directory not empty/)
})

// ---------------- touch → real file → exec ----------------

test('touch creates in-memory file', async () => {
  const sh = makeShell()
  await runLine(sh, 'cd /tmp')
  await runLine(sh, 'touch aa.sh')
  const r = await run('ls', sh)
  assert.match(r.text, /aa\.sh/)
})

test('echo > file writes content; cat reads it back', async () => {
  const sh = makeShell()
  await runLine(sh, 'cd /tmp')
  await runLine(sh, 'touch aa.sh')
  await runLine(sh, 'echo "hello" > aa.sh')
  const r = await run('cat aa.sh', sh)
  assert.equal(r.text, 'hello\n')
})

test('echo >> appends', async () => {
  const sh = makeShell()
  await runLine(sh, 'cd /tmp')
  await runLine(sh, 'echo a > f.txt')
  await runLine(sh, 'echo b >> f.txt')
  const r = await run('cat f.txt', sh)
  assert.equal(r.text, 'a\nb\n')
})

test('./aa.sh actually runs the in-memory content', async () => {
  const sh = makeShell()
  await runLine(sh, 'cd /tmp')
  await runLine(sh, 'touch aa.sh')
  await runLine(sh, 'chmod +x aa.sh')
  await runLine(sh, 'echo \'echo from-script\' > aa.sh')
  const r = await run('./aa.sh', sh)
  assert.equal(r.text, 'from-script\n')
})

test('./foo without exec bit = Permission denied', async () => {
  const sh = makeShell()
  await runLine(sh, 'cd /tmp')
  await runLine(sh, 'touch bb.sh')
  await runLine(sh, 'echo "echo hi" > bb.sh')
  const r = await run('./bb.sh', sh)
  assert.match(r.text, /Permission denied/)
})

// ---------------- mkdir / rm ----------------

test('mkdir -p creates a chain', async () => {
  const sh = makeShell()
  await runLine(sh, 'cd /tmp')
  await runLine(sh, 'mkdir -p a/b/c')
  const r = await run('ls /tmp/a/b', sh)
  assert.match(r.text, /c/)
})

test('rm -rf removes recursively', async () => {
  const sh = makeShell()
  await runLine(sh, 'cd /tmp')
  await runLine(sh, 'mkdir -p gone/inner')
  await runLine(sh, 'touch gone/inner/f')
  const r1 = await run('rm -rf gone', sh)
  assert.equal(r1.status, 0)
  const r2 = await run('ls gone', sh)
  assert.match(r2.text, /No such file or directory/)
})

test('rm on dir without -r = Is a directory', async () => {
  const sh = makeShell()
  await runLine(sh, 'cd /tmp')
  await runLine(sh, 'mkdir d')
  const r = await run('rm d', sh)
  assert.match(r.text, /Is a directory/)
})

test('rm -f missing file is silent, status 0', async () => {
  const r = await run('rm -f /no/such')
  assert.equal(r.text, '')
  assert.equal(r.status, 0)
})

// ---------------- grep ----------------

test('grep finds lines', async () => {
  const sh = makeShell()
  await runLine(sh, 'cd /tmp')
  await runLine(sh, 'echo "apple\nbanana\napricot" > fruits')
  const r = await run('grep ^a fruits', sh)
  assert.match(r.text, /apple/)
  assert.match(r.text, /apricot/)
  assert.ok(!r.text.includes('banana'))
})

test('grep -v inverts', async () => {
  const sh = makeShell()
  await runLine(sh, 'cd /tmp')
  await runLine(sh, 'echo "a\nb\nc" > x')
  const r = await run('grep -v b x', sh)
  assert.equal(strip(r.text), 'a\nc\n')
})

test('grep -i ignore case', async () => {
  const sh = makeShell()
  await runLine(sh, 'cd /tmp')
  await runLine(sh, 'echo "Hello" > h')
  const r = await run('grep -i hello h', sh)
  assert.match(r.text, /Hello/)
})

test('grep from stdin via pipe', async () => {
  const r = await run('echo "foo\nbar\nfoo2" | grep foo')
  assert.match(r.text, /foo\b/)
  assert.match(r.text, /foo2/)
  assert.ok(!r.text.includes('bar'))
})

// ---------------- sed ----------------

test('sed substitutes first match per line', async () => {
  const sh = makeShell()
  await runLine(sh, 'cd /tmp')
  await runLine(sh, 'echo "aa bb aa" > s')
  const r = await run("sed 's/aa/XX/' s", sh)
  assert.equal(strip(r.text), 'XX bb aa\n')
})

test('sed /g replaces all', async () => {
  const sh = makeShell()
  await runLine(sh, 'cd /tmp')
  await runLine(sh, 'echo "aa bb aa" > s')
  const r = await run("sed 's/aa/XX/g' s", sh)
  assert.equal(strip(r.text), 'XX bb XX\n')
})

test('sed -i writes back to the file', async () => {
  const sh = makeShell()
  await runLine(sh, 'cd /tmp')
  await runLine(sh, 'echo "hello world" > s')
  await runLine(sh, "sed -i 's/world/gasoline/' s")
  const r = await run('cat s', sh)
  assert.equal(strip(r.text), 'hello gasoline\n')
})

test('sed with alt separator |', async () => {
  const sh = makeShell()
  await runLine(sh, 'cd /tmp')
  await runLine(sh, 'echo "/usr/bin" > p')
  const r = await run("sed 's|/usr|/opt|' p", sh)
  assert.equal(strip(r.text), '/opt/bin\n')
})

test('sed /pat/d deletes lines', async () => {
  const sh = makeShell()
  await runLine(sh, 'cd /tmp')
  await runLine(sh, 'echo "a\nb\nc" > del.txt')
  const r = await run("sed '/b/d' del.txt", sh)
  assert.equal(strip(r.text), 'a\nc\n')
})

// ---------------- pipes & operators ----------------

test('pipe chain', async () => {
  const r = await run('echo "foo bar\nqux foo" | grep foo | sed \'s/foo/FOO/g\'')
  assert.match(strip(r.text), /FOO bar/)
  assert.match(strip(r.text), /qux FOO/)
})

test('&& short-circuits on failure', async () => {
  const r = await run('false && echo ran')
  assert.ok(!r.text.includes('ran'))
})

test('|| runs on failure', async () => {
  const r = await run('false || echo fallback')
  assert.match(r.text, /fallback/)
})

test('; always runs next', async () => {
  const r = await run('false ; echo next')
  assert.match(r.text, /next/)
})

// ---------------- env vars & subst ----------------

test('$VAR expands in double quotes', async () => {
  const sh = makeShell()
  await runLine(sh, 'export FOO=bar')
  const r = await run('echo "hi $FOO"', sh)
  assert.equal(strip(r.text), 'hi bar\n')
})

test("'' blocks expansion", async () => {
  const sh = makeShell()
  await runLine(sh, 'export FOO=bar')
  const r = await run("echo 'hi $FOO'", sh)
  assert.equal(strip(r.text), 'hi $FOO\n')
})

test('$(cmd) substitutes output', async () => {
  const r = await run('echo "today=$(echo 2026)"')
  assert.equal(strip(r.text), 'today=2026\n')
})

test('$? reflects last status', async () => {
  const sh = makeShell()
  await runLine(sh, 'false')
  const r = await run('echo $?', sh)
  assert.equal(strip(r.text), '1\n')
})

test('prefix VAR=val command scopes the var', async () => {
  const sh = makeShell()
  const r1 = await run('FOO=once echo $FOO', sh)
  assert.equal(strip(r1.text), 'once\n')
  const r2 = await run('echo $FOO', sh)
  assert.equal(strip(r2.text), '\n')
})

// ---------------- globs ----------------

test('glob * expands against cwd', async () => {
  const sh = makeShell()
  await runLine(sh, 'cd /tmp')
  await runLine(sh, 'touch one.md two.md three.txt')
  const r = await run('echo *.md', sh)
  assert.equal(strip(r.text).trim().split(' ').sort().join(' '), 'one.md two.md')
})

test('glob no-match leaves literal', async () => {
  const sh = makeShell()
  await runLine(sh, 'cd /tmp')
  const r = await run('echo *.nosuchext', sh)
  assert.equal(strip(r.text), '*.nosuchext\n')
})

// ---------------- permissions ----------------

test('id prints uid=1001(visitor)', async () => {
  const r = await run('id')
  assert.match(r.text, /uid=1001\(visitor\)/)
})

test('chmod changes mode bits symbolic', async () => {
  const sh = makeShell()
  await runLine(sh, 'cd /tmp')
  await runLine(sh, 'touch xx')
  await runLine(sh, 'chmod 755 xx')
  const r = await run('ls -l xx', sh)
  assert.match(strip(r.text), /-rwxr-xr-x/)
})

test('chmod u+x adds exec bit', async () => {
  const sh = makeShell()
  await runLine(sh, 'cd /tmp')
  await runLine(sh, 'touch y')
  await runLine(sh, 'chmod u+x y')
  const r = await run('ls -l y', sh)
  assert.match(strip(r.text), /-rwxr--r--/)
})

test('visitor cannot touch in / (perm denied)', async () => {
  const r = await run('touch /cantwritehere')
  assert.match(r.text, /Permission denied/)
})

test('su root bypasses perm', async () => {
  const sh = makeShell()
  await runLine(sh, 'su root')
  assert.equal(sh.user.uid, 0)
  const r = await run('touch /canwritehere', sh)
  assert.equal(r.text, '')
})

test('chown visitor -> jabberwocky238 blocked for non-root', async () => {
  const sh = makeShell()
  await runLine(sh, 'cd /tmp')
  await runLine(sh, 'touch f')
  const r = await run('chown jabberwocky238 f', sh)
  assert.match(r.text, /Operation not permitted/)
})

// ---------------- script execution ----------------

test('bash -c runs a one-liner', async () => {
  const r = await run('bash -c "echo sub"')
  assert.match(strip(r.text), /sub/)
})

test('multi-line script with && chain and $VAR', async () => {
  const sh = makeShell()
  await runLine(sh, 'cd /tmp')
  await runLine(sh, 'touch x.sh')
  await runLine(sh, 'chmod +x x.sh')
  await runLine(sh, 'echo \'NAME=gasoline\' > x.sh')
  await runLine(sh, 'echo \'echo "hello $NAME"\' >> x.sh')
  await runLine(sh, 'echo \'true && echo ok\' >> x.sh')
  const r = await run('./x.sh', sh)
  const text = strip(r.text)
  assert.match(text, /hello gasoline/)
  assert.match(text, /ok/)
})

// ---------------- runner ----------------

let failures = 0
;(async () => {
  // Confirm visitor is the default user (sanity).
  assert.equal(USERS.visitor.uid, 1001)
  for (const c of cases) {
    try {
      await c.fn()
      console.log(`\u2713 ${c.name}`)
    } catch (e) {
      failures++
      console.error(`\u2717 ${c.name}`)
      console.error(`  ${(e as Error).message}`)
      if ((e as any).expected !== undefined) {
        console.error(`  expected: ${JSON.stringify((e as any).expected)}`)
        console.error(`  actual:   ${JSON.stringify((e as any).actual)}`)
      }
    }
  }
  console.log(`\n${cases.length - failures}/${cases.length} passed`)
  if (failures > 0) process.exit(1)
})()
