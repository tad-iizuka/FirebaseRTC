# PTTアプリ ブラッシュアップ計画

対象リポジトリ: `tad-iizuka/FirebaseRTC`
作成日: 2026-07-09 / 直近の全面整理: 2026-08-11

> **この文書の運用方針（2026-08-11 整理）**
>
> 本ドキュメントは初回作成から七十一訂まで、改定のたびに検証経緯を本文
> 冒頭へ逐語で積み増す運用をしてきた結果、4,400行を超えて肥大化した。
> 実装がPhase16まで進み、README.mdのビジョンに基づく主要な土台整備
> （Guestロール・組織階層・role整理・バッジ・PWA化等）がおおむね完了した
> ことも踏まえ、以下の方針で整理した。
>
> - **改定ごとの詳細な経緯（初訂〜七十一訂の全文）と、完了済み次アクション
>   の一覧（旧「6.1」節）は `brushup-plan-history.md` へ退避した。** 過去の
>   判断根拠や検証の確度（`git show`による直接検証か、ユーザー申告のみか、
>   等）を確認したい場合はそちらを参照する。
> - **Phase単位の実装内容そのもの**は `CHANGELOG.md`、**個々の設計判断**は
>   `DECISIONS.md` に、今後はそちらを一次情報として更新していく。
> - 本ドキュメントは今後、「現在のビジョンとの差分」「現在有効な優先順位付き
>   ロードマップ」「現在有効な次アクション」だけを常に最新の状態で保つ、
>   短い文書として運用する。**改定のたびに経緯を全文追記する運用はやめ、**
>   変更点はCHANGELOG.md/DECISIONS.mdへの追記と、本ドキュメント該当箇所の
>   上書きに切り替える。
> - `API.md`・`DATA_MODEL.md`・`UI_UX.md`・`SECURITY.md`・`AI.md`・
>   `ARCHITECTURE.md`・`REQUIREMENTS.md`・`ROADMAP.md`・`TESTING.md`は、
>   いずれも本ドキュメントの各版から実コードを根拠に書き起こした専門文書。
>   実装の詳細（APIエンドポイント一覧、Firestoreスキーマ、画面仕様、
>   セキュリティ設計等）はそれぞれの専門文書を正とし、本ドキュメントでは
>   重複させず参照するに留める。

---

## 0. README.mdが定義するビジョンの要点（前提の再確認）

| 項目 | README.mdの定義 |
|---|---|
| ミッション | 「人ではなく場（Room）につながる」。Friend中心ではなくRoom中心 |
| Core Principles | ① Room First ② Temporary Relationships（一時的な関係） ③ Privacy First（電話番号・本名不要） ④ Real-Time First |
| Communication Model | 全てを`Event`として扱う（Voice/Text/Image/File/Location/Reaction/System/AI Message） |
| Participant Model | Human/AI/Botを同じ`Participant`概念として扱う（AIを特別扱いしない） |
| Permission Model | `Owner → Moderator → Member → Guest`。**業界ごとの名称はUIだけ変更する** |
| Target Roadmap | Phase1: 警備業（安定性・音質・低遅延・権限管理・ログ管理） → Phase2: ビジネスチーム（イベント運営・展示会・自治体等） → Phase3: コンシューマー |
| Long-Term Architecture | 実装は業界非依存。警備業=`Company→Branch→Site→Room`、一般=`Community→Group→Room`。**UIだけ変わり内部構造は同じ** |
| Future Features | Public/Temporary Rooms、QR/NFC/Nearby Join、AI Participants、Live Translation、Spatial Audio、Transcription、AI Summary/Moderation 等 |

この物差しに照らすと、現在の実装は **「Phase1（警備業）の土台にGuestロール・
組織階層・バッジ・添付ファイルまで加わったが、実機検証の一部、プッシュ通知、
App Check、業界ラベリング層は未完了」** という状態にある。詳細な機能単位の
現状は「1. 実コード確認済みの現状」を参照。

## 1. 実コード確認済みの現状

