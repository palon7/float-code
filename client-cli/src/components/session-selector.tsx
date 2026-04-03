import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import { Select, Spinner } from "@inkjs/ui";
import type { HttpClient } from "../client/http.js";
import { truncate, formatRelativeTime } from "../utils.js";

type Props = {
  httpClient: HttpClient;
  workspacePath: string;
  onNewSession: () => void;
  onResumeSession: (sessionId: string) => void;
  onCancel: () => void;
};

type ViewState =
  | { phase: "loading" }
  | { phase: "select"; options: Array<{ label: string; value: string }> };

export function SessionSelector({
  httpClient,
  workspacePath,
  onNewSession,
  onResumeSession,
  onCancel,
}: Props) {
  const [state, setState] = useState<ViewState>({ phase: "loading" });

  useEffect(() => {
    httpClient
      .getSessions(workspacePath)
      .then((sessions) => {
        const sessionOptions = sessions.map((s) => ({
          label: `${truncate(s.lastMessage ?? s.title ?? s.sessionId, 60)} (${formatRelativeTime(s.lastModified)})`,
          value: s.sessionId,
        }));
        const options = [
          { label: "New session", value: "__new__" },
          ...sessionOptions,
          { label: "Cancel", value: "__cancel__" },
        ];
        setState({ phase: "select", options });
      })
      .catch(() => {
        const options = [
          { label: "New session", value: "__new__" },
          { label: "Cancel", value: "__cancel__" },
        ];
        setState({ phase: "select", options });
      });
  }, [httpClient, workspacePath]);

  const handleSelect = (value: string) => {
    if (value === "__new__") {
      onNewSession();
    } else if (value === "__cancel__") {
      onCancel();
    } else {
      onResumeSession(value);
    }
  };

  return (
    <Box flexDirection="column" paddingLeft={1}>
      <Text color="cyan" bold>
        Select session
      </Text>
      <Text dimColor>Workspace: {workspacePath}</Text>
      <Box marginTop={1} />

      {state.phase === "loading" && <Spinner label="Loading..." />}

      {state.phase === "select" && (
        <Select options={state.options} onChange={handleSelect} />
      )}
    </Box>
  );
}
