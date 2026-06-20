// Используем нативный WebSocket (Node 22+)
const ws = new WebSocket('ws://127.0.0.1:3010/ws');
let n = 0;
ws.addEventListener('open', () => {
  console.log('OPEN');
  ws.send(JSON.stringify({ type: 'ping' }));
});
ws.addEventListener('message', ev => {
  n++;
  const obj = JSON.parse(ev.data);
  const s = JSON.stringify(obj);
  console.log('MSG', n, s.length > 240 ? s.slice(0, 240) + '...' : s);
  if (n >= 2) {
    ws.close();
    setTimeout(() => process.exit(0), 100);
  }
});
ws.addEventListener('error', e => { console.log('ERR', e.message || e); process.exit(1); });
ws.addEventListener('close', () => console.log('CLOSE'));
setTimeout(() => { console.log('TIMEOUT'); process.exit(2); }, 5000);
