# UI / UX

> 見出しのみの空テンプレートだった状態から、Web/iOS/Android 3クライアントの
> 実装（`ptt-client`・`ptt-ios`・`ptt-android`）と`ptt-design-system.md`を
> もとに実際の画面構成・挙動を書き起こしたもの（`brushup-plan.md` 6章
> 次アクション item 2 対応）。トークン表（色・タイポグラフィ・コンポーネント
> 仕様の数値）は`ptt-design-system.md`が正であり、ここでは重複させず参照する。

## Design Principles

- Simple
- Fast
- Low Cognitive Load

上記3原則は、`ptt-design-system.md`冒頭にある「ログ・ID・招待コード・トークン」
の可読性を優先するモノスペース基調の「運用ツール的UI」という方向性として
具体化されている。装飾より情報密度・操作の即応性を優先し、ライトモードや
アニメーションの作り込みは意図的に後回しにしている（後述）。

---

## Navigation

3クライアントとも同一の画面遷移をたどる。

1. **オンボーディング**：初回起動時のみ。アプリの目的（Room First・
   Temporary Relationships）を簡潔に説明する導入画面
2. **サインイン**：Memberはメールアドレス+パスワード(Firebase Auth)、
   Guestは「ゲストとして参加」ボタンで匿名認証。どちらもRoom未選択の状態
3. **Room選択**：「ルームを作成」（Guestは非表示。判定は`members/{uid}.role`
   ではなくFirebase Authの`isAnonymous`を見る、`phase12-role-operation-inventory.md`
   2章参照）／「招待コードで参加」の2択
4. **Room View**：参加後のメイン画面。Voice UI・Chat UI・参加者一覧・
   通報/BAN/録音操作を1画面に集約する構成（後述）

`admin-dashboard`は上記とは別アプリで、ナビゲーションの出し分けが異なる。
`GET /admin/me`が返す`permissions`配列を見て、1つも権限を持たないユーザーには
`NavTabs`自体を出さない（以前は`auth.currentUser`の有無だけで判定しており、
任意のGoogleアカウントでサインインするだけで管理メニューの構成が見えてしまって
いた。詳細はAPI.mdの`GET /admin/me`の節を参照）。事前のメニュー非表示以外の
権限チェックは行わず、各画面はAPIを呼んで403が返ったらエラー表示するのみ
（`phase12-role-operation-inventory.md` 3章「気づいた点」参照）。

---

## Room

Room Viewは以下の要素で構成される。

- **参加者一覧（チップ）**：`ptt-design-system.md` 4.4のチップ仕様に従う。
  送話中(unmuted)の参加者のみ`live`色の境界線になる
- **Guestバッジ**：自分自身がGuestの場合のみ表示（`role==='guest'`判定）。
  他参加者のGuest判定手段は現状無く、一覧上での表示対象外
  （`phase12-role-operation-inventory.md` 2章、`brushup-plan.md` 5.4参照）
- **BAN操作**：`owner`/`moderator`のみ表示（`myRole==='owner'||'moderator'`）。
  実行確認ダイアログは`ptt-design-system.md` 4.1のDangerバリアントを使用
- **通報ボタン**：全role表示。`POST /reports`を呼ぶのみの薄い操作で、
  対応（内容確認・BAN実行）はモデレーターがFirestoreの`reports`コレクション
  を見て手動で行う運用
- **録音バー**：録音中は`danger`色バッジで全参加者へ常時開示（同意表示の
  考え方）。開始/停止操作自体は`owner`/`moderator`のみ。Web版のみ
  「自動録音: ON」トグルを追加で持つ（iOS/Androidはスコープ外、
  `brushup-plan.md` 2-E参照）
- **招待コード表示**：Room作成直後のみ、破線ボーダーの専用Box
  （`ptt-design-system.md` 4.7）で表示。以降はRoom作成者側の画面からも
  再確認する手段が無く、必要な場合はadmin-dashboard経由で`rooms:manage`
  権限保有者が`GET /admin/rooms/:roomId/invite-code`から確認する
  （API.md参照）
- **ニックネーム変更**：全role・本人のみ。変更は即時反映されるが、
  監査ログ・録音の話者記録は内部UID基準のため変更履歴自体は追わない

---

## Voice UI