サーバー(token-server)はPhase 1〜13およびPhase16の基盤まで実装済み（認証・
招待制ルーム・BAN・送話ロック・録音Egress・Webhook・moderator任命API・
監査ログ・管理者権限API・GCS/FirestoreのTTL/ライフサイクル管理・テキスト
チャットAPI・組織階層・バッジ・添付ファイル）。クライアント3種(Web/iOS/
Android)もBAN・送話ロック・オンボーディング・i18n・デザイントークン統一・
テキストチャットUI・参加者一覧のバッジ表示まで実装済みで、管理者サイトも
Vue 3の本格SPA(`admin-dashboard/`)へ刷新済み。

README.mdが定義する3つの原則のうち、①Permission ModelのGuestロールと
③Company/Branch/Site等の組織階層は実装済み。②業界ごとに名称だけ差し替える
ラベリング層は、Phase2の具体要件が確定してから設計する方針で未着手のまま
（詳細は「2-B」「Phase15」参照）。

| 領域 | Web | iOS | Android | 備考 |
|---|---|---|---|---|
| サインイン・ルーム作成/参加 | ✅ | ✅ | ✅ | |
| オンボーディング画面 | ✅ | ✅ | ✅ | |
| 送話ロック(排他制御) | ✅ | ✅ | ✅ | |
| BAN機能UI | ✅ | ✅ | ✅ | |
| 多言語化(i18n) | ✅ ja/en | ✅ xcstrings | ✅ strings.xml | |
| デザイントークン統一 | ✅ | ✅ | ✅ | `shared/design-tokens.css`等で一元管理 |
| 通報機能UI | ✅ | ✅ | ✅ | Phase9（CHANGELOG.md参照） |
| 録音の開始/停止UI | ✅ | ✅ | ✅ | 録音中判定はRoom Metadata経由で`PTTConnectionManager`が確定状態を保持 |
| 自動録音トグル(auto-recording ON設定) | ✅ | ❌ | ❌ | Web版`RecordingBar.vue`のみ。iOS/Androidは意図的にスコープ外（`DECISIONS.md`参照） |
| テキストチャット(Text Event) | ✅ | ✅ | ✅ | `token-server/routes/messages.js`＋3クライアント |
| 画像・動画・PDF添付(Image/File Event) | ✅ | ✅ | ✅ | Phase16。署名付きURL経由の直接アップロード（`API.md`・`DATA_MODEL.md`参照） |
| バックグラウンド動作(送受信) | - | ✅実機検証済み | ✅実機検証済み | AVRCP系Bluetoothヘッドセットの物理ボタンには非対応（既知の制約、「2-D」参照） |
| Guestロール | ✅ | ✅ | ✅ | `SECURITY.md`・「5. Guestロール・バッジシステム詳細仕様」参照 |
| 業界別ラベリング(UIのみ差し替え) | ❌ | ❌ | ❌ | 「警備業向け」の文言・概念が全画面にハードコード（Phase15） |
| 組織階層(Company/Branch/Site) | ✅ | ✅ | ✅ | Phase11。管理画面で団体・再帰node・Room割当を管理。ユーザー向けUIにもパンくず表示あり |
| 参加者一覧のバッジ表示 | ✅ | ✅ | ✅ | Phase13。Room APIを20秒間隔でポーリングし最優先1件を表示 |
| 開始/終了時刻(Room Schedule) | ✅ | ✅ | ✅ | 本体UIの実装は完了。**リポジトリ反映・実機ビルド確認が未実施**（「6. 次アクション」item9参照） |
| チャットUI(LINE風バブル・アバター・URLリンク化) | ✅ | ✅ | ✅ | **iOS/Androidは実機/実ビルドでの最終確認が未実施**（「6. 次アクション」item6〜7参照） |
| Web版レイアウト刷新(3ペイン/タブ+PTTミニバー) | ✅ | - | - | 768pxブレークポイントで構成を切替（`UI_UX.md`参照） |
| タブレット幅レイアウト(3ペイン) | - | ✅ | ✅ | **両OSともXcode/Gradleでの実ビルド確認が未実施**（「6. 次アクション」item8参照） |
| PWA対応(ホーム画面追加・オフラインApp Shell) | ✅ | - | - | iOS/Androidはネイティブアプリのため対象外 |

管理者サイトは`admin-dashboard/`(Vue 3+TS+Pinia)としてルーム一覧/詳細・
監査ログ・管理者権限・録音履歴DLまで実装済み。閲覧専用だった旧
`dev-tools/admin-dashboard.html`とは別物として本番投入可能な水準にある。

