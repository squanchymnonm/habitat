// Plantillas .env de proyecto: variables que se resuelven por sesión. Puro (sin I/O):
// lo usan la validación al guardar (scan) y el spawn (scan + render).
const TOKEN_RE = /\{\{([^{}]*)\}\}/g;
const PORT_NAME_RE = /^[a-z0-9_]+$/;

// Nombre de proyecto de compose: minúsculas, [a-z0-9_-], empieza con letra o dígito.
export function stackName(project, branch) {
  const s = `${project}-${branch}`.toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/^[^a-z0-9]+/, '');
  return s || 'habitat';
}

// repos: nombres válidos para {{path:X}} ('self' + los relacionados).
function classify(raw, repos) {
  const t = raw.trim();
  if (t === 'stack' || t === 'branch') return { kind: t };
  const m = /^(port|path):(.+)$/.exec(t);
  if (m && m[1] === 'port' && PORT_NAME_RE.test(m[2])) return { kind: 'port', arg: m[2] };
  if (m && m[1] === 'path' && repos.includes(m[2])) return { kind: 'path', arg: m[2] };
  return { kind: 'unknown' };
}

export function scan(template, repos) {
  const ports = new Set();
  const unknown = [];
  for (const m of String(template).matchAll(TOKEN_RE)) {
    const c = classify(m[1], repos);
    if (c.kind === 'port') ports.add(c.arg);
    else if (c.kind === 'unknown' && !unknown.includes(m[0])) unknown.push(m[0]);
  }
  return { ports: [...ports].sort(), unknown };
}

export function render(template, ctx) {
  const repos = Object.keys(ctx.paths);
  const { ports, unknown } = scan(template, repos);
  for (const p of ports) if (ctx.ports[p] == null) unknown.push(`{{port:${p}}}`);
  if (unknown.length) return { ok: false, unknown };
  const text = String(template).replace(TOKEN_RE, (_, raw) => {
    const c = classify(raw, repos);
    if (c.kind === 'stack') return ctx.stack;
    if (c.kind === 'branch') return ctx.branch;
    if (c.kind === 'path') return ctx.paths[c.arg];
    return String(ctx.ports[c.arg]);
  });
  return { ok: true, text };
}
