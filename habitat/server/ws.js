import { WebSocketServer } from 'ws';

export function attachWs(httpServer, store, { token }) {
  const wss = new WebSocketServer({ server: httpServer });

  wss.on('connection', (ws, req) => {
    if (token) {
      const url = new URL(req.url, 'http://x');
      const q = url.searchParams.get('token');
      const hdr = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
      if (q !== token && hdr !== token) { ws.close(1008, 'unauthorized'); return; }
    }
    ws.send(JSON.stringify({ type: 'snapshot', sessions: store.snapshot() }));
  });

  return {
    broadcast(msg) {
      const data = JSON.stringify(msg);
      for (const c of wss.clients) if (c.readyState === 1) c.send(data);
    },
    close() {
      for (const c of wss.clients) c.terminate();
      wss.close();
    },
  };
}
