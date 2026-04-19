import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { useAccent } from "../theme.js";

interface TextPromptProps {
  label: string;
  onSubmit: (value: string) => void;
  onCancel?: () => void;
  placeholder?: string;
  defaultValue?: string;
  mask?: string;
  validate?: (value: string) => string | true;
}

export function TextPrompt({
  label, onSubmit, onCancel, placeholder, defaultValue = "", mask, validate,
}: TextPromptProps): React.ReactElement {
  const accent = useAccent();
  const [value, setValue] = useState(defaultValue);
  const [error, setError] = useState<string | null>(null);

  useInput((input, key) => {
    if (key.escape && onCancel) {
      onCancel();
      return;
    }
    if (key.return) {
      const val = value || defaultValue;
      if (validate) {
        const result = validate(val);
        if (result !== true) {
          setError(result);
          return;
        }
      }
      setError(null);
      onSubmit(val);
      return;
    }
    if (key.backspace || key.delete) {
      setValue((v) => v.slice(0, -1));
      setError(null);
      return;
    }
    if (input && !key.ctrl && !key.meta) {
      setValue((v) => v + input);
      setError(null);
    }
  });

  const display = mask ? mask.repeat(value.length) : value;

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box>
        <Text color={accent} bold>{label}: </Text>
        <Text>{display || ""}</Text>
        {!value && placeholder && (
          <Text dimColor>{placeholder}</Text>
        )}
        <Text color={accent}>█</Text>
      </Box>
      {error && (
        <Text color="red">{error}</Text>
      )}
    </Box>
  );
}
