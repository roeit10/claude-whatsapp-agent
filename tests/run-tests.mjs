// Cross-platform test suite for the poller. Runs identically on macOS, Linux and Windows.
// Uses a mock Green API and a stub `claude`, so nothing here touches a real WhatsApp
// number or a real Claude subscription.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const TEMPLATE = join(REPO, 'skills', 'whatsapp-agent', 'templates', 'poller.mjs');
const WIN = process.platform === 'win32';
const OWNER = '972500000000@c.us';

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures++;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * A fake `claude` on PATH returning the JSON shape the poller parses.
 * The payload is emitted by node, not by the shell: cmd.exe mangles quotes in `echo`,
 * which silently produced invalid JSON and looked like a poller bug.
 */
function makeStubClaude(dir) {
  mkdirSync(dir, { recursive: true });
  const payload = JSON.stringify({
    is_error: false, num_turns: 2, session_id: 'stub-session',
    total_cost_usd: 0, result: 'STUB_REPLY',
  });
  const js = join(dir, 'stub-claude.mjs');
  writeFileSync(js, `process.stdin.resume();\nprocess.stdin.on('end', () => {});\n` +
    `console.log(${JSON.stringify(payload)});\n`);
  if (WIN) {
    writeFileSync(join(dir, 'claude.cmd'), `@echo off\r\nnode "%~dp0stub-claude.mjs" %*\r\n`);
  } else {
    const f = join(dir, 'claude');
    writeFileSync(f, `#!/bin/sh\nexec node "$(dirname "$0")/stub-claude.mjs" "$@"\n`);
    chmodSync(f, 0o755);
  }
  return dir;
}

function makeAgent(dir, extraEnv = '') {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, 'state'), { recursive: true });
  writeFileSync(join(dir, 'poller.mjs'), readFileSync(TEMPLATE));
  writeFileSync(join(dir, '.env'),
    `GREEN_API_ID_INSTANCE=0000000000\nGREEN_API_TOKEN=fake\n` +
    `OWNER_CHAT_ID=${OWNER}\nGREEN_API_HOST=http://127.0.0.1:8799\n${extraEnv}`);
  writeFileSync(join(dir, 'CLAUDE.md'), 'test agent\n');
  return dir;
}

function startPoller(dir, stubDir) {
  const env = { ...process.env, PATH: `${stubDir}${WIN ? ';' : ':'}${process.env.PATH}` };
  return spawn(process.execPath, ['poller.mjs'], { cwd: dir, env, stdio: 'pipe' });
}

async function waitFor(fn, ms = 60_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) { if (fn()) return true; await sleep(500); }
  return false;
}

const TMP = join(REPO, '.test-tmp');
rmSync(TMP, { recursive: true, force: true });
const stub = makeStubClaude(join(TMP, 'stub'));

// ---------------------------------------------------------------- 1. syntax
{
  const r = spawnSync(process.execPath, ['--check', TEMPLATE], { encoding: 'utf8' });
  check('poller.mjs parses', r.status === 0, r.stderr.trim().slice(0, 200));
}

// ---------------------------------------------------------------- 2. /reset round trip
{
  const dir = makeAgent(join(TMP, 'reset'));
  writeFileSync(join(dir, 'state', 'session-chat.txt'), 'old-session-id');
  const out = join(dir, 'mock-result.json');
  const mock = spawn(process.execPath, [join(HERE, 'mock-green-api.mjs')], {
    cwd: dir,
    env: { ...process.env, MOCK_TEXT: '/reset', MOCK_OWNER: OWNER, MOCK_OUT: out },
    stdio: 'pipe',
  });
  await sleep(1500);
  const p = startPoller(dir, stub);
  const got = await waitFor(() => existsSync(out), 45_000);
  p.kill(); mock.kill();
  check('/reset produced a reply', got);
  if (got) {
    const seen = JSON.parse(readFileSync(out, 'utf8'));
    check('/reset replied to the owner only', seen.sent.every((m) => m.chatId === OWNER));
    check('/reset deleted the session file', !existsSync(join(dir, 'state', 'session-chat.txt')));
    check('notification was acked', seen.deleted.length === 1, `deleted=${seen.deleted.length}`);
  }
}

