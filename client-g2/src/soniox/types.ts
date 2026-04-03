export interface SonioxToken {
  text: string;
  start_ms?: number;
  end_ms?: number;
  confidence?: number;
  is_final: boolean;
}

export interface SonioxResponse {
  tokens: SonioxToken[];
  final_audio_proc_ms?: number;
  total_audio_proc_ms?: number;
  finished?: boolean;
  error_code?: number;
  error_message?: string;
}

export interface SonioxContext {
  general?: Array<{ key: string; value: string }>;
  terms?: string[];
  text?: string;
}

export interface SonioxConfig {
  apiKey: string;
  languageHints?: string[];
  maxEndpointDelayMs?: number;
  context?: SonioxContext;
}
