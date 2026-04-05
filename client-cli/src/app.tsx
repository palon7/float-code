import React, { useState, useCallback, useEffect } from "react";
import { useApp } from "ink";
import { WsClient } from "./client/ws.js";
import { HttpClient } from "./client/http.js";
import type { Keypair } from "./auth/keypair.js";

import { ChatView } from "./components/chat-view.js";
import { WorkspaceSelector } from "./components/workspace-selector.js";
import { SessionSelector } from "./components/session-selector.js";

type AppMode = "chat" | "workspace-select" | "session-select";

type AppProps = {
  wsUrl: string;
  httpUrl: string;
  token: string;
  keypair: Keypair;
  clearScreen: () => void;
};

export function App({ wsUrl, httpUrl, token, keypair, clearScreen }: AppProps) {
  const { exit } = useApp();
  const [mode, setMode] = useState<AppMode>("chat");
  const [workspacePath, setWorkspacePath] = useState(process.cwd());

  const [wsClient] = useState(() => new WsClient(wsUrl, token, keypair));
  const [httpClient] = useState(() => new HttpClient(httpUrl, token));

  useEffect(() => {
    if (!token) return;
    wsClient.connect();
    return () => wsClient.disconnect();
  }, [wsClient, token]);

  const handleCommand = useCallback(
    (command: string): boolean => {
      switch (command) {
        case "/quit":
          wsClient.disconnect();
          exit();
          return true;
        case "/workspace":
          setMode("workspace-select");
          return true;
        case "/sessions":
          setMode("session-select");
          return true;
        default:
          return false;
      }
    },
    [wsClient, exit],
  );

  const handleWorkspaceSelect = useCallback((path: string) => {
    setWorkspacePath(path);
    setMode("session-select");
  }, []);

  const handleResumeSession = useCallback(
    (sessionId: string) => {
      wsClient.openSession({ sessionId, workspacePath });
      setMode("chat");
    },
    [wsClient, workspacePath],
  );

  const handleNewSession = useCallback(() => {
    wsClient.openSession({ workspacePath });
    setMode("chat");
  }, [wsClient, workspacePath]);

  const handleWorkspacePathChange = useCallback((path: string) => {
    setWorkspacePath(path);
  }, []);

  const handleBackToChat = useCallback(() => {
    setMode("chat");
  }, []);

  if (mode === "workspace-select") {
    return (
      <WorkspaceSelector
        httpClient={httpClient}
        currentPath={workspacePath}
        onSelect={handleWorkspaceSelect}
        onCancel={handleBackToChat}
      />
    );
  }

  if (mode === "session-select") {
    return (
      <SessionSelector
        httpClient={httpClient}
        workspacePath={workspacePath}
        onNewSession={handleNewSession}
        onResumeSession={handleResumeSession}
        onCancel={handleBackToChat}
      />
    );
  }

  return (
    <ChatView
      wsClient={wsClient}
      workspacePath={workspacePath}
      onCommand={handleCommand}
      onWorkspacePathChange={handleWorkspacePathChange}
      clearScreen={clearScreen}
    />
  );
}
