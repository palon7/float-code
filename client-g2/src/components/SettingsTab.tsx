import { Card, Input, SettingsGroup } from "even-toolkit/web";
import { useAppStore } from "../app/app-store";

export function SettingsTab() {
  const serverHost = useAppStore((state) => state.serverHost);
  const serverToken = useAppStore((state) => state.serverToken);
  const apiKey = useAppStore((state) => state.apiKey);

  const setSetting = useAppStore((state) => state.setSetting);

  return (
    <section aria-label="Settings">
      <Card className="space-y-6" padding="lg" variant="elevated">
        <SettingsGroup label="Server">
          <div className="py-3">
            <label className="flex flex-col gap-2">
              <span className="text-subtitle text-text-dim">Host</span>
              <Input
                placeholder="localhost:3210"
                type="text"
                value={serverHost}
                onChange={(event) =>
                  setSetting("serverHost", event.currentTarget.value)
                }
              />
            </label>
          </div>
          <div className="py-3">
            <label className="flex flex-col gap-2">
              <span className="text-subtitle text-text-dim">Token</span>
              <Input
                placeholder="Enter server token"
                type="password"
                value={serverToken}
                onChange={(event) =>
                  setSetting("serverToken", event.currentTarget.value)
                }
              />
            </label>
          </div>
        </SettingsGroup>

        <SettingsGroup label="Speech-to-text">
          <div className="py-3">
            <label className="flex flex-col gap-2">
              <span className="text-subtitle text-text-dim">
                Soniox API key
              </span>
              <Input
                placeholder="Enter Soniox API key"
                type="password"
                value={apiKey}
                onChange={(event) =>
                  setSetting("apiKey", event.currentTarget.value)
                }
              />
            </label>
          </div>
        </SettingsGroup>

        <p className="text-subtitle text-text-dim">
          Settings are auto-saved. Changes apply on next initialization.
        </p>
      </Card>
    </section>
  );
}