コアとなるPTTボタンの仕様は`ptt-design-system.md` 4.3に準拠する
（円形140–160px、送話中は境界線`accent`+グロー、他者が送話ロックを
保持している間はdisabledにしてラベルを「{名前}が送話中」に差し替え）。

- ステータスドット（`ptt-design-system.md` 4.2）で接続状態を常時表示
  （未接続=`muted`／接続中=`live`／エラー=`danger`）。Android版のみ
  再接続中に`warning`色を使用しており、Web版CSSには`--warning`が未定義
  という差分が残っている（同ドキュメント「運用ルール」参照。今後の
  アクション項目としても記録済み）
- 送話ロックの獲得・解放はサーバー側で強制されるため（`talk:control`は
  role不問、`phase12-role-operation-inventory.md` 1章）、UI側のボタン状態は
  あくまで表示であり、権限の実体はサーバーが持つ
- 音声の送受信・再生自体はLiveKit（WebRTC/NetEQ）に委譲しており、UI側は
  ジッターバッファ等の実装を持たない（`ARCHITECTURE.md`参照）

---

## Chat UI

- メッセージ一覧：自分の発言のみ`live`色、それ以外は`text`色
  （`ptt-design-system.md` 4.9）。送信ボタンは空文字時disabled
- 添付ファイル（画像/動画/PDF）：Web版のみ対応。GCSへの短期署名付きURLで
  直接アップロードし、その後通常のメッセージ作成APIを呼ぶ2段階の設計
  （`ARCHITECTURE.md`「クライアント」節参照）。iOS/Androidはテキスト送信
  のみでUIを持たない
- BANされたメンバーは`firestore.rules`側で`messages`の読み取り権限も
  即座に失うため、チャット履歴もボイスのBAN即時キックと同じ強制力を持つ
  （履歴が見えなくなる、というUI上の副作用として現れる）

---

## Accessibility

具体的な数値基準（コントラスト比・タップ領域サイズ）は
`ptt-design-system.md` 5章「アクセシビリティ・実装上の注意」を正とする。
要点のみ再掲する。

- `text`色は`bg`背景に対しAA基準を満たすが、`muted`色は本文には使わず
  ラベル・補助情報のみに限定する方針
- PTTボタンはモバイルで最低140px角のタップ領域を確保済み。チップ内の
  BAN/通報リンクは10px文字で領域が狭く、誤タップ率の実機計測は未実施
  （未実装の改善項目として同ドキュメントに記録済み）
- ライトモード切替は3プラットフォームとも未実装

---

## Design System

配色・タイポグラフィ・スペーシング・コンポーネント仕様（ボタン・
ステータスドット・PTTボタン・チップ・バッジ・入力フィールド・招待コード
Box・ログパネル・チャットリスト）は、すべて`ptt-design-system.md`に
トークン化して定義済みのため、そちらを参照する。Web版は`shared/design-tokens.css`
でCSS変数として一元管理し、iOS/Androidは現状それぞれ独立したハードコード値
（例: iOS `Color(red: 0.24, green: 0.86, blue: 0.52)`、Android
`Color(0xFF3DDC84)`）を持っており、トークン名での一元管理へのリファクタリング
は`ptt-design-system.md` 6章の未着手アクション項目として残っている。

---

## Animation

装飾的なアニメーションは意図的に最小限にとどめている（Design Principlesの
「Simple」「Low Cognitive Load」を反映）。

- PTTボタン送話中: `scale(0.97)` + `box-shadow: 0 0 24px -4px accent`の
  グロー（`ptt-design-system.md` 4.3）
- ライブ状態の強調全般: ドロップシャドウではなく`1px solid var(--line)`の
  境界線を基本とし、「ライブ状態のグロー」のみ例外的に`box-shadow`を使う
  （同ドキュメント3章「スペーシング・角丸・境界線」参照）
- 画面遷移・要素の出現に対する専用トランジションは3クライアントとも
  現状定義していない

---

## Color Palette

`ptt-design-system.md` 1章のカラートークン表（`bg`/`panel`/`line`/`text`/
`muted`/`accent`/`accent-dim`/`live`/`warning`/`danger`）を正とする。
`warning`(`#f3b833`)はAndroid版でのみ暗黙的に使われWeb版CSSに未定義という
既知の差分があり、次回Web側改修時に揃える方針が同ドキュメントに記録されて
いる。
