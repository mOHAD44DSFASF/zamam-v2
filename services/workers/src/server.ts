import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { pathToFileURL } from 'node:url'
import { getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { createLogger } from '@zamam/observability'
import { composeWorkerRuntime, type WorkerEnv } from './compose.js'
import { createWorkerHttpHandler } from './http.js'

function readBody(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => resolve(Buffer.concat(chunks)))
    request.on('error', reject)
  })
}

async function toWebRequest(request: IncomingMessage, host: string): Promise<Request> {
  const headers = new Headers()
  for (const [name, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) value.forEach((item) => headers.append(name, item))
    else if (value !== undefined) headers.set(name, value)
  }
  const url = `http://${host}${request.url ?? '/'}`
  const method = request.method ?? 'GET'
  const init: RequestInit = { method, headers }
  if (method !== 'GET' && method !== 'HEAD') init.body = new Uint8Array(await readBody(request))
  return new Request(url, init)
}

async function writeWebResponse(response: Response, target: ServerResponse) {
  const body = await response.text()
  target.statusCode = response.status
  response.headers.forEach((value, name) => target.setHeader(name, value))
  target.end(body)
}

/** Thin Node HTTP bootstrap around createWorkerHttpHandler() — no dispatch/business logic here, it only
 * adapts Node's request/response streams to the Web Request/Response the handler already speaks (the
 * same Fetch API shape services/functions/src/api/firebase-adapter.ts adapts Firebase's req/res to). */
export function startWorkerServer(port: number) {
  const env = process.env as WorkerEnv
  if (getApps().length === 0) initializeApp()
  const runtime = composeWorkerRuntime(getFirestore(), env)
  const handler = createWorkerHttpHandler(runtime)
  const logger = createLogger({ write: (record) => console.log(JSON.stringify(record)) })

  const server = createServer((request, response) => {
    toWebRequest(request, request.headers.host ?? `127.0.0.1:${port}`)
      .then(handler)
      .then((webResponse) => writeWebResponse(webResponse, response))
      .catch((error) => {
        logger.warn('worker.server.request_failed', 'server', {
          code: error instanceof Error ? error.message : 'REQUEST_FAILED',
        })
        response.statusCode = 500
        response.setHeader('content-type', 'application/json; charset=utf-8')
        response.end(JSON.stringify({ error: { code: 'WORKER_SERVER_ERROR' } }))
      })
  })

  server.listen(port, () => {
    const mode = env.ZAMAM_ENV === 'production' ? 'production' : 'local'
    logger.info('worker.server.started', 'startup', {
      port, mode, transportProvider: runtime.transport.provider, transportConfigured: runtime.transport.configured,
    })
    console.log(`zamam-workers listening on http://127.0.0.1:${port} (mode=${mode}, transport=${runtime.transport.provider})`)
  })

  return server
}

const isMainModule = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMainModule) {
  const port = Number(process.env.WORKER_HTTP_PORT ?? process.env.PORT ?? 8081)
  startWorkerServer(port)
}
