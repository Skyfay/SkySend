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

  const res = await fetch(url);
  if (!res.ok) throw new Error(String(res.status));
  const data: T = await res.json();

  try {
    sessionStorage.setItem(key, JSON.stringify({ data, ts: Date.now() }));
  } catch {
    // sessionStorage unavailable - skip caching
  }

  return data;
}
