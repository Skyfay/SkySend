<script setup lang="ts">
import { ref, onMounted } from 'vue'

interface Contact {
  label: string
  url: string
}

interface Instance {
  name: string
  url: string
  country: string
  flag: string
  maxFileSize: string
  filesPerUpload: number
  quota: string
  maxExpiry: string
  maxDownloads: number
  contact: Contact
  version: string | null
}

const instances = ref<Instance[]>([
  {
    name: 'app.skysend.ch',
    url: 'https://app.skysend.ch',
    country: 'Switzerland',
    flag: '🇨🇭',
    maxFileSize: '15 GB',
    filesPerUpload: 32,
    quota: '100 GB',
    maxExpiry: '7 days',
    maxDownloads: 100,
    contact: { label: 'SkySend', url: 'http://docs.skysend.ch/#%F0%9F%92%AC-community-support' },
    version: null,
  },
])

async function fetchVersion(baseUrl: string): Promise<string | null> {
  try {
    const res = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) return null
    const data = await res.json()
    return data.version ?? null
  } catch {
    return null
  }
}

onMounted(async () => {
  await Promise.allSettled(
    instances.value.map(async (inst, i) => {
      const version = await fetchVersion(inst.url)
      instances.value[i] = { ...instances.value[i]!, version }
    }),
  )
})
</script>

<template>
  <div class="instances-list">
    <div v-for="inst in instances" :key="inst.url" class="instance-card">
      <div class="card-header">
        <div class="card-title">
          <span class="flag">{{ inst.flag }}</span>
          <a :href="inst.url" target="_blank" rel="noopener noreferrer">{{ inst.name }}</a>
          <span v-if="inst.version" class="badge version">v{{ inst.version }}</span>
          <span v-else class="badge offline">offline</span>
        </div>
        <div class="card-subtitle">
          {{ inst.country }}
          <span class="separator">·</span>
          <a :href="inst.contact.url" target="_blank" rel="noopener noreferrer" class="contact">{{ inst.contact.label }}</a>
        </div>
      </div>
      <div class="card-stats">
        <div class="stat">
          <span class="stat-value">{{ inst.maxFileSize }}</span>
          <span class="stat-label">Max File Size</span>
        </div>
        <div class="stat">
          <span class="stat-value">{{ inst.filesPerUpload }}</span>
          <span class="stat-label">Files / Upload</span>
        </div>
        <div class="stat">
          <span class="stat-value">{{ inst.quota }}</span>
          <span class="stat-label">Quota / 24h</span>
        </div>
        <div class="stat">
          <span class="stat-value">{{ inst.maxExpiry }}</span>
          <span class="stat-label">Max Expiry</span>
        </div>
        <div class="stat">
          <span class="stat-value">{{ inst.maxDownloads }}</span>
          <span class="stat-label">Max Downloads</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.instances-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  margin: 1.5rem 0;
}

.instance-card {
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  padding: 1.25rem 1.5rem;
  background: var(--vp-c-bg-soft);
  transition: border-color 0.25s;
}

.instance-card:hover {
  border-color: var(--vp-c-brand-1);
}

.card-header {
  margin-bottom: 1rem;
}

.card-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 1.1rem;
  font-weight: 600;
}

.card-title a {
  color: var(--vp-c-brand-1);
  text-decoration: none;
}

.card-title a:hover {
  text-decoration: underline;
}

.flag {
  font-size: 1.4rem;
}

.card-subtitle {
  margin-top: 0.25rem;
  font-size: 0.85rem;
  color: var(--vp-c-text-2);
}

.separator {
  margin: 0 0.35rem;
}

.contact {
  color: var(--vp-c-text-2);
  text-decoration: none;
}

.contact:hover {
  color: var(--vp-c-brand-1);
}

.card-stats {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 0.75rem;
}

@media (max-width: 640px) {
  .card-stats {
    grid-template-columns: repeat(2, 1fr);
  }
}

.stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0.6rem 0.5rem;
  background: var(--vp-c-bg);
  border-radius: 8px;
  border: 1px solid var(--vp-c-divider);
}

.stat-value {
  font-size: 1rem;
  font-weight: 700;
  color: var(--vp-c-text-1);
}

.stat-label {
  font-size: 0.75rem;
  color: var(--vp-c-text-3);
  margin-top: 0.15rem;
}

.badge {
  display: inline-block;
  padding: 0.1rem 0.45rem;
  border-radius: 6px;
  font-size: 0.75rem;
  font-weight: 600;
}

.badge.version {
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
}

.badge.offline {
  background: var(--vp-c-danger-soft);
  color: var(--vp-c-danger-1);
}
</style>
