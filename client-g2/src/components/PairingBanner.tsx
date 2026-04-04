import { Card } from "even-toolkit/web";
import { useAppStore } from "../app/app-store";
import { useRuntimeActions } from "../app/runtime-actions-context";

export function PairingBanner() {
  const wsStatus = useAppStore((s) => s.wsStatus);
  const { requestConnect } = useRuntimeActions();
  if (wsStatus.state !== "pairing") return null;

  return (
    <div className="fixed bottom-4 left-1/2 z-50 w-full max-w-[640px] -translate-x-1/2 px-3">
      <Card padding="default" variant="elevated">
        <div className="text-center">
          <p className="text-[11px] text-text-dim">Pairing Code</p>
          <p className="font-mono text-[20px] font-bold tracking-widest text-text">
            {wsStatus.code}
          </p>
          <p className="mt-1 text-[11px] text-text-dim">
            Approve on server to connect
          </p>
          <button
            type="button"
            onClick={requestConnect}
            className="mt-2 rounded-[6px] bg-accent px-4 py-1.5 text-[13px] text-text-highlight transition-colors"
          >
            Retry
          </button>
        </div>
      </Card>
    </div>
  );
}
