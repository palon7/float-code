import type { EvenAppBridge } from "@evenrealities/even_hub_sdk";

// 100ms分のPCMデータをバッファリングしてから送信 (16kHz * 2bytes * 0.1s = 3200 bytes)
// フレームサイズが40bytesと小さいため、まとめて送る
const BUFFER_SIZE = 3200;

export class G2MicrophoneSource {
  onAudioData: ((pcm: Uint8Array) => void) | null = null;
  onDebugLog: ((message: string) => void) | null = null;
  private unsubscribe: (() => void) | null = null;
  private buffer: Uint8Array = new Uint8Array(BUFFER_SIZE);
  private bufferOffset = 0;
  private lastFrameSize = -1;

  constructor(private bridge: EvenAppBridge) {}

  async start(): Promise<void> {
    this.bufferOffset = 0;
    this.lastFrameSize = -1;

    this.unsubscribe = this.bridge.onEvenHubEvent((event) => {
      if (event.audioEvent?.audioPcm && this.onAudioData) {
        const pcm = event.audioEvent.audioPcm;
        if (pcm.length !== this.lastFrameSize) {
          this.onDebugLog?.(`mic frame: ${pcm.length} bytes`);
          this.lastFrameSize = pcm.length;
        }
        let srcOffset = 0;

        while (srcOffset < pcm.length) {
          const remaining = BUFFER_SIZE - this.bufferOffset;
          const toCopy = Math.min(remaining, pcm.length - srcOffset);
          this.buffer.set(
            pcm.subarray(srcOffset, srcOffset + toCopy),
            this.bufferOffset,
          );
          this.bufferOffset += toCopy;
          srcOffset += toCopy;

          if (this.bufferOffset >= BUFFER_SIZE) {
            this.onAudioData(new Uint8Array(this.buffer));
            this.bufferOffset = 0;
          }
        }
      }
    });
    await this.bridge.audioControl(true);
  }

  stop(): void {
    // 残りのバッファをフラッシュ
    if (this.bufferOffset > 0 && this.onAudioData) {
      this.onAudioData(
        new Uint8Array(this.buffer.buffer, 0, this.bufferOffset),
      );
    }
    this.bufferOffset = 0;

    this.bridge.audioControl(false);
    this.unsubscribe?.();
    this.unsubscribe = null;
  }
}
