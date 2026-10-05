// Serializa acciones de escritura git por repo. Dos comandos git simultáneos en
// el mismo repo pelean por index.lock y fallan con un error ilegible; acá el
// segundo recibe un 'busy' limpio que el endpoint traduce a 409. El `busy` del
// cliente no alcanza: no cubre dos pestañas ni dos clientes.
export function createLocks() {
  const held = new Set();
  return {
    async run(key, fn) {
      if (held.has(key)) throw new Error('busy');
      held.add(key);
      try { return await fn(); }
      finally { held.delete(key); }
    },
    // Consulta sin tomar: el poller de infra la usa para no muestrear un stack a mitad
    // de un up/down (vería un estado intermedio y lo broadcastearía).
    has: (key) => held.has(key),
  };
}
