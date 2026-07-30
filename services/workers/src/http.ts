export interface WorkerHealth {
  status: 'ok'
  service: 'zamam-workers'
}

export function createWorkerHttpHandler() {
  return async (request: Request): Promise<Response> => {
    const path = new URL(request.url).pathname
    if (request.method === 'GET' && path === '/health') {
      const body: WorkerHealth = { status: 'ok', service: 'zamam-workers' }
      return Response.json(body, { headers: { 'cache-control': 'no-store' } })
    }
    if (request.method === 'POST' && path === '/internal/events/process') {
      return Response.json({ error: { code: 'WORKER_TRANSPORT_NOT_CONFIGURED' } }, { status: 503 })
    }
    return Response.json({ error: { code: 'NOT_FOUND' } }, { status: 404 })
  }
}
