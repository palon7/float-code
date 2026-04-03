/** VoiceInputService から runtime へ通知されるイベント */
export type VoiceInputEvent =
  | {
      type: "transcript";
      sessionId: string;
      finalText: string;
      interimText: string;
    }
  | {
      type: "endpoint";
      sessionId: string;
      finalText: string;
    }
  | {
      type: "error";
      sessionId: string;
      message: string;
    }
  | {
      type: "stopped";
      sessionId: string;
      reason: "manual_confirm" | "completed" | "timeout" | "error";
    };

/**
 * 1 回の音声入力セッション。
 * stop() は内部で cleanup を行い、stopped イベント発火後に resolve する。
 * resolve 後は一切のイベントを発火しない。
 */
export interface VoiceInputSession {
  sessionId: string;
  stop(reason?: "manual_confirm" | "completed"): Promise<void>;
}

/**
 * 音声入力の headless service。
 * G2 UI を知らず、callback でイベント通知のみ行う。
 * 旧セッションが動作中に start() を呼ぶとエラーを throw する。
 */
export interface VoiceInputService {
  start(args: {
    apiKey: string;
    maxSessionMs?: number;
    context?: string;
    onEvent: (event: VoiceInputEvent) => void;
  }): Promise<VoiceInputSession>;
}
