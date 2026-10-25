/**
 * SkySend Instances Worker
 *
 * Fetches /api/health and /api/config from all registered SkySend instances
 * on a cron schedule and caches the results in KV. Serves cached data via
 * a single GET endpoint so the docs site only needs one request.
 */

interface Env {
  SKYSEND_INSTANCES: KVNamespace
  INSTANCES_JSON_URL?: string
}

const KV_KEY = 'instances'
const DEFAULT_INSTANCES_URL = 'https://docs.skysend.app/instances.json'
const FETCH_TIMEOUT_MS = 8000

/**
 * A Worker's fetch sends no User-Agent of its own, and Cloudflare's Browser Integrity Check blocks
 * requests without one. An instance behind such a zone then looked offline. The name also lets an
 * operator recognise the check and allow it through.
 */
const USER_AGENT = 'SkySend-Instances/1.0 (+https://docs.skysend.app/instances)'

/**
 * The most bytes read from the health or config answer of one instance. Both are a few hundred
 * bytes. An instance is run by whoever registered it, and one that answered with 30 MiB made the
 * single KV value of all instances too large, so the write failed and no instance was refreshed.
 */
const MAX_INSTANCE_RESPONSE_BYTES = 64 * 1024
/** The most bytes read from the registry, which the project itself maintains. */
const MAX_REGISTRY_BYTES = 1024 * 1024

/* ---------- Types ---------- */

interface StaticInstance {
  name: string
  url: string
  country: string
  flag: string
  contact: { label: string; url: string }
}

interface CachedInstance {
  // Static (from instances.json)
  name: string
  url: string
  country: string
  flag: string
  contact: { label: string; url: string }
  // Dynamic (from API)
  online: boolean
  version: string | null
  enabledServices: string[]
  fileMaxSize: number | null
  fileMaxFilesPerUpload: number | null
  fileMaxExpiry: number | null
  fileMaxDownloads: number | null
  fileUploadQuotaBytes: number | null
  fileUploadQuotaWindow: number | null
  noteMaxSize: number | null
  noteMaxExpiry: number | null
  noteMaxViews: number | null
}

interface CachedData {
  instances: CachedInstance[]
  lastUpdated: string
}

/* ---------- Fetch helpers ---------- */

/**
 * Fetches JSON, or null for a failed request, a body over `maxBytes` or one that is no JSON.
 * The body is read in pieces and dropped at the limit, never parsed whole first.
 */
async function fetchJson(url: string, maxBytes: number): Promise<unknown> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!res.ok || !res.body) return null
    if (Number(res.headers.get('Content-Length') ?? 0) > maxBytes) {
      await res.body.cancel()
      return null
    }
    const reader = res.body.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel()
        return null
      }
      chunks.push(value)
    }
    const bytes = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    return null
  }
}

/* ---------- What an instance may put into the cache ---------- */

// An instance answers with whatever its operator serves, so only values of the expected type and
// size go into the cache and on to the docs site. Anything else counts as missing.

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function shortString(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.length <= max ? value : null
}

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function maxFromArray(value: unknown): number | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 64) return null
  let max: number | null = null
  for (const item of value) {
    const n = count(item)
    if (n === null) return null
    if (max === null || n > max) max = n
  }
  return max
}

function services(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string' && /^[a-z]{1,16}$/.test(item))
    .slice(0, 8)
}

async function fetchInstanceData(inst: StaticInstance): Promise<CachedInstance> {
  const [healthBody, configBody] = await Promise.all([
    fetchJson(`${inst.url}/api/health`, MAX_INSTANCE_RESPONSE_BYTES),
    fetchJson(`${inst.url}/api/config`, MAX_INSTANCE_RESPONSE_BYTES),
  ])
  const health = isObject(healthBody) ? healthBody : {}
  const config = isObject(configBody) ? configBody : {}

  return {
    name: inst.name,
    url: inst.url,
    country: inst.country,
    flag: inst.flag,
    contact: inst.contact,
    online: health.status === 'ok',
    version: shortString(health.version, 64),
    enabledServices: services(config.enabledServices),
    fileMaxSize: count(config.fileMaxSize),
    fileMaxFilesPerUpload: count(config.fileMaxFilesPerUpload),
    fileMaxExpiry: maxFromArray(config.fileExpireOptions),
    fileMaxDownloads: maxFromArray(config.fileDownloadOptions),
    fileUploadQuotaBytes: count(config.fileUploadQuotaBytes),
    fileUploadQuotaWindow: count(config.fileUploadQuotaWindow),
    noteMaxSize: count(config.noteMaxSize),
    noteMaxExpiry: maxFromArray(config.noteExpireOptions),
    noteMaxViews: maxFromArray(config.noteViewOptions),
  }
}

/* ---------- Cron handler ---------- */

async function handleScheduled(env: Env): Promise<void> {
  const instancesUrl = env.INSTANCES_JSON_URL ?? DEFAULT_INSTANCES_URL
  const registry = await fetchJson(instancesUrl, MAX_REGISTRY_BYTES)
  const staticInstances = Array.isArray(registry) ? (registry as StaticInstance[]) : null

  if (!staticInstances || staticInstances.length === 0) {
    console.error('Failed to fetch instances.json or list is empty')
    return
  }

  const results = await Promise.allSettled(
    staticInstances.map((inst) => fetchInstanceData(inst)),
  )

  const instances: CachedInstance[] = results
    .filter((r): r is PromiseFulfilledResult<CachedInstance> => r.status === 'fulfilled')
    .map((r) => r.value)

  const data: CachedData = {
    instances,
    lastUpdated: new Date().toISOString(),
  }

  try {
    await env.SKYSEND_INSTANCES.put(KV_KEY, JSON.stringify(data))
    console.log(`Cached ${instances.length} instances at ${data.lastUpdated}`)
  } catch (err) {
    // The previous value stays and is served until the next run.
    console.error('Writing the instances to KV failed:', err instanceof Error ? err.message : 'unknown')
  }
}

/* ---------- HTTP handler ---------- */

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Cache-Control': 'public, max-age=300',
  }
}

async function handleRequest(request: Request, env: Env): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() })
  }

  const url = new URL(request.url)

  if (url.pathname === '/' || url.pathname === '/instances') {
    const cached = await env.SKYSEND_INSTANCES.get(KV_KEY)
    if (!cached) {
      return new Response(JSON.stringify({ instances: [], lastUpdated: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders() },
      })
    }

    return new Response(cached, {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    })
  }

  return new Response('Not Found', { status: 404, headers: corsHeaders() })
}

/* ---------- Worker export ---------- */

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env)
  },

  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    await handleScheduled(env)
  },
} satisfies ExportedHandler<Env>
