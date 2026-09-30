// ============================================================
// SmartAI v19.2 smoke fixture — CRASHING server.
// Run 1 (no marker file): prints READY, then exits code 7 after
// 1.2s — the supervisor must journal exit(7) and restart with
// backoff. Run 2 (marker exists): stays alive so the smoke can
// finish with a clean supervised stop.
// ============================================================
import http from 'node:http';
import fs from 'node:fs';

const PORT = parseInt(process.env.FIXTURE_PORT || '0', 10);
const MARKER = process.env.FIXTURE_MARKER || '/tmp/smoke-crash-marker';
const second = fs.existsSync(MARKER);

const server = http.createServer((req, res) => {
  if (req.url && req.url.startsWith('/api/ping')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ pong: true, run: second ? 2 : 1 }));
    return;
  }
  res.writeHead(404);
  res.end('no');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`FIXTURE_READY port=${server.address().port} run=${second ? 2 : 1}`);
  if (!second) {
    fs.writeFileSync(MARKER, '1');
    setTimeout(() => {
      console.log('FIXTURE_CRASH code=7');
      process.exit(7);
    }, 1200);
  }
});
