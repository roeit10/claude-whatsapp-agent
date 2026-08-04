// Proves the Composio HTTP MCP route works on THIS operating system, using raw JSON-RPC.
// No Claude and no local Composio install involved: the only OS-dependent part of the
// integration is the HTTPS call itself, and this exercises it end to end against a real
// account — initialize, tools/list, then an actual calendar read.
//
// Skips (exit 0) when COMPOSIO_API_KEY is absent, so forks and PRs stay green.

const KEY = process.env.COMPOSIO_API_KEY;
const URL_ = process.env.COMPOSIO_MCP_URL || 'https://connect.composio.dev/mcp';

if (!KEY) {
  console.log('SKIP  COMPOSIO_API_KEY not set — skipping live Composio check');
  process.exit(0);
}

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures++;
};

let sessionId = null;

/** The endpoint answers as SSE (`event: message\ndata: {...}`) as well as plain JSON. */
async function rpc(method, params = {}, id = 1) {
  const headers = {
    'x-consumer-api-key': KEY,
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  };
  if (sessionId) headers['mcp-session-id'] = sessionId;

  const res = await fetch(URL_, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
  const sid = res.headers.get('mcp-session-id');
  if (sid) sessionId = sid;

  const raw = await res.text();
  const line = raw.split('\n').find((l) => l.startsWith('data: '));
  const json = line ? line.slice(6) : raw;
  let parsed = null;
  try { parsed = JSON.parse(json); } catch {}
  return { status: res.status, parsed, raw };
}

console.log(`platform: ${process.platform}  endpoint: ${URL_}`);

// 1. handshake
const init = await rpc('initialize', {
  protocolVersion: '2024-11-05',
  capabilities: {},
  clientInfo: { name: 'ci-probe', version: '1' },
});
check('MCP initialize over HTTPS', init.status === 200 && !!init.parsed?.result,
  `status=${init.status} server=${init.parsed?.result?.serverInfo?.name ?? '?'}`);

if (init.parsed?.result) {
  await fetch(URL_, {
    method: 'POST',
    headers: {
      'x-consumer-api-key': KEY,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  }).catch(() => {});
}

// 2. tools are actually offered
const tools = await rpc('tools/list', {}, 2);
const names = (tools.parsed?.result?.tools ?? []).map((t) => t.name);
check('tools/list returns tools', names.length > 0, `${names.length} tools`);
if (names.length) console.log(`      e.g. ${names.slice(0, 5).join(', ')}`);

// 3. a real call that reaches the user's Google Calendar.
// The payload shape matters: COMPOSIO_MULTI_EXECUTE_TOOL takes a `tools` ARRAY.
// A malformed call still returns HTTP 200 with an error inside, so assert on the
// actual value rather than on the response merely existing.
if (names.includes('COMPOSIO_MULTI_EXECUTE_TOOL')) {
  const call = await rpc('tools/call', {
    name: 'COMPOSIO_MULTI_EXECUTE_TOOL',
    arguments: { tools: [{ tool_slug: 'GOOGLECALENDAR_GET_CURRENT_DATE_TIME', arguments: {} }] },
  }, 3);

  const text = call.parsed?.result?.content?.map((c) => c.text).join('') ?? '';
  let payload = null;
  try { payload = JSON.parse(text); } catch {}
  const flat = JSON.stringify(payload ?? text);

  const errored = /"error"\s*:\s*"[^"]/.test(flat);
  // A real reply carries an ISO timestamp from the user's calendar timezone.
  const gotTime = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(flat);

  check('live calendar call returns real data', call.status === 200 && gotTime && !errored,
    errored ? flat.slice(0, 200) : (flat.match(/\d{4}-\d{2}-\d{2}T[\d:.+-]+/)?.[0] ?? flat.slice(0, 120)));
} else {
  check('multi-execute tool offered', false, `tools: ${names.join(',')}`);
}

console.log(failures ? `\n${failures} FAILED` : '\nall green');
process.exit(failures ? 1 : 0);
