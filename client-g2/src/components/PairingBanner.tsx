import { Card } from "even-toolkit/web";
import { useAppStore } from "../app/app-store";

export function PairingBanner() {
  const wsStatus = useAppStore((s) => s.wsStatus);
  const wsClient = useAppStore((s) => s.wsClient);
  if (wsStatus.state !== "pairing") return null;

  const handleRetry = () => {
    if (!wsClient) return;
    wsClient.disconnect();
    wsClient.connect();
  };

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
            onClick={handleRetry}
            className="mt-2 rounded-[6px] bg-accent px-4 py-1.5 text-[13px] text-text-highlight transition-colors"
          >
            Retry
          </button>
        </div>
      </Card>
    </div>
  );
}
