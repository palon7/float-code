# 認証テストカバレッジレポート

このレポートは、現在の認証関連テストを State x Message の表で整理したものです。

凡例:

- `○`: 現在のテストでカバーできている
- `△`: 一部はカバーしているが、重要な分岐や検証が不足している
- `×`: 現在のテストでカバーできていない

確認対象:

- [`server/src/ws/gateway.test.ts`](/Users/palon/work/cc-client-test/server/src/ws/gateway.test.ts)
- [`server/src/ws/gateway.integration.test.ts`](/Users/palon/work/cc-client-test/server/src/ws/gateway.integration.test.ts)
- [`server/src/api/workspaces.integration.test.ts`](/Users/palon/work/cc-client-test/server/src/api/workspaces.integration.test.ts)
- [`server/src/auth/shared-token.test.ts`](/Users/palon/work/cc-client-test/server/src/auth/shared-token.test.ts)
- [`server/src/local-server.test.ts`](/Users/palon/work/cc-client-test/server/src/local-server.test.ts)

## 1. WebSocket 認証マトリクス

State の行は [`WsAuthenticator`](/Users/palon/work/cc-client-test/server/src/ws/ws-authenticator.ts) の状態遷移に対応し、Message の列は [`WsGateway`](/Users/palon/work/cc-client-test/server/src/ws/gateway.ts) に渡される入力をベースにしています。

| State \ Message | `auth` 正常 承認済み鍵 | `auth` 形式不正 | `auth` トークン不正 | `auth` 未承認鍵 | `auth.response` 正常 | `auth.response` 形式不正 | `auth.response` 署名不正 | 非認証メッセージ | 不正 JSON | タイムアウト |
|---|---|---|---|---|---|---|---|---|---|---|
| `awaiting_auth` | ○ | ○ | ○ | ○ | ○ | × | × | ○ | ○ | ○ |
| `awaiting_response` | × | △ | × | × | ○ | × | ○ | △ | × | ○ |
| `authenticated` | ○ | × | × | × | × | × | × | ○ | × | × |
| `closed/disconnected` | × | × | × | × | × | × | × | △ | × | × |

### 注記

- `awaiting_auth` + `auth` 正常 承認済み鍵 は、challenge 発行と認証成功フローで確認できています。
- `awaiting_auth` + `auth` トークン不正 は、`AUTH_TOKEN_INVALID` + close(4403) を確認しています。
- `awaiting_auth` + `auth` 未承認鍵 は、pairing 登録 + `KEY_NOT_APPROVED` + close(4409) を確認しています。
- `awaiting_auth` + `auth.response` 正常 は、challenge 未発行で `auth.response` を送っても認証されないことを確認しています。
- `awaiting_auth` + 不正 JSON は、クラッシュせず無視されることを確認しています。
- `awaiting_response` + `auth.response` 署名不正 は、`SIGNATURE_INVALID` + close(4403) を確認しています。
- `awaiting_response` + タイムアウト は、challenge 発行後のタイマー継続 + `AUTH_TIMEOUT` + close(4401) を確認しています。
- `awaiting_response` + challenge 発行後 revoke は、`KEY_NOT_APPROVED` + close(4409) を確認しています（`isApproved` の2回目チェック）。
- `authenticated` + `auth` 正常 承認済み鍵 は、再送しても無視されることを確認しています。
- `authenticated` + 非認証メッセージ は、`session.open`、`session.send`、`ping` の通常系のみ確認できています。
- `closed/disconnected` + 非認証メッセージ は、`handleClose()` 後の `session.open` だけが確認対象です。

## 2. REST API 認証マトリクス

State の行は、[`bearerAuth`](/Users/palon/work/cc-client-test/server/src/api/auth-middleware.ts) に入る Authorization ヘッダの状態を表しています。

| State \ Message | `GET /api/workspaces/recent` | `GET /api/workspaces/browse` |
|---|---|---|
| `Authorization` ヘッダなし | ○ | × |
| bearer token 不正 | ○ | × |
| bearer token 正常 | ○ | ○ |

