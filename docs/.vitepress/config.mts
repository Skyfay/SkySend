import { defineConfig } from 'vitepress'

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: 'SkySend | Docs',
  description: 'Minimalist, self-hostable, end-to-end encrypted file sharing. Zero knowledge - the server never sees your data.',
  lang: 'en-US',
  cleanUrls: true,
  lastUpdated: true,
  sitemap: {
    hostname: 'https://docs.skysend.ch'
  },
  ignoreDeadLinks: [
    /localhost/
  ],
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/logo.svg' }],
    ['link', { rel: 'icon', type: 'image/png', href: '/logo.png' }],
    ['meta', { name: 'keywords', content: 'file sharing, end-to-end encryption, self-hosted, zero knowledge, encrypted upload, docker, open source' }],
    ['meta', { name: 'author', content: 'Skyfay' }],
    ['meta', { name: 'robots', content: 'index, follow' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:title', content: 'SkySend - Encrypted File Sharing' }],
    ['meta', { property: 'og:description', content: 'Minimalist, self-hostable, end-to-end encrypted file sharing. Zero knowledge - the server never sees your data.' }],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
    ['meta', { name: 'twitter:title', content: 'SkySend - Encrypted File Sharing' }],
    ['meta', { name: 'twitter:description', content: 'Minimalist, self-hostable, end-to-end encrypted file sharing. Zero knowledge - the server never sees your data.' }],
    ['script', { type: 'application/ld+json' }, JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      'name': 'SkySend',
      'description': 'Minimalist, self-hostable, end-to-end encrypted file sharing',
      'applicationCategory': 'DeveloperApplication',
      'operatingSystem': 'Docker, Linux',
      'offers': {
        '@type': 'Offer',
        'price': '0',
        'priceCurrency': 'USD'
      },
    })]
  ],
  themeConfig: {
    logo: '/logo.svg',

    lastUpdated: {
      text: 'Last updated',
      formatOptions: {
        dateStyle: 'short',
        timeStyle: 'short'
      }
    },

    nav: [
      { text: 'Home', link: '/' },
      { text: 'User Guide', link: '/user-guide/getting-started' },
      { text: 'Developer Guide', link: '/developer-guide/' },
      { text: 'Instances', link: '/instances' },
      {
        text: 'Resources',
        items: [
          { text: 'Screenshots', link: '/screenshots' },
          { text: 'Benchmarks', link: '/benchmarks' },
          { text: 'Changelog', link: '/changelog' },
          { text: 'Roadmap', link: '/roadmap' },
          { text: 'GitHub', link: 'https://github.com/Skyfay/SkySend' }
        ]
      }
    ],

    sidebar: {
      '/user-guide/': [
        {
          text: 'Getting Started',
          items: [
            { text: 'Introduction', link: '/user-guide/getting-started' },
            { text: 'Installation', link: '/user-guide/installation' },
            { text: 'First Steps', link: '/user-guide/first-steps' }
          ]
        },
        {
          text: 'Self-Hosting',
          collapsed: false,
          items: [
            { text: 'Docker Setup', link: '/user-guide/self-hosting/docker' },
            { text: 'Reverse Proxy', link: '/user-guide/self-hosting/reverse-proxy' },
            { text: 'Data & Backups', link: '/user-guide/self-hosting/data-backups' }
          ]
        },
        {
          text: 'Configuration',
          collapsed: false,
          items: [
            { text: 'Environment Variables', link: '/user-guide/configuration/environment-variables' },
            { text: 'Upload Limits', link: '/user-guide/configuration/upload-limits' },
            { text: 'Rate Limiting & Quotas', link: '/user-guide/configuration/rate-limiting' }
          ]
        },
        {
          text: 'Admin CLI',
          collapsed: false,
          items: [
            { text: 'Overview', link: '/user-guide/admin-cli/' },
            { text: 'Commands', link: '/user-guide/admin-cli/commands' }
          ]
        },
        {
          text: 'CLI Client',
          collapsed: false,
          items: [
            { text: 'Overview', link: '/user-guide/client-cli/' },
            { text: 'Commands', link: '/user-guide/client-cli/commands' }
          ]
        },
        {
          text: 'Security',
          collapsed: false,
          items: [
            { text: 'Encryption Design', link: '/user-guide/security/encryption' },
            { text: 'Threat Model', link: '/user-guide/security/threat-model' }
          ]
        }
      ],
      '/developer-guide/': [
        {
          text: 'Introduction',
          items: [
            { text: 'Overview', link: '/developer-guide/' },
            { text: 'Architecture', link: '/developer-guide/architecture' },
            { text: 'Project Setup', link: '/developer-guide/setup' }
          ]
        },
        {
          text: 'API Reference',
          collapsed: false,
          items: [
            { text: 'Overview', link: '/developer-guide/api/' },
            { text: 'Upload', link: '/developer-guide/api/upload' },
            { text: 'Download', link: '/developer-guide/api/download' },
            { text: 'Metadata & Info', link: '/developer-guide/api/metadata' },
            { text: 'Password Verification', link: '/developer-guide/api/password' },
            { text: 'Management', link: '/developer-guide/api/management' }
          ]
        },
        {
          text: 'Cryptography',
          collapsed: false,
          items: [
            { text: 'Overview', link: '/developer-guide/crypto/' },
            { text: 'Key Derivation', link: '/developer-guide/crypto/key-derivation' },
            { text: 'Streaming Encryption', link: '/developer-guide/crypto/streaming-encryption' },
            { text: 'Metadata Encryption', link: '/developer-guide/crypto/metadata-encryption' },
            { text: 'Password Protection', link: '/developer-guide/crypto/password-protection' }
          ]
        },
        {
          text: 'Reference',
          collapsed: false,
          items: [
            { text: 'Database Schema', link: '/developer-guide/reference/schema' },
            { text: 'Environment Variables', link: '/developer-guide/reference/environment' },
            { text: 'Testing Guide', link: '/developer-guide/reference/testing' },
            { text: 'Benchmarks', link: '/benchmarks' }
          ]
        }
      ]
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/Skyfay/SkySend' }
    ],

    footer: {
      message: 'Released under the AGPLv3 License. | <a href="https://skyfay.ch/privacy" target="_blank" rel="noopener noreferrer">Privacy</a> · <a href="https://skyfay.ch/legal" target="_blank" rel="noopener noreferrer">Legal Notice</a>',
      copyright: 'Copyright \u00a9 2026 SkySend'
    },

    search: {
      provider: 'local'
    },

    editLink: {
      pattern: 'https://github.com/Skyfay/SkySend/edit/main/docs/:path',
      text: 'Edit this page on GitHub'
    }
  },

  vite: {
    // Override esbuild target so it doesn't inherit ES2024 from root tsconfig
    esbuild: { target: 'es2022' },
    build: {
      chunkSizeWarningLimit: 1200,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules')) {
              return 'vendor'
            }
          }
        }
      }
    }
  }
})
