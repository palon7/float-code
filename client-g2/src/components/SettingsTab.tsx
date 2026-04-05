import { Card, Input, SettingsGroup } from "even-toolkit/web";
import { useAppStore } from "../app/app-store";

export function SettingsTab() {
  const serverHost = useAppStore((state) => state.serverHost);
  const serverToken = useAppStore((state) => state.serverToken);
  const apiKey = useAppStore((state) => state.apiKey);
  const simpleModeEnabled = useAppStore((state) => state.simpleModeEnabled);
  const showThinking = useAppStore((state) => state.showThinking);
  const showToolUse = useAppStore((state) => state.showToolUse);

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

        <SettingsGroup label="G2 display mode">
          <div className="flex gap-2 py-3">
            {(
              [
                { value: false, label: "Full" },
                { value: true, label: "Simple" },
              ] as const
            ).map(({ value, label }) => (
              <label
                key={label}
                className={`flex-1 cursor-pointer rounded-lg border px-3 py-2 text-center ${
                  simpleModeEnabled === value
                    ? "border-accent bg-accent/10 text-accent"
                    : "border-border text-text-dim"
                }`}
              >
                <input
                  checked={simpleModeEnabled === value}
                  className="sr-only"
                  name="displayMode"
                  type="radio"
                  onChange={() => setSetting("simpleModeEnabled", value)}
                />
                <span className="text-subtitle font-medium">{label}</span>
              </label>
            ))}
          </div>
          <p className="text-subtitle text-text-dim">
            Simple: status + latest AI response only
          </p>
        </SettingsGroup>

        <SettingsGroup label="Display filter">
          {(
            [
              {
                field: "showThinking" as const,
                label: "Show thinking",
                checked: showThinking,
              },
              {
                field: "showToolUse" as const,
                label: "Show tool use",
                checked: showToolUse,
              },
            ] as const
          ).map(({ field, label, checked }) => (
            <label key={field} className="flex items-center gap-3 py-2">
              <input
                checked={checked}
                className="h-4 w-4 accent-accent"
                type="checkbox"
                onChange={() => setSetting(field, !checked)}
              />
              <span className="text-subtitle">{label}</span>
            </label>
          ))}
        </SettingsGroup>
      </Card>
    </section>
  );
}
