#!/usr/bin/env node
/**
 * WhatsApp agent poller — Green API -> Claude Code -> Green API.
 *
 * Zero dependencies. Node 18+ (uses built-in fetch). Same file runs on macOS and Windows.
 *
 * Receives via Green API's HTTP polling (receiveNotification), NOT webhooks, so it needs
 * no public URL and no server. Runs entirely on the user's machine.
 *
 * Safety model — the agent must only ever act for its owner:
 *   layer 1  instance settings hardened (done by the setup skill, not here)
 *   layer 2  act only on incomingMessageReceived whose chatId === OWNER_CHAT_ID
 *   layer 3  send only to chat ids on the allowlist
 * Everything else is logged and dropped.
 */

import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const LOG_DIR = join(HERE, 'logs');
const STATE_DIR = join(HERE, 'state');
for (const d of [LOG_DIR, STATE_DIR]) if (!existsSync(d)) mkdirSync(d, { recursive: true });

// ---------------------------------------------------------------- config

function loadEnv() {
  const path = join(HERE, '.env');
  if (!existsSync(path)) die('.env not found. Run the setup skill first.');
  const out = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return out;
}

const env = loadEnv();
const ID = req('GREEN_API_ID_INSTANCE');
const TOKEN = req('GREEN_API_TOKEN');
const OWNER = req('OWNER_CHAT_ID');
const MODEL = env.CLAUDE_MODEL || 'sonnet';
const EFFORT = env.CLAUDE_EFFORT || 'medium';
// Headless runs get no interactive permission prompt, so tools must be granted up front
// or the agent silently answers without ever calling them (num_turns stays 1).
const ALLOWED_TOOLS = (env.ALLOWED_TOOLS || 'Bash Read Write Edit Glob Grep WebFetch WebSearch')
  .split(/[\s,]+/).filter(Boolean);

const MCP_CONFIG_PATH = join(HERE, 'mcp.json');
if (!existsSync(MCP_CONFIG_PATH)) writeFileSync(MCP_CONFIG_PATH, '{"mcpServers":{}}\n');
const BASE = `https://api.green-api.com/waInstance${ID}`;

// Layer 3. The owner is always allowed; extra targets are opt-in and explicit.
const SEND_ALLOWLIST = new Set(
  [OWNER, ...(env.EXTRA_SEND_TARGETS || '').split(',').map((s) => s.trim()).filter(Boolean)]
);

function req(k) {
  if (!env[k]) die(`${k} missing from .env`);
  return env[k];
}
function die(msg) {
  console.error(`[fatal] ${msg}`);
  process.exit(1);
}

// ---------------------------------------------------------------- logging

/** Every notification is logged, including the ones the lock rejects. */
function log(kind, payload) {
  const stamp = new Date().toISOString();
  const file = join(LOG_DIR, `messages-${stamp.slice(0, 10)}.jsonl`);
  appendFileSync(file, JSON.stringify({ at: stamp, kind, ...payload }) + '\n');
  console.log(`[${stamp.slice(11, 19)}] ${kind}${payload.chatId ? ` ${payload.chatId}` : ''}`);
}

// ---------------------------------------------------------------- green api

/**
 * Green API puts the token in the PATH, before any extra segments or query string:
 *   {base}/{method}/{token}
 *   {base}/{method}/{token}/{extra}
 *   {base}/{method}/{token}?{query}
 * Appending the query or an id before the token yields a bare nginx 403.
 */
async function green(method, { extra = '', query = '', ...init } = {}) {
  const url = `${BASE}/${method}/${TOKEN}${extra ? `/${extra}` : ''}${query ? `?${query}` : ''}`;
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${method} -> HTTP ${res.status} ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function receive() {
  return green('receiveNotification', { query: 'receiveTimeout=20' });
}

async function ack(receiptId) {
  // Delete BEFORE processing. An undeleted notification returns for 24h, so a message
  // that crashes the handler would otherwise re-trigger Claude on every cycle forever.
  // Trade-off accepted: a crash loses that one message rather than looping on it.
  await green('deleteNotification', { extra: String(receiptId), method: 'DELETE' });
}

async function send(chatId, message) {
  if (!SEND_ALLOWLIST.has(chatId)) {
    log('send_blocked', { chatId, reason: 'not on allowlist', preview: message.slice(0, 80) });
    return false;
  }
  await green('sendMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chatId, message }),
  });
  log('sent', { chatId, chars: message.length });
  return true;
}

// ---------------------------------------------------------------- message parsing

/**
 * Plain text arrives as either textMessage or extendedTextMessage depending on whether
 * WhatsApp attached link-preview metadata. Handling only one silently drops messages.
 */
function extractText(messageData = {}) {
  switch (messageData.typeMessage) {
    case 'textMessage':
      return messageData.textMessageData?.textMessage ?? null;
    case 'extendedTextMessage':
      return messageData.extendedTextMessageData?.text ?? null;
    case 'quotedMessage':
      return messageData.extendedTextMessageData?.text
        ?? messageData.textMessageData?.textMessage
        ?? null;
    default:
      return null;
  }
}

