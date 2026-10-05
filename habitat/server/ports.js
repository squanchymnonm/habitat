import { createServer } from 'node:net';

// ¿El puerto está libre en el host? Intenta escucharlo en todas las interfaces, que es
// donde publica docker por default.
export function probePort(port) {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.once('error', () => resolve(false));
    srv.listen({ port, host: '0.0.0.0', exclusive: true }, () => srv.close(() => resolve(true)));
  });
}

// Puertos ya asignados a sesiones vivas (session.infra.ports).
export function usedPorts(sessions) {
  const used = new Set();
  for (const s of sessions) for (const p of Object.values((s && s.infra && s.infra.ports) || {})) used.add(p);
  return used;
}

// Un puerto por nombre, recorriendo el rango en orden. Saltea los ya asignados (used) y
// los que el probe ve ocupados en el host.
export async function allocatePorts(names, { range, used = new Set(), probe = probePort }) {
  const ports = {};
  const taken = new Set(used);
  let next = range[0];
  for (const name of names) {
    let found = null;
    while (next <= range[1]) {
      const p = next++;
      if (taken.has(p)) continue;
      if (await probe(p)) { found = p; break; }
    }
    if (found == null) return { ok: false, error: `no hay puertos libres en ${range[0]}-${range[1]}` };
    taken.add(found);
    ports[name] = found;
  }
  return { ok: true, ports };
}
