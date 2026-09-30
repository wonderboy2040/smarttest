// ============================================================
// SmartAI v19.2 smoke fixture — FROZEN server.
// Serves /api/ping OK for the first N responses, then BLOCKS
// the event loop forever (while(true)). This is the exact
// real-world freeze the supervisor must detect and recover:
// process alive, port held, loop unresponsive.
// ============================================================
import http from 'node:http';

const PORT = parseInt(process.env.FIXTURE_PORT || '0', 10);
const OK_FOR = parseInt(process.env.FIXTURE_OK_PINGS || '2', 10);
let served = 0;

const server = http.createServer((req, res) => {
  if (req.url && req.url.startsWith('/api/ping')) {
    if (served < OK_FOR) {
      served++;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ pong: true, served }));
      return;
    }
    // FROZEN — the supervisor's independent probe must catch this
    // and force-kill + restart us. Nothing else can.
    // eslint-disable-next-line no-constant-condition
    while (true) { /* spin */ }
  }
  res.writeHead(404);
  res.end('no');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`FIXTURE_READY port=${server.address().port} okFor=${OK_FOR}`);
});
