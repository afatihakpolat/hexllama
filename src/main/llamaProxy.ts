import { randomUUID } from 'crypto'
import http, { type IncomingMessage, type Server, type ServerResponse } from 'http'
import type { UsageRequestRecord, UsageTimingSnapshot } from '../shared/types'

interface ProxyUsageContext {
  launchId: string
  templateId: string
  templateNameSnapshot: string
  modelPathSnapshot?: string
}

interface ProxyCallbacks {
  onRequestStarted: (path: string) => void
  onRequestFinished: (record: UsageRequestRecord) => void
}

export interface LlamaProxyHandle {
  close: () => Promise<void>
}

export interface StartLlamaProxyOptions extends ProxyCallbacks, ProxyUsageContext {
  publicHost: string
  publicPort: number
  upstreamHost: string
  upstreamPort: number
}

interface ExtractedUsage {
  countedExactly: boolean
  promptTokens: number
  cacheTokens: number
  completionTokens: number
  totalTokens: number
  timings?: UsageTimingSnapshot
}

const TRACKED_PATHS = new Set([
  '/completion',
  '/completions',
  '/chat/completions',
  '/v1/chat/completions',
  '/v1/completions',
  '/v1/models'
])

const EXACT_USAGE_PATHS = new Set([
  '/completion',
  '/completions',
  '/chat/completions',
  '/v1/chat/completions',
  '/v1/completions'
])

function shouldTrackRequest(pathname: string): boolean {
  return TRACKED_PATHS.has(pathname)
}

function isExactUsagePath(method: string, pathname: string): boolean {
  return method === 'POST' && EXACT_USAGE_PATHS.has(pathname)
}

function normalizeTimings(timings: unknown): UsageTimingSnapshot | undefined {
  if (!timings || typeof timings !== 'object') return undefined

  const value = timings as Record<string, unknown>
  const normalized: UsageTimingSnapshot = {}
  if (typeof value.cache_n === 'number') normalized.cacheN = value.cache_n
  if (typeof value.prompt_n === 'number') normalized.promptN = value.prompt_n
  if (typeof value.prompt_ms === 'number') normalized.promptMs = value.prompt_ms
  if (typeof value.prompt_per_second === 'number') normalized.promptPerSecond = value.prompt_per_second
  if (typeof value.predicted_n === 'number') normalized.predictedN = value.predicted_n
  if (typeof value.predicted_ms === 'number') normalized.predictedMs = value.predicted_ms
  if (typeof value.predicted_per_second === 'number') normalized.predictedPerSecond = value.predicted_per_second

  return Object.keys(normalized).length > 0 ? normalized : undefined
}

function extractUsage(payload: unknown): ExtractedUsage {
  if (!payload || typeof payload !== 'object') {
    return {
      countedExactly: false,
      promptTokens: 0,
      cacheTokens: 0,
      completionTokens: 0,
      totalTokens: 0
    }
  }

  const record = payload as Record<string, unknown>
  const usage = record.usage && typeof record.usage === 'object'
    ? record.usage as Record<string, unknown>
    : null
  const timings = normalizeTimings(record.timings)

  if (usage) {
    const promptTokens = typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : 0
    const promptTokenDetails = usage.prompt_tokens_details && typeof usage.prompt_tokens_details === 'object'
      ? usage.prompt_tokens_details as Record<string, unknown>
      : null
    const usageCacheTokens = typeof promptTokenDetails?.cached_tokens === 'number'
      ? promptTokenDetails.cached_tokens
      : 0
    const timingCacheTokens = typeof timings?.cacheN === 'number'
      ? timings.cacheN
      : 0
    const cacheTokens = Math.max(usageCacheTokens, timingCacheTokens)
    const completionTokens = typeof usage.completion_tokens === 'number' ? usage.completion_tokens : 0
    const totalTokens = typeof usage.total_tokens === 'number' ? usage.total_tokens : promptTokens + completionTokens

    return {
      countedExactly: true,
      promptTokens,
      cacheTokens,
      completionTokens,
      totalTokens,
      timings
    }
  }

  if (timings && typeof timings.promptN === 'number' && typeof timings.predictedN === 'number') {
    const promptTokens = timings.promptN
    const cacheTokens = typeof timings.cacheN === 'number' ? timings.cacheN : 0
    const completionTokens = timings.predictedN

    return {
      countedExactly: true,
      promptTokens,
      cacheTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      timings
    }
  }

  return {
    countedExactly: false,
    promptTokens: 0,
    cacheTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    timings
  }
}

