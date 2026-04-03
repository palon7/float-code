import { Card } from "even-toolkit/web";
import { useAppStore } from "../app/app-store";

export function LogTab() {
  const debugLogs = useAppStore((state) => state.debugLogs);

  return (
    <section aria-label="Event Log">
      <Card className="overflow-hidden" padding="default" variant="elevated">
        <pre className="overflow-auto rounded-[6px] bg-[#181818] px-4 py-3 font-mono text-[11px] leading-[1.5] text-[#8ef08e]">
          {debugLogs.length > 0
            ? debugLogs.join("\n")
            : "(waiting for events...)"}
        </pre>
      </Card>
    </section>
  );
}
