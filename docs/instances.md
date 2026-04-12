---
sidebar: false
aside: false
---

# Public Instances

A list of publicly available SkySend instances. If you don't want to self-host, you can use one of these.

::: tip Want to list your instance?
Open a [GitHub Issue](https://github.com/Skyfay/SkySend/issues) or submit a pull request to add your public instance to this list.
:::

## Available Instances

<script setup>
import InstancesTable from './.vitepress/components/InstancesTable.vue'
</script>

<InstancesTable />

::: info
The version badge is fetched live from each instance's `/api/health` endpoint. If an instance shows **offline**, it may be temporarily unavailable.
:::

::: warning Disclaimer
Public instances are operated by independent parties. SkySend is end-to-end encrypted, so instance operators cannot access your file contents. However, availability, uptime and data retention are not guaranteed by the SkySend project.
:::
