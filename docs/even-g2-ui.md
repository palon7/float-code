# Even G2 UI 仕様まとめ

出典: [Unofficial Even G2 API Documentation](https://raw.githubusercontent.com/nickustinov/even-g2-notes/refs/heads/main/docs/README.md)

## キャンバス仕様

- サイズ: 576 × 288 ピクセル
- 座標原点: 左上 (0, 0)
- 色モデル: 4ビットグレースケール（緑16段階）
- ページあたりコンテナ最大: 4個

## コンテナ共通プロパティ

| プロパティ | 型 | 範囲 | 説明 |
|---|---|---|---|
| `containerID` | number | - | ページ内で一意 |
| `containerName` | string | 最大16文字 | ページ内で一意 |
| `xPosition` | number | 0〜576 | 左上からのX座標 |
| `yPosition` | number | 0〜288 | 左上からのY座標 |
| `width` | number | 0〜576 | コンテナの幅 |
| `height` | number | 0〜288 | コンテナの高さ |
| `isEventCapture` | number | 0 or 1 | ページあたり正確に1つ設定必須 |

## コンテナ種別

### Text Container（テキストコンテナ）

テキスト内容を表示する。改行対応・自動折り返しあり。

**追加プロパティ**

| プロパティ | 型 | 範囲 | 説明 |
|---|---|---|---|
| `borderWidth` | number | 0〜5 | ボーダー幅（0=なし） |
| `borderColor` | number | 0〜16 | グレースケール濃度 |
| `paddingLength` | number | 0〜32 | 全方向の統一パディング |

**制約**
- テキスト内容の上限: 1,000〜2,000文字（操作により異なる）
- テキスト配置: 左上揃えのみ（中央・右揃え不可）
- フォントサイズ・フォント種別・装飾（太字・斜体・下線）は変更不可
- `isEventCapture: 1` を設定するとスクロール対応
- 実機では `borderRadius` を使わない（`rebuildPageContainer` / `createStartUpPageContainer` が無視される）
- 実機では座標が重なる複数テキストコンテナは表示が更新されない → レイアウトを分割するか `textContainerUpgrade` で差し替える

**`textContainerUpgrade` での差分更新**

| プロパティ | 説明 |
|---|---|
| `containerID` | 対象コンテナID |
| `containerName` | 対象コンテナ名 |
| `contentOffset` | 更新開始位置 |
| `contentLength` | 更新文字数 |
| `content` | 更新内容 |

### List Container（リストコンテナ）

ネイティブスクロール機能付きのリスト。選択状態はファームウェアが管理する。

**追加プロパティ**

| プロパティ | 型 | 範囲 | 説明 |
|---|---|---|---|
| `itemCount` | number | 1〜20 | アイテム数（`itemName`の長さと一致必須） |
| `itemName` | string[] | 最大64文字/項目 | 各アイテムのラベル |
| `itemWidth` | number | - | アイテム幅（0=自動計算） |
| `isItemSelectBorderEn` | boolean | - | 選択ハイライト表示のON/OFF |
| `borderWidth` | number | 0〜5 | ボーダー幅 |
| `borderColor` | number | 0〜15 | グレースケール濃度 |
| `paddingLength` | number | 0〜32 | 全方向の統一パディング |

**イベント (`listEvent`)**

| フィールド | 説明 |
|---|---|
| `currentSelectItemIndex` | 選択中インデックス（index 0 は `undefined` になるので `?? 0` で受ける） |
| `currentSelectItemName` | 選択中アイテム名 |
| `SCROLL_TOP_EVENT` | リスト上端到達 |
| `SCROLL_BOTTOM_EVENT` | リスト下端到達（ページング実装のトリガーに使える） |

**制約**
- アイテムの高さは `containerHeight / itemCount` で自動計算（カスタム不可）
- アイテムの変更は `rebuildPageContainer` での全体再構築が必須

### Image Container（画像コンテナ）

4ビットグレースケール画像を表示する。

**寸法制限**

| 項目 | 範囲 |
|---|---|
| 幅 | 20〜200px |
| 高さ | 20〜100px |

**対応データ形式**

- `number[]`（推奨）
- Base64文字列
- `Uint8Array`
- `ArrayBuffer`

**制約・注意**
- `createStartUpPageContainer` 時は画像データを送れない → 空のプレースホルダーで作成後、`updateImageRawData` で送信する2段階プロセスが必須
- 画像データがコンテナサイズより小さい場合、ファームウェアが自動タイリング（繰り返し表示）する
- イベントを取得できない → イベントが必要な場合、背後にテキストコンテナを置いてそちらで取得する
- 全色が4ビットグレースケール（緑16段階）に自動変換される

## スタイルに関する制約一覧

| 機能 | 状態 |
|---|---|
| 背景色の指定 | 不可 |
| フォントサイズ変更 | 不可（固定） |
| フォント選択 | 不可（LVGL内蔵1種類のみ） |
| テキスト装飾（太字・斜体・下線） | 不可 |
| テキスト配置 | 左上揃えのみ |
| Z-index コントロール | 不可（宣言順序で前後が決まる） |
| `borderRadius` | 実機では使用禁止 |

## 対応文字

- ASCII・ラテン文字（U+0020〜U+00FF、一部ダイアクリティカル除く）
- ボックス描画: `━` `─`
- 矢印: `↑` `↓` `←` `→`
- ブロック: `█` `▇` `▆` `▅` `▄` `▃` `▂` `▁`
- 幾何学的形状: `●` `○` `■` `□` `▲` `△`

## 実装パターン

### プログレスバー・視覚的表現

ブロック文字を使ってフォントサイズや色の制限を回避できる。

```
進捗: ████████░░░░  67%
状態: ●  接続中
選択: ▶ Option A
```

### 疑似リスト（ネイティブ List の制限回避）

テキストコンテナを複数並べて各行を表現する。`borderWidth` の切り替えで選択状態を表現でき、特定コンテナだけ更新できるため `rebuildPageContainer` を避けられる。

```
Container1: "  Item A"  borderWidth=0 (未選択)
Container2: "> Item B"  borderWidth=1 (選択中)
Container3: "  Item C"  borderWidth=0
```

### ページング（長テキスト対応）

`SCROLL_BOTTOM_EVENT` を検知して `rebuildPageContainer` で次ページを構築する。テキストコンテナの1,000文字上限を実質的に拡張できる。

### 画像ベースUIのイベント取得

画像コンテナはイベントを取得できないため、`isEventCapture: 1` のテキストコンテナを背後に置いてクリック・スクロールイベントを捕捉する。

```
ID1: テキストコンテナ（フルスクリーン、content: ' '、isEventCapture: 1）
ID2: 画像コンテナ（前面）
```
