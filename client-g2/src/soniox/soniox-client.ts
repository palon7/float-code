import type { SonioxConfig, SonioxResponse } from "./types";

const SONIOX_WS_URL = "wss://stt-rt.soniox.com/transcribe-websocket";

export class SonioxClient {
  private ws: WebSocket | null = null;
  onTranscript: ((finalText: string, interimText: string) => void) | null =
    null;
  onEndpoint: (() => void) | null = null;
  onError: ((error: string) => void) | null = null;

  private finalText = "";

  connect(config: SonioxConfig): Promise<void> {
    return new Promise((resolve, reject) => {
      this.finalText = "";
      this.ws = new WebSocket(SONIOX_WS_URL);

      this.ws.onopen = () => {
        this.ws!.send(
          JSON.stringify({
            api_key: config.apiKey,
            model: "stt-rt-v4",
            audio_format: "pcm_s16le",
            sample_rate: 16000,
            num_channels: 1,
            language_hints: config.languageHints ?? ["ja", "en"],
            enable_endpoint_detection: true,
            max_endpoint_delay_ms: config.maxEndpointDelayMs ?? 2000,
            ...(config.context ? { context: config.context } : {}),
          }),
        );
        resolve();
      };

      this.ws.onmessage = (msg) => {
        const res: SonioxResponse = JSON.parse(msg.data as string);

        if (res.error_code) {
          this.onError?.(
            `Soniox error ${res.error_code}: ${res.error_message}`,
          );
          return;
        }

        if (res.finished) return;

        let interimText = "";
        let endpointDetected = false;
        for (const token of res.tokens ?? []) {
          if (token.text === "<end>") {
            endpointDetected = true;
            continue;
          }
          if (token.is_final) {
            this.finalText += token.text;
          } else {
            interimText += token.text;
          }
        }

        this.onTranscript?.(this.finalText, interimText);
        if (endpointDetected) this.onEndpoint?.();
      };

      this.ws.onerror = () => {
        reject(new Error("WebSocket connection failed"));
      };

      this.ws.onclose = () => {
        this.ws = null;
      };
    });
  }

  sendAudio(pcm: Uint8Array): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(pcm.slice().buffer);
    }
  }

  disconnect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send("");
    }
    this.ws?.close();
    this.ws = null;
  }
}