function buildProxyErrorRecord(context: ProxyUsageContext, method: string, pathname: string, startedAt: string, startTimeMs: number, error: string): UsageRequestRecord {
  const finishedAt = new Date().toISOString()

  return {
    id: randomUUID(),
    launchId: context.launchId,
    templateId: context.templateId,
    templateNameSnapshot: context.templateNameSnapshot,
    modelPathSnapshot: context.modelPathSnapshot,
    method,
    path: pathname,
    statusCode: 502,
    startedAt,
    finishedAt,
    durationMs: Date.now() - startTimeMs,
    stream: false,
    countedExactly: false,
    promptTokens: 0,
    cacheTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    error
  }
}

function parseSseUsage(text: string): ExtractedUsage {
  const usage: ExtractedUsage = {
    countedExactly: false,
    promptTokens: 0,
    cacheTokens: 0,
    completionTokens: 0,
    totalTokens: 0
  }

  const events = text.split(/\r?\n\r?\n/)
  for (const eventText of events) {
    const payload = eventText
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .join('')

    if (!payload || payload === '[DONE]') {
      continue
    }

    try {
      const extracted = extractUsage(JSON.parse(payload))
      if (extracted.countedExactly || extracted.timings) {
        usage.countedExactly = extracted.countedExactly
        usage.promptTokens = extracted.promptTokens
        usage.completionTokens = extracted.completionTokens
        usage.totalTokens = extracted.totalTokens
        usage.timings = extracted.timings
      }
    } catch {}
  }

  return usage
}

function writeProxyResponseHeaders(clientResponse: ServerResponse, upstreamResponse: IncomingMessage): void {
  const headers = { ...upstreamResponse.headers }
  clientResponse.writeHead(upstreamResponse.statusCode ?? 502, headers)
}

