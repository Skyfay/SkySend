<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'

const WORKER_URL = 'https://instances.skysend.ch'

interface Instance {
  name: string
  url: string
  country: string
  flag: string
  contact: { label: string; url: string }
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
  instances: Instance[]
  lastUpdated: string | null
}

const loading = ref(true)
const instances = ref<Instance[]>([])
const lastUpdated = ref<string | null>(null)
const filter = ref<'all' | 'file' | 'note'>('all')

const filteredInstances = computed(() => {
  if (filter.value === 'all') return instances.value
  return instances.value.filter((inst) =>
    inst.enabledServices.includes(filter.value),
  )
})

function formatBytes(bytes: number | null): string {
  if (bytes === null || bytes === 0) return '-'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  const value = bytes / Math.pow(1024, i)
  return `${Number.isInteger(value) ? value : value.toFixed(1)} ${units[i]}`
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return '-'
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`
  if (seconds < 86400) return `${Math.round(seconds / 3600)} hours`
  return `${Math.round(seconds / 86400)} days`
}

function formatNumber(n: number | null): string {
  if (n === null) return '-'
  if (n === 0) return 'Unlimited'
  return String(n)
}

function serviceLabels(services: string[]): string {
  if (services.includes('file') && services.includes('note')) return 'Files & Notes'
  if (services.includes('file')) return 'Files only'
  if (services.includes('note')) return 'Notes only'
  return '-'
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

onMounted(async () => {
  try {
    const res = await fetch(WORKER_URL, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) return
    const data: CachedData = await res.json()
    instances.value = data.instances
    lastUpdated.value = data.lastUpdated
  } catch {
    // Worker unreachable - instances stays empty
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div class="instances-controls">
    <div class="filter-group">
      <button :class="['filter-btn', { active: filter === 'all' }]" @click="filter = 'all'">All</button>
      <button :class="['filter-btn', { active: filter === 'file' }]" @click="filter = 'file'">Files</button>
      <button :class="['filter-btn', { active: filter === 'note' }]" @click="filter = 'note'">Notes</button>
    </div>
    <span v-if="lastUpdated" class="last-updated">Updated {{ relativeTime(lastUpdated) }}</span>
  </div>

  <!-- Skeleton loading state -->
  <div v-if="loading" class="instances-list">
    <div v-for="n in 2" :key="n" class="instance-card skeleton-card">
      <div class="card-header">
        <div class="card-title">
          <span class="skeleton skeleton-flag"></span>
          <span class="skeleton skeleton-name"></span>
          <span class="skeleton skeleton-badge"></span>
        </div>
        <div class="card-subtitle">
          <span class="skeleton skeleton-subtitle"></span>
        </div>
      </div>
      <div class="card-services">
        <span class="skeleton skeleton-service"></span>
      </div>
      <div class="card-stats">
        <div v-for="s in 5" :key="s" class="stat">
          <span class="skeleton skeleton-stat-value"></span>
          <span class="skeleton skeleton-stat-label"></span>
        </div>
      </div>
    </div>
  </div>

  <!-- Loaded state -->
  <div v-else class="instances-list">
    <div v-if="filteredInstances.length === 0" class="empty-state">
      No instances found for this filter.
    </div>
    <div v-for="inst in filteredInstances" :key="inst.url" class="instance-card">
      <div class="card-header">
        <div class="card-title">
          <span class="flag">{{ inst.flag }}</span>
          <a :href="inst.url" target="_blank" rel="noopener noreferrer">{{ inst.name }}</a>
          <span v-if="inst.online && inst.version" class="badge version">v{{ inst.version }}</span>
          <span v-else class="badge offline">offline</span>
        </div>
        <div class="card-subtitle">
          {{ inst.country }}
          <span class="separator">·</span>
          <a :href="inst.contact.url" target="_blank" rel="noopener noreferrer" class="contact">{{ inst.contact.label }}</a>
        </div>
      </div>
      <div v-if="inst.enabledServices.length > 0" class="card-services">
        <span class="service-badge" :class="{ 'service-both': inst.enabledServices.length > 1 }">
          {{ serviceLabels(inst.enabledServices) }}
        </span>
      </div>
      <div v-if="inst.enabledServices.includes('file')" class="card-stats">
        <div class="stat">
          <span class="stat-value">{{ formatBytes(inst.fileMaxSize) }}</span>
          <span class="stat-label">Max Size</span>
        </div>
        <div class="stat">
          <span class="stat-value">{{ formatNumber(inst.fileMaxFilesPerUpload) }}</span>
          <span class="stat-label">Files / Upload</span>
        </div>
        <div class="stat">
          <span class="stat-value">{{ formatBytes(inst.fileUploadQuotaBytes) }}</span>
          <span class="stat-label">Quota / {{ inst.fileUploadQuotaWindow ? formatDuration(inst.fileUploadQuotaWindow) : '24h' }}</span>
        </div>
        <div class="stat">
          <span class="stat-value">{{ formatDuration(inst.fileMaxExpiry) }}</span>
          <span class="stat-label">Max Expiry</span>
        </div>
        <div class="stat">
          <span class="stat-value">{{ formatNumber(inst.fileMaxDownloads) }}</span>
          <span class="stat-label">Max Downloads</span>
        </div>
      </div>
      <div v-if="inst.enabledServices.includes('note')" class="note-details">
        <span class="note-details-label">Notes:</span>
        <span>{{ formatBytes(inst.noteMaxSize) }} max</span>
        <span class="detail-sep">·</span>
        <span>{{ formatDuration(inst.noteMaxExpiry) }} expiry</span>
        <span class="detail-sep">·</span>
        <span>{{ formatNumber(inst.noteMaxViews) }} views</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.instances-controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 1.5rem 0 0.75rem;
  gap: 1rem;
  flex-wrap: wrap;
}

.filter-group {
  display: flex;
  gap: 0.35rem;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  padding: 0.2rem;
}

.filter-btn {
  padding: 0.3rem 0.75rem;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--vp-c-text-2);
  font-size: 0.85rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.filter-btn:hover {
  color: var(--vp-c-text-1);
}

.filter-btn.active {
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
  font-weight: 600;
}

.last-updated {
  font-size: 0.78rem;
  color: var(--vp-c-text-3);
}

.instances-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  margin: 0.75rem 0 1.5rem;
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
  margin-bottom: 0.75rem;
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

.card-services {
  margin-bottom: 0.75rem;
}

.note-details {
  margin-top: 0.75rem;
  font-size: 0.82rem;
  color: var(--vp-c-text-2);
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.3rem;
}

.note-details-label {
  font-weight: 600;
  color: var(--vp-c-text-3);
}

.detail-sep {
  color: var(--vp-c-text-3);
}

.service-badge {
  display: inline-block;
  padding: 0.15rem 0.55rem;
  border-radius: 6px;
  font-size: 0.78rem;
  font-weight: 500;
  background: var(--vp-c-default-soft);
  color: var(--vp-c-text-2);
}

.service-badge.service-both {
  background: var(--vp-c-brand-soft);
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
  text-align: center;
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

.empty-state {
  text-align: center;
  padding: 2rem;
  color: var(--vp-c-text-3);
  font-size: 0.9rem;
}

/* Skeleton animation */
.skeleton-card {
  pointer-events: none;
}

.skeleton {
  display: inline-block;
  background: linear-gradient(90deg, var(--vp-c-divider) 25%, var(--vp-c-bg) 50%, var(--vp-c-divider) 75%);
  background-size: 200% 100%;
  animation: skeleton-pulse 1.5s ease-in-out infinite;
  border-radius: 4px;
}

.skeleton-flag {
  width: 1.4rem;
  height: 1.4rem;
  border-radius: 50%;
}

.skeleton-name {
  width: 140px;
  height: 1.1rem;
}

.skeleton-badge {
  width: 48px;
  height: 1rem;
  border-radius: 6px;
}

.skeleton-subtitle {
  width: 180px;
  height: 0.85rem;
  margin-top: 0.25rem;
}

.skeleton-service {
  width: 100px;
  height: 1.2rem;
  border-radius: 6px;
}

.skeleton-stat-value {
  width: 50px;
  height: 1rem;
}

.skeleton-stat-label {
  width: 65px;
  height: 0.75rem;
  margin-top: 0.15rem;
}

@keyframes skeleton-pulse {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
</style>
