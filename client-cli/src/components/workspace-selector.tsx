import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";
import { Select, Spinner } from "@inkjs/ui";
import type { HttpClient } from "../client/http.js";
import { formatRelativeTime } from "../utils.js";

type Props = {
  httpClient: HttpClient;
  currentPath: string;
  onSelect: (path: string) => void;
  onCancel: () => void;
};

type ViewState =
  | { phase: "loading" }
  | { phase: "select"; options: Array<{ label: string; value: string }> }
  | { phase: "input" }
  | { phase: "error"; message: string };

export function WorkspaceSelector({
  httpClient,
  currentPath,
  onSelect,
  onCancel,
}: Props) {
  const [state, setState] = useState<ViewState>({ phase: "loading" });
  const [inputValue, setInputValue] = useState("");

  useEffect(() => {
    httpClient
      .getRecentWorkspaces()
      .then((workspaces) => {
        const options = workspaces.map((ws) => ({
          label: `${ws.path} (${formatRelativeTime(ws.lastUsedAt)})`,
          value: ws.path,
        }));
        options.push({ label: "Open...", value: "__input__" });
        options.push({ label: "Cancel", value: "__cancel__" });
        setState({ phase: "select", options });
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : "unknown error";
        setState({ phase: "error", message });
      });
  }, [httpClient]);

  const handleSelect = (value: string) => {
    if (value === "__cancel__") {
      onCancel();
    } else if (value === "__input__") {
      setState({ phase: "input" });
    } else {
      onSelect(value);
    }
  };

  const handleInputSubmit = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      onCancel();
      return;
    }
    onSelect(trimmed);
  };

  return (
    <Box flexDirection="column" paddingLeft={1}>
      <Text color="cyan" bold>
        Select workspace
      </Text>
      <Text dimColor>Current: {currentPath}</Text>
      <Box marginTop={1} />

      {state.phase === "loading" && <Spinner label="Loading..." />}

      {state.phase === "select" && (
        <Select options={state.options} onChange={handleSelect} />
      )}

      {state.phase === "input" && (
        <Box>
          <Text color="magenta">{"Path: "}</Text>
          <TextInput
            value={inputValue}
            onChange={setInputValue}
            onSubmit={handleInputSubmit}
          />
        </Box>
      )}

      {state.phase === "error" && (
        <Box flexDirection="column">
          <Text color="red">
            {"✗ "}
            {state.message}
          </Text>
          <Box marginTop={1} />
          <Text dimColor>Open path:</Text>
          <Box>
            <Text color="magenta">{"Path: "}</Text>
            <TextInput
              value={inputValue}
              onChange={setInputValue}
              onSubmit={handleInputSubmit}
            />
          </Box>
        </Box>
      )}
    </Box>
  );
}