この表のチェック状態は`REQUIREMENTS.md`「Functional Requirements」の
チェックリストと一致させている。

---

## 2. README.mdのビジョンに照らした課題整理

### A. Permission Model：Guestロール → 実装完了

README.mdが定義する`Owner → Moderator → Member → Guest`の4段階は、
`token-server/routes/rooms.js`と3クライアントに実装済み。匿名認証の参加者は
サーバーが`guest`として判定し、ニックネーム変更と送話は許可する一方、
BAN・役割変更・録音などの管理操作は拒否する。role×操作の対応表は
`lib/permissions.js`に一元化され、クライアント側との同期はCI
(`role-sync-check.yml`)で検証している（詳細は`SECURITY.md`・Phase12参照）。
残課題は無い。

### B. 業界ごとのUIラベリング層が未着手

README.mdは「実装は業界に依存させない。業界ごとの名称はUIだけ変更する」と
明言しているが、現状の3クライアントは"警備業"を想定した文言・概念
（ルーム、招待コード等）が直接ハードコードされており、Phase2(イベント運営・
展示会・自治体等)向けに名称を差し替える仕組みが存在しない。

- i18n基盤(すでにja/en等で導入済み)を「言語」だけでなく「業種プロファイル」
  の文言差し替えにも転用できるよう、キー設計を拡張するのが現実的な入り口
- 例: `role.owner`を業種設定に応じて「現場責任者」「イベント主催者」等に
  出し分けるレイヤーを追加
- **着手条件: Phase2の具体的な案件・要件が確定してから**（詳細はPhase15、
  `DECISIONS.md`参照）。2つ目の業種の実要件が無いまま抽象化の軸を設計すると
  後で作り直すリスクが高いため、意図的に後回しにしている

### C. Long-Term Architecture：組織階層 → 実装完了

Phase11で、`organizations/{orgId}`と任意深さの`nodes`により、警備業の
`Company → Branch → Site → Room`と一般の`Community → Group → Room`を
同じデータモデルで表現できるようにした。Roomは無所属のままでもよく、必要な
場合だけ管理画面から団体・nodeへ割り当てる。Web/iOS/Androidの3クライアント
にも、Room View入室時に組織階層のパンくず表示を実装済み（詳細は
`DATA_MODEL.md`・`UI_UX.md`参照）。残課題は無い。

### D. Phase1(警備業)としての完成度に直結する残課題

README.mdのPhase1の目的は「安定性・音質・低遅延・権限管理・ログ管理」。
権限管理・ログ管理はPhase8でほぼ到達済み。音質・低遅延はLiveKit
（WebRTC/NetEQ）への移行により実質的に対応済みで、自前のジッターバッファ
実装は不要と判断している（判断の経緯は`DECISIONS.md`参照）。

バックグラウンド動作はiOS/Androidとも実装・実機検証済み。ただし以下は
既知の制約として記録している。

- **AVRCP系Bluetoothヘッドセットは物理ボタンでのPTT操作に対応できない**：
  採用した実装方式（`MPRemoteCommandCenter`のみ、CallKit統合は撤回済み）が
  対応する入力経路の範囲による制約で、不具合ではない。特定機種で物理ボタン
  からのPTT操作が必須要件になった場合は、CallKitの着信偽装方式（バッテリー
  消費・着信音/着信UIの懸念から一度見送り済み）の再検討が必要になる
  （詳細は`DECISIONS.md`参照）

### E. 3クライアント間の機能差 → 解消済み

通報UI・録音開始/停止UIはWeb版の設計をiOS/Androidへ移植し、3クライアントで
揃っている。Web版のみに存在する「自動録音: ON」トグルのみ、意図的に
スコープ外としている（`DECISIONS.md`参照）。残課題は無い。

### F. Future Featuresとの距離（優先度は低いが記録のため）

QR/NFC/Nearby Join、AI Participants、Live Translation、Spatial Audio、
Transcription、AI Summary/Moderation等はREADME.mdが「将来追加できるように
設計しておく」と位置づける項目であり、現時点では未着手。