// ---------------------------------------------------------------- claude

function sessionFile(kind) {
  return join(STATE_DIR, `session-${kind}.txt`);
}

/** Resumes one long-lived session so the agent remembers the conversation. */
function runClaude(prompt, { kind = 'chat', resume = true } = {}) {
  return new Promise((resolve) => {
    const args = [
      '-p', '--output-format', 'json',
      '--model', MODEL,
      '--effort', EFFORT,
      '--allowedTools', ...ALLOWED_TOOLS,
      // The agent sees ONLY the servers in this folder's mcp.json — never whatever the
      // user has configured elsewhere. Unrelated servers (e.g. claude.ai connectors)
      // cannot finish OAuth headlessly, and the agent latches onto them and reports an
      // auth error instead of using the tools we gave it.
      //   macOS/Linux -> empty; Google apps go through the `composio` CLI.
      //   Windows     -> composio's npm MCP server, because its CLI is unix-only.
      '--strict-mcp-config', '--mcp-config', MCP_CONFIG_PATH,
    ];
    const file = sessionFile(kind);
    if (resume && existsSync(file)) {
      const id = readFileSync(file, 'utf8').trim();
      if (id) args.push('--resume', id);
    }

    // The prompt goes on stdin, never argv. --allowedTools and --mcp-config are both
    // variadic, so a trailing positional gets swallowed as another value for whichever
    // came last (a prompt was being parsed as an mcp config path). stdin also sidesteps
    // shell quoting and argv length limits for long messages.
    const child = spawn('claude', args, {
      cwd: HERE,
      shell: process.platform === 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.stdin.write(prompt);
    child.stdin.end();
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));

    const timer = setTimeout(() => {
      child.kill();
      resolve({ ok: false, text: 'הבקשה לקחה יותר מדי זמן ובוטלה.' });
    }, 10 * 60 * 1000);

    child.on('close', () => {
      clearTimeout(timer);
      let parsed;
      try { parsed = JSON.parse(out); } catch { parsed = null; }
      if (!parsed) {
        log('claude_error', { kind, stderr: err.slice(0, 500), stdout: out.slice(0, 500) });
        return resolve({ ok: false, text: 'משהו השתבש בהרצת הסוכן. הפרטים בלוג.' });
      }
      if (resume && parsed.session_id) writeFileSync(file, parsed.session_id);
      // turns === 1 with a tool-shaped request usually means no tool ran at all —
      // log the reply and any denials so that is visible instead of guessable.
      log('claude_done', {
        kind,
        cost: parsed.total_cost_usd,
        turns: parsed.num_turns,
        denials: parsed.permission_denials?.length ? parsed.permission_denials : undefined,
        reply: (parsed.result ?? '').slice(0, 600),
      });
      resolve({ ok: !parsed.is_error, text: parsed.result ?? '(אין תשובה)' });
    });
  });
}

// ---------------------------------------------------------------- handlers

async function handleOwnerMessage(text) {
  const { text: reply } = await runClaude(text, { kind: 'chat', resume: true });
  await send(OWNER, reply);
}

// ---------------------------------------------------------------- main loop

async function tick() {
  const note = await receive();

  if (note) {
    const receiptId = note.receiptId;
    const body = note.body ?? {};
    await ack(receiptId);

    const chatId = body.senderData?.chatId ?? null;
    const type = body.typeWebhook ?? 'unknown';

    // Layer 2 — the lock. Group chats end in @g.us and never match, so they are
    // excluded automatically. Compare the full chat id: never rebuild it from a
    // phone number, because WhatsApp may hand back @lid instead of @c.us.
    if (type !== 'incomingMessageReceived' || chatId !== OWNER) {
      log('ignored', { chatId, type, reason: chatId === OWNER ? 'wrong type' : 'not owner' });
      return;
    }

    const text = extractText(body.messageData);
    if (!text) {
      log('ignored', { chatId, type, reason: `unsupported: ${body.messageData?.typeMessage}` });
      await send(OWNER, 'קיבלתי, אבל אני יודע לקרוא רק הודעות טקסט כרגע.');
      return;
    }

    log('owner_message', { chatId, text });
    await handleOwnerMessage(text);
  }
}

console.log(`whatsapp agent up — instance ${ID}, owner ${OWNER}, model ${MODEL} (effort ${EFFORT})`);
console.log(`logs: ${LOG_DIR}`);

let stopping = false;
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { stopping = true; console.log('\nshutting down...'); });
}

while (!stopping) {
  try {
    await tick();
  } catch (e) {
    log('loop_error', { error: String(e?.message ?? e) });
    await new Promise((r) => setTimeout(r, 5000));
  }
}
process.exit(0);
