import { WebSocketServer } from 'ws';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// Factory por defecto: PTY real que attachea a la sesión tmux por nombre.
// window-size=latest hace que la ventana tome el tamaño del último cliente activo,
// para no encoger la terminal real del usuario de forma permanente.
function defaultSpawnPty(target, { cols, rows }) {
  // import perezoso: node-pty es binario nativo; sólo se carga al usar la terminal real.
  const pty = require('node-pty');
  return pty.spawn('tmux', ['attach-session', '-t', target], {
    name: 'xterm-color',
    cols: cols || 80,
    rows: rows || 24,
    env: process.env,
  });
}

export function attachTerm(httpServer, store, { token, spawnPty = defaultSpawnPty } = {}) {
  const wss = new WebSocketServer({ server: httpServer, path: '/term' });

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, 'http://x');
    if (token) {
      const q = url.searchParams.get('token');
      const hdr = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
      if (q !== token && hdr !== token) { ws.close(1008, 'unauthorized'); return; }
    }
    const s = store.get(url.searchParams.get('id'));
    if (!s) { ws.close(1008, 'unknown session'); return; }

    const target = s.tmux || s.name;
    let pty;
    try {
      pty = spawnPty(target, { cols: 80, rows: 24 });
    } catch {
      ws.close(1011, 'pty failed');
      return;
    }

    pty.onData((d) => { if (ws.readyState === 1) ws.send(d); });
    if (pty.onExit) pty.onExit(() => { if (ws.readyState === 1) ws.close(); });

    ws.on('message', (data, isBinary) => {
      if (isBinary) { pty.write(data); return; }
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return; }
      if (msg && msg.type === 'resize') pty.resize(msg.cols, msg.rows);
    });

    ws.on('close', () => { try { pty.kill(); } catch {} });
  });

  return {
    close() {
      for (const c of wss.clients) c.terminate();
      wss.close();
    },
  };
}
