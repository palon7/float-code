import type { EvenAppBridge } from "@evenrealities/even_hub_sdk";
import { G2MicrophoneSource } from "../g2/microphone";
import { SonioxClient } from "../soniox/soniox-client";
import type { VoiceInputSession, VoiceInputService } from "./service-types";

let sessionCounter = 0;

export function createVoiceInputService(
  bridge: EvenAppBridge,
  onDebugLog?: (message: string) => void,
): VoiceInputService {
  let activeSessionId: string | null = null;

  return {
    async start(args) {
      if (activeSessionId) {
        throw new Error("Cannot start a new session while another is active");
      }

      const sessionId = `voice-${++sessionCounter}`;
      activeSessionId = sessionId;

      const mic = new G2MicrophoneSource(bridge);
      mic.onDebugLog = onDebugLog ?? null;
      const soniox = new SonioxClient();
      let finalText = "";
      let stopped = false;
      let timeoutTimer: ReturnType<typeof setTimeout> | null = null;

      console.log(`[VoiceInputService] context: ${args.context}`);

      const cleanup = () => {
        if (stopped) return;
        stopped = true;
        activeSessionId = null;
        if (timeoutTimer) {
          clearTimeout(timeoutTimer);
          timeoutTimer = null;
        }
        mic.stop();
        soniox.disconnect();
      };

      soniox.onTranscript = (final, interim) => {
        if (stopped) return;
        finalText = final;
        args.onEvent({
          type: "transcript",
          sessionId,
          finalText: final,
          interimText: interim,
        });
      };

      soniox.onEndpoint = () => {
        if (stopped) return;
        cleanup();
        args.onEvent({ type: "endpoint", sessionId, finalText });
        args.onEvent({ type: "stopped", sessionId, reason: "completed" });
      };

      soniox.onError = (err) => {
        if (stopped) return;
        cleanup();
        args.onEvent({ type: "error", sessionId, message: err });
        args.onEvent({ type: "stopped", sessionId, reason: "error" });
      };

      // マイク起動
      await mic.start();

      // Soniox 接続
      try {
        const context = {
          general: [
            { key: "domain", value: "Software development" },
            {
              key: "topic",
              value: "Prompt input for AI coding agent",
            },
          ],
          terms: [
            "レビュー",
            "コミット",
            "プルリク",
            "マージ",
            "キャッシュ",
            "プルリクエスト",
            "スレッド",
            "ブランチ",
            "マスタ",
            "リポジトリ",
            "デプロイ",
            "フェッチ",
            "フック",
            "プル",
            "キュー",
            "API",
            "Codex",
            "Claude Code",
            "GitHub",
          ],
          ...(args.context ? { text: args.context } : {}),
        };

        await soniox.connect({
          apiKey: args.apiKey,
          maxEndpointDelayMs: 2000,
          languageHints: ["ja"],
          context,
        });
      } catch (e) {
        mic.stop();
        activeSessionId = null;
        throw e;
      }

      // 音声データ転送
      mic.onAudioData = (pcm) => soniox.sendAudio(pcm);

      // タイムアウト
      if (args.maxSessionMs) {
        timeoutTimer = setTimeout(() => {
          if (stopped) return;
          cleanup();
          args.onEvent({ type: "stopped", sessionId, reason: "timeout" });
        }, args.maxSessionMs);
      }

      return {
        sessionId,
        async stop(reason = "completed") {
          if (stopped) return;
          cleanup();
          args.onEvent({ type: "stopped", sessionId, reason });
        },
      } satisfies VoiceInputSession;
    },
  };
}