Communication Model（Voice/Text/Image/File/Location/Reaction/System/AI
Messageを全て`Event`として扱う）については、Voice（PTT本体）・Text
（テキストチャット）・Image/File（添付ファイル、Phase16）の3種類がすでに
実装済み。残りのLocation/Reaction/System/AI Messageは未着手のままだが、
Guestロール・組織階層と同様、Phase2以降で本格的に必要になった際に、既存の
Text/Image Event実装（token-server経由での書き込み一本化＋Firestore
リアルタイム配信＋BAN連動）と同じ設計パターンを踏襲できるかを確認しておくと
着手コストを抑えられる。Participant Model（Human/AI/Botを同一概念として
扱う）を見据え、`members`コレクションのスキーマがHuman以外のParticipant
種別を将来無理なく追加できる形になっているかも、着手前に一度レビューして
おくとよい（詳細は`AI.md`参照）。

---

## 3. 優先順位付きロードマップ案（README.mdのTarget Roadmapに整合）

Phase9〜13・16は実装完了。実装内容そのものは`CHANGELOG.md`、設計判断は
`DECISIONS.md`を参照。ここでは現在のロードマップ上の位置づけと、Phaseごとに
残っている検証・確認事項のみを記す。

### Phase 9: Phase1(警備業)を名実ともに完成させる → 完了
音質・低遅延はLiveKit移行により実質対応済み、通報UI・録音UIのiOS/Android
実装、iOS README書き直し等はすべて完了している（`CHANGELOG.md`「Phase 9」
参照）。

**（2026-08-11追記）** Room開始/終了時刻（Schedule）機能は、実装に着手した
時期の都合でPhase16（PWA化等の改善要望群）としてまとめて実装したが、
README.mdのTarget Roadmap上はこのPhase9（Phase1=警備業の完成度）に概念上
属する機能である。警備現場のシフト運用（「この時間帯だけこのRoomを開けて
おく」）に直結するため。`ROADMAP.md`側でも同様に「Phase 2 / Security
Industry」（README.mdのPhase1警備業に相当する区分）に位置づけ済み。
実装Phaseの区分（Phase16）と機能としての位置づけ（Phase1警備業/Phase9）が
異なる点を明記しておく。

### Phase 10: Permission ModelにGuestロールを追加 → 完了
詳細は「5. Guestロール・バッジシステム詳細仕様」・`CHANGELOG.md`「Phase 10」
参照。

### Phase 11: 組織階層(Long-Term Architecture)の導入 → 完了
詳細は`CHANGELOG.md`「Phase 11」・`DATA_MODEL.md`参照。

### Phase 12: 役割(Role)と機能(Permission)の整理・UI/UX基盤化 → 完了
サーバー側の対応表一元化(`lib/permissions.js`)、クライアント側の共有定数化+
CI同期チェック、招待コード可視範囲の解決、組織ロースター層のスコープ付き
権限まで実装済み。詳細は`CHANGELOG.md`「Phase 12」・`SECURITY.md`・
`phase12-role-operation-inventory.md`参照。

### Phase 13: バッジシステムの基本機能 → 完了
グローバルな`badges`マスタ・`badgeGrants`・Room owner向け付与/剥奪UIまで
実装済み。団体/業種プロファイル単位への拡張はPhase15へ持ち越し。詳細は
`CHANGELOG.md`「Phase 13」・`phase13-badge-schema.md`参照。

### Phase 14: Phase2(ビジネスチーム)展開に向けた仕上げ → **未着手**
- Firebase App Check導入
- プッシュ通知（Web版PWA化(Phase16)で導入したService Worker基盤を再利用する
  想定）
- 自動テスト・E2Eテストの拡充（現状はCIでの構文/Lintチェックが中心。詳細は
  `TESTING.md`参照）

Phase9〜13が完了し、ロードマップ上は次に着手すべきフェーズ。3項目とも
まだ手つかず（「6. 次アクション」item1参照）。

### Phase 15: 業界ラベリング層の設計・導入 → **着手条件待ち**
**着手条件: Phase2（イベント運営・展示会・自治体等）の具体的な案件・
要件が確定してから。**（判断の経緯は`DECISIONS.md`参照）

- i18nのキー構造を「言語 × 業種プロファイル」で文言を出し分けられる形へ拡張
- 警備業プロファイルを第一弾として整備し、Phase2向けの第二プロファイルを
  追加できることを検証する
- バッジシステムを業種プロファイル単位・団体単位で複数マスタ切り替え
  可能な形に拡張する（Phase13で実装した基本機能の上に積み増す）