// ---------------------------------------------------------------- 3. normal message -> claude
{
  const dir = makeAgent(join(TMP, 'normal'));
  const out = join(dir, 'mock-result.json');
  const mock = spawn(process.execPath, [join(HERE, 'mock-green-api.mjs')], {
    cwd: dir,
    env: { ...process.env, MOCK_TEXT: 'שלום', MOCK_OWNER: OWNER, MOCK_OUT: out },
    stdio: 'pipe',
  });
  await sleep(1500);
  const p = startPoller(dir, stub);
  const got = await waitFor(() => existsSync(out), 45_000);
  p.kill(); mock.kill();
  check('normal message produced a reply', got);
  if (got) {
    const seen = JSON.parse(readFileSync(out, 'utf8'));
    check('reply came from claude', seen.sent[0]?.message === 'STUB_REPLY', seen.sent[0]?.message);
    check('session id was persisted', existsSync(join(dir, 'state', 'session-chat.txt')));
  }
}

// ---------------------------------------------------------------- 4. single-instance lock
{
  const dir = makeAgent(join(TMP, 'lock'));
  const p1 = startPoller(dir, stub);
  await sleep(3000);
  const locked = existsSync(join(dir, 'state', 'poller.pid'));
  check('lock file created', locked);

  const second = spawnSync(process.execPath, ['poller.mjs'], { cwd: dir, encoding: 'utf8' });
  check('second instance refuses', second.status === 1, `exit=${second.status}`);
  check('refusal explains why', /already running/i.test(second.stderr), second.stderr.trim().slice(0, 120));

  p1.kill('SIGINT');
  await sleep(2500);

  // A hard kill can leave the pid file behind; a stale lock must not block a restart.
  writeFileSync(join(dir, 'state', 'poller.pid'), '999999');
  const p3 = startPoller(dir, stub);
  let banner = '';
  p3.stdout.on('data', (d) => (banner += d));
  await sleep(3500);
  p3.kill();
  check('stale lock does not block startup', /whatsapp agent up/.test(banner), banner.trim().slice(0, 80));
}

// ---------------------------------------------------------------- 5. windows autostart script
if (WIN) {
  const ps = join(REPO, 'skills', 'whatsapp-agent', 'templates', 'autostart.windows.ps1');
  const r = spawnSync('powershell', ['-NoProfile', '-Command',
    `$errs = $null;` +
    `$null = [System.Management.Automation.Language.Parser]::ParseFile('${ps}', [ref]$null, [ref]$errs);` +
    `if ($errs -and $errs.Count -gt 0) { $errs | ForEach-Object { $_.Message }; exit 1 }`],
    { encoding: 'utf8' });
  check('autostart.windows.ps1 parses', r.status === 0, (r.stderr || '').trim().slice(0, 200));

  const dir = makeAgent(join(TMP, 'autostart'));
  writeFileSync(join(dir, 'autostart.windows.ps1'), readFileSync(ps));
  const reg = spawnSync('powershell', ['-ExecutionPolicy', 'Bypass', '-File',
    join(dir, 'autostart.windows.ps1'), '-TaskName', 'WhatsAppAgentCITest'],
    { cwd: dir, encoding: 'utf8' });
  check('scheduled task registers', /task state/i.test(reg.stdout || ''),
    (reg.stdout + reg.stderr).trim().slice(-200));
  spawnSync('powershell', ['-NoProfile', '-Command',
    `Stop-ScheduledTask -TaskName WhatsAppAgentCITest -ErrorAction SilentlyContinue;` +
    `Unregister-ScheduledTask -TaskName WhatsAppAgentCITest -Confirm:$false -ErrorAction SilentlyContinue;` +
    `Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |` +
    ` Where-Object { $_.CommandLine -like '*poller.mjs*' } |` +
    ` ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`]);
  await sleep(2000);
}

// Windows keeps handles open briefly after a process dies; cleanup is best-effort
// and must never turn a green run red.
try { rmSync(TMP, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); }
catch (e) { console.log(`(cleanup skipped: ${e.code})`); }
console.log(failures ? `\n${failures} FAILED` : '\nall green');
process.exit(failures ? 1 : 0);
