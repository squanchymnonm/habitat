import { WebSocketServer } from 'ws';

export function attachWs(httpServer, store, { token, onChat, onDismiss } = {}) {
  // noServer + ruteo manual por pathname: si usáramos { server, path }, este WSS
  // abortaría con 400 cualquier upgrade que no sea /ws (incluido /term), pisando
  // al otro WSS montado sobre el mismo http server. Acá cedemos los paths ajenos.
  const wss = new WebSocketServer({ noServer: true });
  httpServer.on('upgrade', (req, socket, head) => {
    const { pathname } = new URL(req.url, 'http://x');
    if (pathname !== '/ws') return;
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', (ws, req) => {
    if (token) {
      const url = new URL(req.url, 'http://x');
      const q = url.searchParams.get('token');
      const hdr = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
      if (q !== token && hdr !== token) { ws.close(1008, 'unauthorized'); return; }
    }
    ws.send(JSON.stringify({ type: 'snapshot', sessions: store.snapshot() }));

    ws.on('message', (data) => {
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return; }
      if (msg && msg.type === 'chat' && msg.id && typeof msg.text === 'string' && onChat) {
        onChat(msg.id, msg.text);
      } else if (msg && msg.type === 'dismiss' && msg.id && onDismiss) {
        onDismiss(msg.id);
      }
    });
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
