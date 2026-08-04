// Stands in for Green API so the poller can be exercised end to end without touching
// a real WhatsApp number. Serves one queued notification, then records what was sent.
import { createServer } from 'node:http';
import { writeFileSync } from 'node:fs';

const OWNER = process.env.MOCK_OWNER || '972500000000@c.us';
const TEXT = process.env.MOCK_TEXT || '/reset';
const OUT = process.env.MOCK_OUT || 'mock-result.json';
const PORT = Number(process.env.MOCK_PORT || 8799);

let queue = [{
  receiptId: 1,
  body: {
    typeWebhook: 'incomingMessageReceived',
    senderData: { chatId: OWNER, sender: OWNER },
    messageData: {
      typeMessage: 'extendedTextMessage',
      extendedTextMessageData: { text: TEXT },
    },
  },
}];

const seen = { deleted: [], sent: [] };

createServer((req, res) => {
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', () => {
    if (req.url.includes('/receiveNotification')) {
      const n = queue.shift() || null;
      res.end(n ? JSON.stringify(n) : '');
    } else if (req.url.includes('/deleteNotification')) {
      seen.deleted.push(req.url.split('/').pop());
      res.end('{"result":true}');
    } else if (req.url.includes('/sendMessage')) {
      seen.sent.push(JSON.parse(body));
      res.end('{"idMessage":"mock"}');
      writeFileSync(OUT, JSON.stringify(seen, null, 2));
      setTimeout(() => process.exit(0), 300);
    } else {
      res.statusCode = 404;
      res.end('');
    }
  });
}).listen(PORT, () => console.log(`mock green-api on :${PORT}`));

// Never hang a CI job.
setTimeout(() => {
  writeFileSync(OUT, JSON.stringify({ ...seen, timedOut: true }, null, 2));
  process.exit(1);
}, 90_000);
