import { WebSocketServer } from 'ws';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// Args de tmux para attachear a la sesión con el modo mouse activado, de modo que la
// rueda del mouse entre a copy-mode y scrollee el historial. El ';' se pasa como argumento
// literal: tmux lo trata como separador de comandos (invocado sin shell). Exportada para test.
export function attachArgs(target) {
  return ['set-option', '-t', target, 'mouse', 'on', ';', 'attach-session', '-t', target];
}

// Factory por defecto: PTY real que attachea a la sesión tmux por nombre.
// Relies on tmux's default client-sizing behavior (does not set window-size option).
function defaultSpawnPty(target, { cols, rows }) {
  // import perezoso: node-pty es binario nativo; sólo se carga al usar la terminal real.
  const pty = require('node-pty');
  return pty.spawn('tmux', attachArgs(target), {
    name: 'xterm-color',
    cols: cols || 80,
    rows: rows || 24,
    env: process.env,
  });
}

export function attachTerm(httpServer, store, { token, spawnPty = defaultSpawnPty } = {}) {
  // noServer + ruteo manual: ver nota en ws.js. Con { server, path } este WSS
  // pisaría a /ws (abortaría su upgrade con 400) y viceversa.
  const wss = new WebSocketServer({ noServer: true });
  httpServer.on('upgrade', (req, socket, head) => {
    const { pathname } = new URL(req.url, 'http://x');
    if (pathname !== '/term') return;
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

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
