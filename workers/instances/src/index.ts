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
const DEFAULT_INSTANCES_URL = 'https://docs.skysend.ch/instances.json'
const FETCH_TIMEOUT_MS = 8000

/* ---------- Types ---------- */

interface StaticInstance {
  name: string
  url: string
  country: string
  flag: string
  contact: { label: string; url: string }
}

interface HealthResponse {
  status: string
  version: string
  timestamp: string
}

interface ConfigResponse {
  enabledServices: string[]
  fileMaxSize: number
  fileMaxFilesPerUpload: number
  fileExpireOptions: number[]
  fileDefaultExpire: number
  fileDownloadOptions: number[]
  fileDefaultDownload: number
  fileUploadQuotaBytes: number
  fileUploadQuotaWindow: number
  noteMaxSize: number
  noteExpireOptions: number[]
  noteDefaultExpire: number
  noteViewOptions: number[]
  noteDefaultViews: number
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

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

function maxFromArray(arr: number[] | undefined): number | null {
  if (!arr || arr.length === 0) return null
  return Math.max(...arr)
}

async function fetchInstanceData(inst: StaticInstance): Promise<CachedInstance> {
  const [health, config] = await Promise.all([
    fetchJson<HealthResponse>(`${inst.url}/api/health`),
    fetchJson<ConfigResponse>(`${inst.url}/api/config`),
  ])

  const online = health !== null && health.status === 'ok'

  return {
    name: inst.name,
    url: inst.url,
    country: inst.country,
    flag: inst.flag,
    contact: inst.contact,
    online,
    version: health?.version ?? null,
    enabledServices: config?.enabledServices ?? [],
    fileMaxSize: config?.fileMaxSize ?? null,
    fileMaxFilesPerUpload: config?.fileMaxFilesPerUpload ?? null,
    fileMaxExpiry: maxFromArray(config?.fileExpireOptions),
    fileMaxDownloads: maxFromArray(config?.fileDownloadOptions),
    fileUploadQuotaBytes: config?.fileUploadQuotaBytes ?? null,
    fileUploadQuotaWindow: config?.fileUploadQuotaWindow ?? null,
    noteMaxSize: config?.noteMaxSize ?? null,
    noteMaxExpiry: maxFromArray(config?.noteExpireOptions),
    noteMaxViews: maxFromArray(config?.noteViewOptions),
  }
}

/* ---------- Cron handler ---------- */

async function handleScheduled(env: Env): Promise<void> {
  const instancesUrl = env.INSTANCES_JSON_URL ?? DEFAULT_INSTANCES_URL
  const staticInstances = await fetchJson<StaticInstance[]>(instancesUrl)

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

  await env.SKYSEND_INSTANCES.put(KV_KEY, JSON.stringify(data))
  console.log(`Cached ${instances.length} instances at ${data.lastUpdated}`)
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
