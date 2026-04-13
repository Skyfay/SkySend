---
sidebar: false
aside: false
---

# Public Instances

A list of publicly available SkySend instances. If you don't want to self-host, you can use one of these.

::: tip Want to list your instance?
Open a [GitHub Issue](https://github.com/Skyfay/SkySend/issues) or submit a pull request adding your instance to [`docs/public/instances.json`](https://github.com/Skyfay/SkySend/blob/main/docs/public/instances.json).
:::

## Available Instances

<script setup>
import InstancesTable from './.vitepress/components/InstancesTable.vue'
</script>

<InstancesTable />

::: info
Instance data (version, limits, enabled services) is fetched automatically every hour from each instance's API. If an instance shows **offline**, it may be temporarily unavailable.
:::

::: warning Disclaimer
Public instances are operated by independent parties. SkySend is end-to-end encrypted, so instance operators cannot access your file contents. However, availability, uptime and data retention are not guaranteed by the SkySend project.
:::