- 自動付与判定の業種プロファイル単位での条件出し分けを実装する

### Phase 16: Webクライアント PWA化・チャット添付・Room Schedule拡張 → 完了
README.mdが直接要求する項目ではないが、ユーザー起点の改善要望として着手。
PWA化・チャット添付(Image/File Event)・招待リンク/QRコード参加・Room
Schedule機能・チャットUI刷新・タブレット幅レイアウトを含む。詳細は
`CHANGELOG.md`「Phase 16」参照。**このPhaseに含まれる複数の変更について、
実機ビルド確認・リポジトリ反映確認がまだ完了していない項目が残っている
（「6. 次アクション」item5〜9参照）。** なお、このうちRoom Schedule機能は
README.mdのTarget Roadmap上はPhase1(警備業)/Phase9に概念上属する（詳細は
Phase9参照）。

---
## 5. Guestロール・バッジシステム 詳細仕様

Phase10（Guestロール）・Phase13（バッジ）の実装済み仕様。実装時はこの内容を
出発点とした。実装内容そのものは`SECURITY.md`・`DATA_MODEL.md`・
`phase13-badge-schema.md`を参照。

### 5.1 Guestロール

| 項目 | 仕様 |
|---|---|
| 認証方式 | Firebase匿名認証 |
| 送話権限 | 可能（閲覧専用ではない） |
| 権限系メニュー | BAN・moderator任命・録音操作等は非表示 |
| 参加範囲 | 1招待コード＝1Room限定 |
| セッション同一性 | 招待コード（チャネル）が生存中の再入室は同一ID扱い。チャネル終了後は無効 |
| Room解散後のデータ | 参加記録・ID情報は削除しない |
| ニックネーム | 変更可能・リアルタイム反映。監査ログ・録音の話者記録はニックネームでなく内部IDに追従（変更履歴自体は追わなくてよい） |
| 表示名ルール | ニックネームがあればニックネーム、なければID表示 |
| 業種プロファイルとの関係 | 警備業では通常発生せず、デモ・特定用途向け。Phase2(イベント運営等)での利用頻度がより高い想定 |
| Member昇格 | **対象外（確定）**。昇格導線・APIは実装しない。GuestとMemberは常に別IDの別人物として扱う |

### 5.2 Memberの永続性・個人情報

| 項目 | 仕様 |
|---|---|
| 認証要件 | メールアドレス必須（本人確認・認証用途のみ、以降はIDで管理） |
| 永続性 | 削除しない限り永続的に利用可能 |
| 削除の実体 | ユーザー無効化（ID自体は存続）。個人情報保護の観点でメールアドレスのみ削除も可能 |
| 削除の主体 | 本人の退会申請、または管理者による削除 |

### 5.3 バッジシステム

| 項目 | 仕様 |
|---|---|
| 表現形式 | アイコン（絵文字的なもの） |
| 表示先 | プロフィール画面（未設計、複数表示） |
| 個人による選択 | 不可（付与されるもののみ） |
| 付与経路 | Owner手動（一部バッジはRoom内owner自室完結でも可）、またはSystem自動（業種プロファイル単位の条件） |
| 自動付与条件のイメージ | 技能章（資格・特技）、部隊章（所属）、階級章 |
| 自動付与のトリガー | バッチ処理（例：条件達成後1日以内に付与）。**バッチ処理そのものは未着手**（Phase15の対象） |
| 失効・剥奪 | 仕組みとして持つ。Owner手動・System自動どちらの経路からも取消・上書き可能 |
| 表示優先順位 | バッジごとに個別の優先度値を保持し、それに基づき上位を表示 |
| 最大表示数 | 業種プロファイル単位で設定（n件）。現行はグローバルな優先度1件表示 |
| Room内・参加者一覧での表示 | 最優先バッジ1個のみ表示（例：階級のみ） |
| マスタの保存場所 | Phase13時点では団体IDを持たないグローバルな単一マスタ構成。団体/業種プロファイル単位への拡張はPhase15（判断の経緯は`DECISIONS.md`参照） |
| 管理画面 | Phase13で`BadgesView.vue`として実装済み |
| Guestの対象範囲 | 役割バッジ（Guestである表示）のみ付与対象、`badgeGrants`へは永続化しない仮想バッジとして実装。資格・勤続バッジは対象外 |

