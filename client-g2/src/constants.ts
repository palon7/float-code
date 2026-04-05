export const API_KEY_STORAGE_KEY = "soniox_api_key";
export const SERVER_HOST_STORAGE_KEY = "server_host";
export const SERVER_TOKEN_STORAGE_KEY = "server_token";
export const SIMPLE_MODE_STORAGE_KEY = "simple_mode";

/** rebuildPageContainer / textContainerUpgrade 共通のバイト数上限（安全マージン込み） */
export const MAX_CONTENT_BYTES = 400;

/** メイン画面ログエリアの表示行数上限（実機実測値） */
export const MAX_LOG_ROWS = 9;

/** host:port から HTTP / WS の URL を派生する */
export function deriveUrls(host: string): {
  httpUrl: string;
  wsUrl: string;
} {
  return {
    httpUrl: `http://${host}`,
    wsUrl: `ws://${host}/ws`,
  };
}
