import React from "react";
import { Box, Text } from "ink";
import type { AppState } from "../types.js";
import { formatBytes } from "../../lib/progress.js";
import { useAccent } from "../theme.js";

interface HeaderProps {
  appState: AppState;
}

export function Header({ appState }: HeaderProps): React.ReactElement {
  const accent = useAccent();
  const { config, quota, serverName, server } = appState;
  const title = config.customTitle || "SkySend";
  const services = config.enabledServices.join(", ");

  return (
    <Box flexDirection="column" borderStyle="single" borderColor={accent} paddingX={1}>
      <Box justifyContent="space-between">
        <Text bold color={accent}>{title}</Text>
        <Text dimColor>{serverName !== server ? `${serverName} (${server})` : server}</Text>
      </Box>
      <Box gap={2} marginTop={1}>
        <Text>
          <Text dimColor>Services: </Text>
          <Text>{services}</Text>
        </Text>
        <Text>
          <Text dimColor>Max size: </Text>
          <Text>{formatBytes(config.fileMaxSize)}</Text>
        </Text>
        <Text>
          <Text dimColor>Max files: </Text>
          <Text>{config.fileMaxFilesPerUpload}</Text>
        </Text>
      </Box>
      {quota?.enabled && (
        <Box marginTop={0}>
          <Text>
            <Text dimColor>Quota: </Text>
            <Text color={quota.remaining < quota.limit * 0.1 ? "red" : quota.remaining < quota.limit * 0.3 ? "yellow" : "green"}>
              {formatBytes(quota.used)}
            </Text>
            <Text dimColor> / {formatBytes(quota.limit)}</Text>
            <Text> </Text>
            <Text dimColor>({formatBytes(quota.remaining)} remaining)</Text>
          </Text>
        </Box>
      )}
    </Box>
  );
}