### 5.4 洗い出された矛盾点・懸念点（要フォロー）

このセクションで検討していた論点は、以下の1件を除きすべて解消済み。
解消済み論点の経緯（バッジ付与履歴の監査ログ統合、GuestIDとMember昇格の
非統合、他参加者のGuest判定手段、ユーザー×団体の所属関係、Room作成と組織
階層紐付けの分離、招待コードの可視範囲、業界ラベリング層の位置づけ、
バッジマスタの団体スコープを巡る文書内矛盾）は`DECISIONS.md`・
`brushup-plan-history.md`・`phase11-org-roster-design.md`を参照。

- **Guest認証自体の招待制化（未着手）**：現行実装は「ルームへの参加」は
  既存の招待コード必須ロジックを素通りするため引き続き招待制だが、
  「匿名認証でサインインするボタン」自体には制限がなく、招待コードを
  持たない相手でも押せてしまう。将来のQR/招待リンクからの直接参加
  （README.mdのFuture Features）を見据えるなら、「招待コードを先に
  入力させてから匿名認証させる」順序への変更を検討する余地がある。
  優先度は低いが、匿名アカウントの量産余地を塞ぎたい場合は着手を検討する

---

## 6. 次アクションの提案（2026-08-11 整理）

過去の改定で完了した項目、および項目番号の変遷の経緯は
`brushup-plan-history.md`「第2部」に集約した。以下は2026-08-11時点で
現在有効な次アクションのみを整理し直したもの。

1. **Phase14への着手**：Phase9〜13・16が完了し、ロードマップ上は次の
   フェーズ。Firebase App Check導入・プッシュ通知・自動テスト/E2Eテストの
   拡充の3項目ともまだ手つかず。プッシュ通知はPhase16で導入したService
   Workerを土台にできる
2. ✅ **完了（2026-08-11）**: ドキュメント巻き戻り事故の再発防止策。過去に
   1度、正規のコード変更コミットへ本ドキュメントの誤った巻き戻りが
   混在する事故が発生していた（原因未特定）。ユーザーの運用ルール変更
   （並行作業を行わない／作業が並行した場合は必ず最新のドキュメントを
   ベースに更新する）により、事故原因だった「並行作業による巻き戻り」
   自体が起きない運用になったことを確認した。コミット分離や機械的検知の
   仕組み自体は導入していないが、根本原因への対応としてこれで十分と判断
   し、次アクションから外す（詳細は`DECISIONS.md`2026-08-11参照）
3. ✅ **完了（2026-08-11）**: Room Scheduleのロードマップ上の位置づけ整理。
   README.mdのTarget Roadmap上はPhase1(警備業)/Phase9に概念上属する機能
   であることを明記した（実装自体はPhase16としてまとめて行ったため、
   実装Phaseの区分と機能としての位置づけが異なる点も併記）。`ROADMAP.md`
   側の「Phase 2 / Security Industry」区分ともこれで整合が取れている。
   詳細は「3. 優先順位付きロードマップ案」Phase9・Phase16参照
4. ✅ **完了（2026-08-11、GCP Cloud Schedulerコンソールのスクリーンショット
   により確認）**: GCP側Cloud Schedulerジョブの実在確認。ユーザーから
   提示されたスクリーンショットにより、`sweep-expired-rooms`ジョブが
   実在し（Region: `asia-northeast1`、Frequency: `* * * * *`＝毎分、
   State: Enabled）、Target URLが`POST /internal/rooms/sweep-expired`
   （`https://ptt-token-server-768163479600.asia-northeast1.run.app/
   internal/rooms/sweep-expired`）を指していること、直近の実行
   （Aug 11, 2026）が「Success」であることを確認した。ユーザーからも
   「実際に動作も確認ずみ」との申告を受けている。**（確度について）**
   GCPコンソールのスクリーンショットという第三者（Google Cloud）が
   表示した実データに基づく確認であり、十七訂のGitHub Actions実行画面
   確認と同様、ユーザー申告のみの確認より確度は高い。ただしこの環境から
   直接GCPへアクセスして確認したものではない点は留意する