function createProxyServer(options: StartLlamaProxyOptions): Server {
  return http.createServer((clientRequest, clientResponse) => {
    const pathname = clientRequest.url || '/'
    const method = (clientRequest.method || 'GET').toUpperCase()
    const trackRequest = shouldTrackRequest(pathname)
    const startTimeMs = Date.now()
    const startedAt = new Date(startTimeMs).toISOString()
    let finished = false

    if (trackRequest) {
      options.onRequestStarted(pathname)
    }

    const upstreamRequest = http.request({
      hostname: options.upstreamHost,
      port: options.upstreamPort,
      path: pathname,
      method,
      headers: {
        ...clientRequest.headers,
        host: `${options.upstreamHost}:${options.upstreamPort}`
      }
    }, (upstreamResponse) => {
      const contentType = `${upstreamResponse.headers['content-type'] || ''}`.toLowerCase()
      const stream = contentType.includes('text/event-stream')
      const shouldExtractUsage = trackRequest && isExactUsagePath(method, pathname)
      const chunks: Buffer[] = []

      const finalizeTrackedRequest = (override: Partial<UsageRequestRecord> = {}) => {
        if (!trackRequest || finished) {
          return
        }

        finished = true
        const bodyText = Buffer.concat(chunks).toString('utf-8')
        const extracted = shouldExtractUsage
          ? (stream ? parseSseUsage(bodyText) : (() => {
              try {
                return extractUsage(JSON.parse(bodyText || '{}'))
              } catch {
                return {
                  countedExactly: false,
                  promptTokens: 0,
                  cacheTokens: 0,
                  completionTokens: 0,
                  totalTokens: 0
                }
              }
            })())
          : {
              countedExactly: false,
              promptTokens: 0,
              cacheTokens: 0,
              completionTokens: 0,
              totalTokens: 0
            }

        options.onRequestFinished({
          id: randomUUID(),
          launchId: options.launchId,
          templateId: options.templateId,
          templateNameSnapshot: options.templateNameSnapshot,
          modelPathSnapshot: options.modelPathSnapshot,
          method,
          path: pathname,
          statusCode: upstreamResponse.statusCode ?? null,
          startedAt,
          finishedAt: new Date().toISOString(),
          durationMs: Date.now() - startTimeMs,
          stream,
          countedExactly: extracted.countedExactly,
          promptTokens: extracted.promptTokens,
          cacheTokens: extracted.cacheTokens,
          completionTokens: extracted.completionTokens,
          totalTokens: extracted.totalTokens,
          timings: extracted.timings,
          error: (upstreamResponse.statusCode ?? 500) >= 400 ? `HTTP ${upstreamResponse.statusCode ?? 500}` : undefined,
          ...override
        })
      }

      writeProxyResponseHeaders(clientResponse, upstreamResponse)

      upstreamResponse.on('data', (chunk: Buffer) => {
        chunks.push(chunk)
        clientResponse.write(chunk)
      })

      upstreamResponse.on('end', () => {
        clientResponse.end()
        finalizeTrackedRequest()
      })

      upstreamResponse.on('aborted', () => {
        if (!clientResponse.writableEnded) {
          clientResponse.end()
        }
        finalizeTrackedRequest({ error: 'Upstream response terminated unexpectedly.' })
      })

      upstreamResponse.on('error', (error) => {
        if (!clientResponse.writableEnded) {
          clientResponse.end()
        }
        finalizeTrackedRequest({ error: error instanceof Error ? error.message : String(error) })
      })

      upstreamResponse.on('close', () => {
        if (clientResponse.writableEnded || finished) {
          return
        }

        clientResponse.end()
        finalizeTrackedRequest({ error: 'Upstream response closed before completion.' })
      })
    })

    upstreamRequest.on('error', (error) => {
      const message = error instanceof Error ? error.message : String(error)

      if (!clientResponse.headersSent) {
        clientResponse.writeHead(502, { 'Content-Type': 'application/json' })
      }
      clientResponse.end(JSON.stringify({ error: { message: `Upstream request failed: ${message}` } }))

      if (!trackRequest || finished) {
        return
      }

      finished = true
      options.onRequestFinished(buildProxyErrorRecord(options, method, pathname, startedAt, startTimeMs, message))
    })

    clientRequest.on('aborted', () => {
      upstreamRequest.destroy()
      if (!trackRequest || finished) {
        return
      }

      finished = true
      options.onRequestFinished(buildProxyErrorRecord(options, method, pathname, startedAt, startTimeMs, 'Client disconnected before the response completed.'))
    })

    clientRequest.pipe(upstreamRequest)
  })
}

export function startLlamaProxy(options: StartLlamaProxyOptions): Promise<LlamaProxyHandle> {
  const server = createProxyServer(options)
  const sockets = new Set<import('net').Socket>()

  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.on('close', () => {
      sockets.delete(socket)
    })
  })

  return new Promise((resolve, reject) => {
    let closed = false

    server.once('error', reject)
    server.listen(options.publicPort, options.publicHost, () => {
      server.off('error', reject)
      resolve({
        close: () => new Promise<void>((closeResolve) => {
          if (closed) {
            closeResolve()
            return
          }

          closed = true
          for (const socket of sockets) {
            socket.destroy()
          }
          server.close(() => closeResolve())
        })
      })
    })
  })
}