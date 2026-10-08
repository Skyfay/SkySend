const FETCH_TIMEOUT_MS = 8000;

export async function fetchWithCache<T>(
  key: string,
  url: string,
  ttlMs: number
): Promise<T> {
  try {
    const cached = sessionStorage.getItem(key);
    if (cached) {
      const { data, ts } = JSON.parse(cached) as { data: T; ts: number };
      if (Date.now() - ts < ttlMs) return data;
    }
  } catch {
    // sessionStorage unavailable - fall through to fetch
  }

  // A service that does not answer gives up after a while, so the part of the
  // page that waits for it shows its fallback instead of loading forever.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let data: T;
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(String(res.status));
    data = await res.json();
  } finally {
    clearTimeout(timer);
  }

  try {
    sessionStorage.setItem(key, JSON.stringify({ data, ts: Date.now() }));
  } catch {
    // sessionStorage unavailable - skip caching
  }

  return data;
}
