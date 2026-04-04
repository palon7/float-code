import { useState } from "react";
import { AppShell, NavBar, Page } from "even-toolkit/web";
import { useAppRuntime } from "./hooks/use-app-runtime";
import { ChatTab } from "./components/ChatTab";
import { PairingBanner } from "./components/PairingBanner";
import { SettingsTab } from "./components/SettingsTab";
import { LogTab } from "./components/LogTab";

type TabId = "chat" | "settings" | "log";
const NAV_ITEMS: { id: TabId; label: string }[] = [
  { id: "chat", label: "Chat" },
  { id: "settings", label: "Settings" },
  { id: "log", label: "Log" },
];

function App() {
  useAppRuntime();
  const [activeTab, setActiveTab] = useState<TabId>("chat");

  return (
    <div className="min-h-dvh bg-bg">
      <AppShell
        className="bg-bg"
        header={
          <div className="mx-auto w-full max-w-[640px]">
            <NavBar
              activeId={activeTab}
              items={NAV_ITEMS}
              onNavigate={(id) => setActiveTab(id as TabId)}
            />
          </div>
        }
      >
        <Page className="mx-auto flex h-full min-h-0 w-full max-w-[640px] flex-col overflow-hidden px-3 pb-0 pt-3">
          {activeTab === "chat" && <ChatTab />}
          {activeTab === "settings" && <SettingsTab />}
          {activeTab === "log" && <LogTab />}
        </Page>
      </AppShell>
      <PairingBanner />
    </div>
  );
}

export default App;