### 注記

- 現在のカバレッジは workspace 系エンドポイント経由に限られています。
- middleware 自体は共通ですが、保護対象の全エンドポイントで同様に効いていることまでは現状証明できていません。

## 3. Local Management Server マトリクス

State の行は、[`createLocalServer`](/Users/palon/work/cc-client-test/server/src/local-server.ts) に対する local 管理 API の認証状態とリクエスト妥当性を表しています。

| State \ Message | `GET /pairing/pending` | `POST /pairing/approve` 正常 code | `POST /pairing/approve` code 欠如 | `POST /pairing/approve` 不明または期限切れ code | `DELETE /pairing/revoke` 正常 code | `DELETE /pairing/revoke` code 欠如 | `DELETE /pairing/revoke` 不明 code | `GET /pairing/approved` |
|---|---|---|---|---|---|---|---|---|
| `Authorization` ヘッダなし | ○ | × | × | × | × | × | × | × |
| `localAuthToken` 不正 | ○ | × | × | × | × | × | × | × |
| `localAuthToken` 正常 | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ |

### 注記

- 認証ミドルウェアは全ルート共通 (`app.use("*")`) のため、`GET /pairing/pending` での認証テストが全エンドポイントの認証をカバーしています。
- `localAuthToken` 正常の行は全エンドポイントの正常系・異常系をカバーしています。

## 4. `△` のケース

### WebSocket `awaiting_response` + `auth` 形式不正: `△`

- 理由: 認証前の不正ペイロード自体はテストされていますが、`awaiting_auth` 状態でしか通していません。
- リスク: `awaiting_auth` と `awaiting_response` の扱いが将来ずれた場合に検知できません。
- 優先度: 低（`isPending()` は両状態を同じ分岐で処理するため）

### WebSocket `awaiting_response` + 非認証メッセージ: `△`

- 理由: 認証前に `session.send` を送るケースはありますが、challenge 発行後の待機状態では試していません。
- リスク: challenge 発行後だけ誤って別メッセージを通してしまう回帰を見逃します。
- 優先度: 低（`isPending()` は両状態を同じ分岐で処理するため）

### WebSocket `closed/disconnected` + 非認証メッセージ: `△`

- 理由: `handleClose()` 後に `session.open` だけは確認しています。
- リスク: 一定の安心感はありますが、他メッセージも同様に無視されることまでは保証していません。
- 優先度: 低

## 5. `×` のケース

### WebSocket `awaiting_auth` + `auth.response` 形式不正

- 期待動作: gateway の guard 層で不正な auth payload として拒否する。
- 現状の不足: `signature` の長さや形式が不正なケースが未テストです。
- 優先度: 低（`isAuthResponseMessage()` の guard は `auth.response` 正常ケースの裏返しで間接的に検証されている）

### WebSocket `awaiting_response` + `auth.response` 形式不正

- 期待動作: gateway の guard 層で不正な auth payload として拒否する。
- 現状の不足: `signature` の長さや形式が不正なケースが未テストです。
- 優先度: 低（同上）

### WebSocket `authenticated` + `auth.response`

- 期待動作: 認証済みフェーズでは無視する。
- 現状の不足: 認証成功後に重複して `auth.response` を送る退行テストがありません。
- 優先度: 低（`auth` 再送の無視テストで同じ分岐がカバーされている）

### REST API 認証の他エンドポイント

- 期待動作: middleware 配下の全ルートで missing / invalid bearer token が拒否される。
- 現状の不足: 主に workspace 系にカバレッジが集中しています。
- 優先度: 低（middleware は共通で、workspace テストで検証済み）

### その他の `×` セル

残りの `×` セルは、既にカバー済みの分岐と同じコードパスを通るケース、または実際にその状態遷移に到達する現実的なシナリオがないケースです。追加してもコードカバレッジは向上しますが、回帰検知への貢献は限定的です。
