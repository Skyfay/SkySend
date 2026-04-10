// https://vitepress.dev/guide/custom-theme
import DefaultTheme from 'vitepress/theme'
import { useData } from 'vitepress'
import { watch } from 'vue'

export default {
  extends: DefaultTheme,
  setup() {
    const { page } = useData()

    if (typeof window !== 'undefined') {
      watch(() => page.value.lastUpdated, (timestamp) => {
        if (!timestamp) return

        setTimeout(() => {
          const lastUpdatedEl = document.querySelector('.VPLastUpdated time')
          if (lastUpdatedEl && timestamp) {
            const date = new Date(timestamp)
            const formatted = date.toLocaleString('de-CH', {
              dateStyle: 'short',
              timeStyle: 'short'
            })
            lastUpdatedEl.textContent = formatted
          }
        }, 0)
      }, { immediate: true })
    }
  }
}
