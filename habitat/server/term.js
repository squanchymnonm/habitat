import { WebSocketServer } from 'ws';
import { createRequire } from 'node:module';
import { tmuxArgs } from './tmux.js';
import { isAuthenticated } from './auth.js';

const require = createRequire(import.meta.url);

// Args de tmux para attachear a la sesión con el modo mouse activado, de modo que la
// rueda del mouse entre a copy-mode y scrollee el historial. El ';' se pasa como argumento
// literal: tmux lo trata como separador de comandos (invocado sin shell). Exportada para test.
// Va con `-L <socket>` (tmuxArgs) para attachear al MISMO socket dedicado donde el server
// crea las sesiones; si no, node-pty arrancarría un tmux en el socket default y no encontraría
// la sesión.
export function attachArgs(target) {
  return tmuxArgs('set-option', '-t', target, 'mouse', 'on', ';', 'attach-session', '-t', target);
}

// Sesión tmux dedicada a editar (nvim) para una sesión dada. Derivada del store,
// nunca de input del cliente.
export function editTarget(base) {
  return `${base}-edit`;
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

export function attachTerm(httpServer, store, { token, sessionStore, spawnPty = defaultSpawnPty } = {}) {
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
    if (!isAuthenticated(req, { sessionStore, token })) { ws.close(1008, 'unauthorized'); return; }
    const s = store.get(url.searchParams.get('id'));
    if (!s) { ws.close(1008, 'unknown session'); return; }

    const base = s.tmux || s.name;
    const role = url.searchParams.get('role');
    const target = role === 'edit' ? editTarget(base) : base;
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
      // Toda operación sobre el PTY va protegida: si el fd subyacente ya murió (la sesión
      // tmux se cerró entre medio), node-pty tira síncrono (p.ej. `ioctl(2) failed, EBADF`
      // en resize). Antes esa excepción salía del handler -> uncaughtException -> caía TODO
      // el server node, y con él (KillMode=control-group) el server tmux y TODAS las
      // sesiones. La tragábamos acá: una terminal muerta no puede tumbar el panel.
      try {
        if (isBinary) { pty.write(data); return; }
        let msg;
        try { msg = JSON.parse(data.toString()); } catch { return; }
        if (msg && msg.type === 'resize') pty.resize(msg.cols, msg.rows);
      } catch { /* PTY muerto: ignorar; el onExit/close ya limpia */ }
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
