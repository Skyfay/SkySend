# Admin CLI

SkySend includes a command-line administration tool for managing uploads and inspecting the server.

::: tip Looking for the CLI Client?
The **Admin CLI** (`skysend-cli`) is for server administrators to manage uploads and inspect the database. If you want to **upload and download files** from the terminal, see the [CLI Client](/user-guide/client-cli/) (`skysend`).
:::

## Overview

The CLI operates directly on the SQLite database and filesystem - no running server is required. This makes it useful for maintenance tasks and debugging.

## Installation

The CLI is part of the SkySend monorepo. After building the project:

```bash
# From the project root
pnpm build

# Run the CLI
node apps/cli/dist/index.js <command>
```

Or if you have set up an alias:

```bash
skysend-cli <command>
```

## Available Commands

| Command | Description |
| --- | --- |
| `list` | Show active uploads |
| `delete <id>` | Delete an upload by ID |
| `stats` | Show storage overview |
| `cleanup` | Remove expired uploads |
| `config` | Show server configuration |

See [Commands](/user-guide/admin-cli/commands) for detailed usage of each command.
