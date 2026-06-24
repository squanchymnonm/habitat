// POST del nuevo orden de sesiones al server. El broadcast WS sincroniza otros clientes.
const token = () => new URLSearchParams(location.search).get('token') ?? ''
const jsonHeaders = (): Record<string, string> => {
  const t = token()
  return { 'content-type': 'application/json', ...(t ? { authorization: `Bearer ${t}` } : {}) }
}

export async function postOrder(ids: string[]): Promise<boolean> {
  try {
    const res = await fetch('/sessions/order', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ order: ids }),
    })
    return res.ok
  } catch {
    return false
  }
}