5. **保存済みルーム履歴のschedule表示対応(iOS/Android)のビルド確認**：
   Web版は`vue-tsc -b`・`eslint .`で確認済み。iOS版のXcodeビルド、
   Android版のGradleビルドはこの環境にmacOS/Android SDKが無いため未実施
   のまま。戻り値の型をタプル/データクラスに変更する等、既存の呼び出し元
   との整合が必要な変更を含むため優先度は高い
6. **チャットUI刷新(iOS版)の実機ビルド確認**：実機Xcodeビルドで報告された
   4件のエラーのうち2件(`AttributedString`の型推論エラー)は修正済み。
   残り2件(`ChatAvatarView`/`Linkify`が「Cannot find in scope」)は、
   ファイル自体はgit管理下に正しく存在し構文エラーも無いことをこの環境
   では確認できたが、target membership（Xcodeプロジェクトへの取り込み
   設定）に起因する問題かどうかはこの環境にXcodeが無いため切り分け不可。
   (a) 修正版での実機再ビルド結果、(b) 上記2件のエラーが解消したか、を
   確認する
7. **チャットUI刷新(Android版)の実機ビルド確認・実機IME確認**：実機
   Android Studioビルドで報告された1件のエラー
   (`Unresolved reference 'withStyle'`)は修正済みで、git管理下でHEADへの
   反映も確認済み。本環境にはAndroid SDK/Gradleが無く`assembleDebug`の
   実行自体はできないため、(a) 修正版での`assembleDebug`再ビルド結果、
   (b) 実機の日本語IME(Gboard等)でのチャット入力で誤送信が起きないか、
   の2点を確認する
8. **タブレット幅レイアウト(iOS/Android)の実機ビルド確認**：両OSとも
   Xcode/Gradleによる実際のビルド実行・タブレット実機/エミュレータでの
   サイズクラス切り替え確認が未実施。未入室中（ルーム選択画面）の
   タブレット幅専用レイアウトは両OSとも意図的にスコープ外のまま
9. **Room Schedule機能(iOS/Android移植)の反映・実機確認**：
   (a) パッチ(`room-schedule-mobile.patch`)の`tad-iizuka/FirebaseRTC`
   リポジトリ本体への実際の反映確認、(b) Xcode/Android Studioでの実機
   ビルド確認、(c) 実機での待機画面(before_start)・チャット閲覧専用
   画面(after_end)の表示確認（特にAndroid側は通常の入室(in_session)
   フローも含めた回帰確認が必要）
10. **iOS版: Liquid Glass関連実装の標準コンポーネントへの回帰・実機確認**：
    HIG準拠・今後のiOSアップデートへの追従を目的に標準コンポーネントへ
    戻した変更について、(a) 実機での再描画確認（フラッシュ現象、
    `.preferredColorScheme(.dark)`追加後の見た目が解消したか）、
    (b) 解消していない場合の原因切り分け、(c) 見た目の作り込み
    （角丸・影等）の再検討、がいずれも未実施
11. **iOS CI（`ios-ci.yml`）シミュレータ選択修正の実行結果確認**：
    `IPHONEOS_DEPLOYMENT_TARGET`を満たさないシミュレータを選んでしまい
    `xcodebuild test`が決定論的に失敗していた問題への修正は、ロジック検証
    ・リポジトリ反映確認まで完了済み。残るのは、(a) 実際のGitHub Actions
    上での再実行で今回のエラーが解消したか、(b) ランナー上で
    `IPHONEOS_DEPLOYMENT_TARGET`を満たすSimulatorランタイムがそもそも
    用意できるか、の2点のみで、この環境にGitHub Actionsの実行環境が無い
    ため未確認のまま
12. **文書棚卸し(`REQUIREMENTS.md`等6ファイル書き起こし)のリポジトリ反映
    確認**：`REQUIREMENTS.md`・`DECISIONS.md`・`CHANGELOG.md`・
    `TESTING.md`・`CONTRIBUTING.md`・`DEPLOYMENT.md`の書き起こしは
    アップロードされたリポジトリ一式に対して行ったもので、
    `tad-iizuka/FirebaseRTC`リポジトリ本体への実際のコミット・反映は
    未確認（`git show`等による直接検証が必要）
13. **本改定（brushup-plan.mdの整理・`brushup-plan-history.md`分離）の
    リポジトリ反映確認**：本改定もアップロードされたリポジトリ一式に
    対して直接編集したもので、リポジトリ本体への反映は未確認
