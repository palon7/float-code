# Even Realities UIUX Design Guidelines 2025

## 1. Typography Template - APP / Companion App

### Common Rule - English

#### Very Large Title

- Font: FK 24 Regular
- Font style: normal
- Font weight: 400
- Line height / font height: normal
- Letter spacing: -0.72px

#### Large Title

- Font: FK 20 Regular
- Font style: normal
- Font weight: 400
- Line height / font height: normal
- Letter spacing: -0.6px

#### Medium Title

- Font: FK 17 Regular
- Font style: normal
- Font weight: 400
- Line height: normal
- Letter spacing: -0.17px

#### Medium Body

- Font: FK 17 Light
- Font style: normal
- Font weight: 300
- Line height: normal
- Letter spacing: -0.17px

#### Normal Title

- Font: FK 15 Regular
- Font style: normal
- Font weight: 400
- Line height: normal
- Letter spacing: -0.15px

#### Normal Body

- Font: FK 15 Light
- Font style: normal
- Font weight: 300
- Line height: normal
- Letter spacing: -0.15px

#### Normal Subtitle

- Font: FK 13 Regular
- Font style: normal
- Font weight: 400
- Line height: normal
- Letter spacing: -0.13px

#### Normal Detail

- Font: FK 11 Regular
- Font style: normal
- Font weight: 400
- Line height / font height: normal
- Letter spacing: -0.11px

---

## 2. Color Palette - APP

### TC (Text Color)

| Name           | Hex     | Usage                                                   |
| -------------- | ------- | ------------------------------------------------------- |
| TC - Highlight | #FFFFFF | 黒背景の brightness mode で重要情報を強調するために使用 |
| TC - 1st       | #232323 | 主な本文テキストに使用                                  |
| TC - 2nd       | #7B7B7B | 二次情報に使用                                          |
| TC - Accent    | #232323 | Accent text color                                       |
| TC - Red       | #FF453A | 警告メッセージに使用                                    |
| TC - Green     | #4BB956 | デバイス接続状態などに使用                              |

### BC (Background Color)

| Name                       | Hex     | Usage                                                    |
| -------------------------- | ------- | -------------------------------------------------------- |
| BC - Highlight             | #232323 | 強調が必要なボタンの塗りに使用                           |
| BC - 1st                   | #FFFFFF | 標準ボタンの背景色に使用                                 |
| BC - 2nd                   | #F6F6F6 | BC - 3rd の上に置く補助色として使用                      |
| BC - 3rd (Main Background) | #EEEEEE | ページ全体の背景色に使用                                 |
| BC - 4th                   | #E4E4E4 | BC - 3rd 上で、より深いレイヤーが必要な要素に使用        |
| BC - Accent                | #FEF991 | 進行中アクションの表示や、警告系トーストメッセージに使用 |

### SC (Shaded Color)

| Name     | Value | Hex     | Usage                                  |
| -------- | ----: | ------- | -------------------------------------- |
| SC - 1st |   50% | #000000 | ポップアップ表示時のオーバーレイに使用 |
| SC - 2nd |    8% | #232323 | テキスト入力欄の背景色として主に使用   |

### Text Color Usage Notes

- **TC - Highlight (`#FFFFFF`)**
  - 黒背景上で重要情報を目立たせるために使用
- **TC - 1st (`#232323`)**
  - 主要な本文テキストに使用
- **TC - 2nd (`#7B7B7B`)**
  - 補助的・二次的な情報に使用
- **TC - Red**
  - 警告表示に使用
- **TC - Green**
  - 接続済みなどのステータス表示に使用

### Background Color Usage Notes

- **BC - Highlight (`#232323`)**
  - 強調ボタンの背景
- **BC - 1st (`#FFFFFF`)**
  - 標準ボタン背景
- **BC - 2nd (`#F6F6F6`)**
  - BC - 3rd 上の補助背景
- **BC - 3rd (`#EEEEEE`)**
  - ページのメイン背景
- **BC - 4th (`#E4E4E4`)**
  - BC - 3rd 上でさらに一段深い背景
- **BC - Accent (`#FEF991`)**
  - 実行中アクションや注意喚起トースト

### Shaded Color Usage Notes

- **SC - 1st**
  - ポップアップ出現時のオーバーレイ
- **SC - 2nd**
  - テキスト入力欄の背景

---

## 3. Layout - APP

### Margins

#### Default Margin

- すべての画面で、左右マージンは **12px**
- 内部カード構造内でも同じく **12px**
- Teleprompt 用も **12px**

#### Card Margin

- デフォルト画面では左右マージンは **16px**

---

### Spacing

#### Same-element Spacing

- 同一フレーム内で分割された要素間は **0px / 6px**
- 対象例:
  - segmented lists
  - tags
  - chat bubbles
  - carousels
  - buttons

#### Cross-element Spacing

- 同じ主題のカード同士（タイトルなし）は **12px**
- 異なる主題のカードやセクション同士（タイトル・説明あり）は **24px**

---

### Padding

#### Same-element Padding

- 同一フレーム内で分割された要素間の余白は **0px**
- 対象例:
  - segmented lists
  - tags
  - chat bubbles
  - carousels
  - buttons

#### Content Padding Example

以下のような内側余白指定が示されている:

- 4px
- 12px
- 4px
- 12px
- 12px
- 12px

---

### Border Radius

#### Default Card Radius

- デフォルト半径: **6px**
- ほとんどのブロックの基準となる角丸
- Corner smoothing: **60**

#### Offset Radius

- グラフィックのアウトラインが標準ブロックからオフセットする場合、半径も調整する
- 例:
  - Default Corner Radius: **6px**
  - Offset: **2px**
  - Offset Corner Radius: **4px** (`6px - 2px`)

---

## 4. 実装用サマリー

### Typography

- 24 / 20 / 17 / 15 / 13 / 11 の段階的なサイズ設計
- Title は Regular、Body は Light を基本とする
- すべての文字詰めはマイナス設定

### Color

- 本文主色は `#232323`
- 二次情報は `#7B7B7B`
- メイン背景は `#EEEEEE`
- 強調背景は `#232323`
- 注意喚起アクセントは `#FEF991`
- 警告は Red、接続状態は Green

### Layout

- 基本左右マージンは 12px
- 一部カードレイアウトは 16px
- 同一グループ内は 0px / 6px
- 同主題カード間は 12px
- 異主題セクション間は 24px
- 基本角丸は 6px
