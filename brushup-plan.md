# PTTアプリ ブラッシュアップ計画（改定版）

対象リポジトリ: `tad-iizuka/FirebaseRTC`
作成日: 2026-07-09 / 改定: 2026-07-24（README.md「Vision」に基づき全面改定）
再改定: 2026-07-25（Guestロール・バッジシステムの詳細仕様を検討し反映）
再々改定: 2026-07-25（リポジトリ本体（`tad-iizuka/FirebaseRTC`, HEAD=`990dd5d`）を
直接取得しソースコードを検証。README.mdの記述のみに基づく間接的な整理から、
実コード（token-server/ptt-client/ptt-ios/ptt-android）の直接確認に切り替えた）
四訂: 2026-07-25（「ジッターバッファ未実装」の記述を訂正。根拠にしていた
iOS READMEがLiveKit移行前の記述のまま更新されていなかったため誤りと判明。
3クライアントともLiveKit（WebRTC/NetEQ）に音声再生を委譲済みであり、
自前ジッターバッファは不要と判断）
五訂: 2026-07-25（「6. 次アクションの提案」内の「Guestロールの要件定義に
着手」という記述を訂正。Guest要件は「5. 詳細仕様」で既に確定済みであり、
旧版の記述はGuest仕様確定前に書かれたまま更新されていなかった内部矛盾
だった。実装着手が正しいネクストアクションである）
六訂: 2026-07-25（`ptt-ios/ptt-ios/README.md`をLiveKit移行後の実装に合わせて
実際に書き直し、Phase9・次アクションの該当項目を完了扱いに更新。ただし
リポジトリへの反映自体は未実施のため、次アクションとして残した。あわせて
「他ドキュメントの棚卸し」を新規の次アクションとして追加）
七訂: 2026-07-25（「他ドキュメントの棚卸し」を実施。`admin-dashboard/README.md`
はおおむね正確、`API.md`等はテンプレートのまま未記入と判明。加えて
`token-server/README.md`の「録音の開始/停止ボタンはWeb/iOSともに別途実装が
必要」という記述が、2026-07-24のWeb版実装後に更新されておらず陳腐化して
いることを発見。iOS READMEとは別の、同種の文書陳腐化の実例）

> 本改定では、アップロードされた `README.md`（"Connect to a place, not to a person."）に
> 明記されたビジョン・原則・ターゲットロードマップを"あるべき姿"の物差しとして採用し、
> 実装済みコードとの差分を再整理した。前版（初回作成）は実装状況の一般的な整理に
> 留まっていたが、本版はプロダクトビジョンとの整合性を軸に組み直している。
>
> **2026-07-25の再々改定について**: これまでの版はREADME.mdおよび口頭の検討内容を
> 前提に組み立てられており、実コードを直接参照していなかった。今回リポジトリ一式
> （`.git`履歴含む）を取得し、`token-server/routes/`・3クライアントのソースを
> grepベースで直接確認した結果、**テキストチャット機能（Communication Modelの
> "Text" Event）がサーバー・Web・iOS・Android全てに既に実装済み**であることが判明した
> （2026-07-08の`add: chat`コミット以降、一度も本計画に記載されていなかった）。
> その他の項目（Guestロール・業界ラベリング・組織階層・
> バックグラウンド動作・通報/録音UIのiOS/Android未実装）については、前版の記述が
> 実コードと一致していることを確認した。

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

この物差しに照らすと、現在の実装は **「Phase1（警備業）の土台は完成しつつあるが、
Phase1の目的そのもの（音質・低遅延の作り込み）とPermission ModelのGuest、
Long-Term Architectureの組織階層はまだ手つかず」** という状態にある。なお
2026-07-25の実コード検証により、Communication Modelの`Text` Event
（テキストチャット）は3クライアント・サーバー双方で既に実装済みであることが
判明しており（詳細は「1. 実コード確認済みの現状」参照）、Phase1の要件外の
部分ではあるが着実に前進している。

## 1. 実コード確認済みの現状（README改定前の分析を上書き）

サーバー(token-server)はPhase 1〜8まで実装済み（認証・招待制ルーム・BAN・
送話ロック・録音Egress・Webhook・moderator任命API・監査ログ・管理者権限API・
GCS/FirestoreのTTL/ライフサイクル管理・**テキストチャットAPI**）。クライアント
3種(Web/iOS/Android)もBAN・送話ロック・オンボーディング・i18n・
デザイントークン統一・**テキストチャットUI**まで実装済みで、管理者サイトも
Vue 3の本格SPA(`admin-dashboard/`)へ刷新済み。

**（2026-07-25再々改定時の追記）** `token-server/routes/messages.js`（Phase5、
2026-07-08実装）と、Web(`ChatPanel.vue`/`stores/chat.ts`)・iOS
(`PTTChatStore.swift`)・Android(`PTTChatStore.kt`)の3クライアントを直接確認した
結果、**テキストチャット（README.mdのCommunication Modelが定義する`Text` Event）
は3プラットフォームすべてで実装済み**であることが判明した。設計は
LiveKitのData Channelを使わず、書き込みをtoken-server経由に一本化し
Firestoreの`rooms/{roomId}/messages`をリアルタイム配信元とすることで、
BAN即時反映（`status: 'banned'`になった瞬間`firestore.rules`側で読み取り権限も
失う）と同じモデレーション強制パターンを踏襲している。一方、Communication
Modelが定義する残りのEvent種別（Image/File/Location/Reaction/System/AI
Message）はコード上どこにも見当たらず、依然として未着手である。

**機能の作り込みという意味では従来の想定より進んでいる。** 一方で、README.md
が定義する3つの原則──①Permission ModelのGuestロール、②業界ごとに名称だけ
差し替えるラベリング層、③Company/Branch/Site等の組織階層──は**まだ実装されて
いない**。これらはPhase1(警備業)を"完成"と呼べるかどうかの分水嶺であり、
かつPhase2(ビジネスチーム)へ進む前提条件でもあるため、ここに焦点を当てて
計画を組み直す。

| 領域 | Web | iOS | Android | 備考 |
|---|---|---|---|---|
| サインイン・ルーム作成/参加 | ✅ | ✅ | ✅ | |
| オンボーディング画面 | ✅ | ✅ | ✅ | |
| 送話ロック(排他制御) | ✅ | ✅ | ✅ | |
| BAN機能UI | ✅ | ✅ | ✅ | |
| 多言語化(i18n) | ✅ ja/en | ✅ xcstrings | ✅ strings.xml | |
| デザイントークン統一 | ✅ | ✅ | ✅ | `shared/design-tokens.css`等で一元管理 |
| 通報機能UI | ✅ | ❌ | ❌ | |
| 録音の開始/停止UI | ✅ | ❌ | ❌ | |
| **テキストチャット(Text Event)** | ✅ | ✅ | ✅ | `token-server/routes/messages.js`(Phase5)＋3クライアント。2026-07-08実装、本計画では今回初めて記載 |
| バックグラウンド動作 | - | ⚠️設定のみ・未検証 | ❌未実装 | |
| **Guestロール** | ❌ | ❌ | ❌ | サーバー側もowner/moderator/memberの3種のみ |
| **業界別ラベリング(UIのみ差し替え)** | ❌ | ❌ | ❌ | 「警備業向け」の文言・概念が全画面にハードコード |
| **組織階層(Company/Branch/Site)** | ❌ | ❌ | ❌ | データモデルはRoom直下がフラットなまま |

管理者サイトは`admin-dashboard/`(Vue 3+TS+Pinia)としてルーム一覧/詳細・
監査ログ・管理者権限・録音履歴DLまで実装済み。閲覧専用だった旧
`dev-tools/admin-dashboard.html`とは別物として本番投入可能な水準にある。

---

## 2. README.mdのビジョンに照らした課題整理

### A. Permission Model：Guestロールの欠落

README.mdは`Owner → Moderator → Member → Guest`の4段階を定義しているが、
現行実装(`token-server/routes/rooms.js`)は`owner`/`moderator`/`member`の
3種のみ。Guestが想定する「一時参加・権限最小・名前だけ登録して即解散」
というPrivacy First/Temporary Relationshipsの体験が今のところ存在しない。

- Guestロールの権限定義（例: 送話不可・閲覧のみ、あるいは招待コードだけで
  本登録なしに一時参加できる、等）をまず要件として固める
- Firestoreのroleフィールド・Firestoreルール・BAN/moderator任命APIの
  権限チェック全箇所への影響範囲の洗い出しが必要

### B. 業界ごとのUIラベリング層が未着手

README.mdは「実装は業界に依存させない。業界ごとの名称はUIだけ変更する」と
明言しているが、現状の3クライアントは"警備業"を想定した文言・概念
（ルーム、招待コード等）が直接ハードコードされており、Phase2(イベント運営・
展示会・自治体等)向けに名称を差し替える仕組みが存在しない。

- i18n基盤(すでにja/en等で導入済み)を「言語」だけでなく「業種プロファイル」
  の文言差し替えにも転用できるよう、キー設計を拡張するのが現実的な入り口
- 例: `role.owner`を業種設定に応じて「現場責任者」「イベント主催者」等に
  出し分けるレイヤーを追加

### C. Long-Term Architecture：組織階層の欠如

README.mdの警備業モデル`Company → Branch → Site → Room`、一般モデル
`Community → Group → Room`はいずれも未実装。現行のデータモデルは
Room単体がフラットに存在するのみで、複数拠点・複数現場をまたいだ管理者
ビューが作れない。

- Phase2以降(複数現場を横断して管理したい警備会社、複数拠点を持つ
  イベント運営会社)に進む前に、最低限「Room の上位に何らかのグルーピング
  概念を1段挟めるようにする」設計判断が必要
- 管理者サイト(`admin-dashboard`)のルーム一覧も、現状は全ルームがフラットな
  一覧のため、階層が入った時点でナビゲーション設計をやり直す必要がある

### D. Phase1(警備業)としての完成度に直結する残課題

README.mdのPhase1の目的は「安定性・音質・低遅延・権限管理・ログ管理」。
権限管理・ログ管理はPhase8でほぼ到達済みだが、**音質・低遅延**の作り込みは
バックグラウンド動作を除き大きな課題は見当たらない。

- ~~ジッターバッファ未実装~~ **（2026-07-25訂正）** 前版はiOS README
  （`ptt-ios/ptt-ios/README.md`）の「受信したOpusバイナリフレームを
  `AVAudioPlayerNode`にスケジュールして再生」という記述を根拠にジッター
  バッファ未実装としていたが、このREADMEは**LiveKit移行前（自前WebSocket+
  AVAudioEngine+swift-opus実装時代）の記述が更新されずに残っていたもの**
  だった。実際には3クライアントとも`livekit-client`(Web)/
  `livekit-android`(Android)/LiveKit Swift SDK(iOS)経由でLiveKit Cloudに
  接続しており（`PTTConnectionManager.swift`のコメントに「LiveKit移行」と
  明記）、音声の送受信・再生はLiveKit（内部はWebRTC/libwebrtc）に委譲されて
  いる。WebRTCの音声エンジンはNetEQと呼ばれる適応型ジッターバッファ・
  パケットロス隠蔽・タイムストレッチを標準で備えているため、**自前の
  ジッターバッファ実装は不要**と判断する。優先度が高いのはむしろ、
  実態と乖離した`ptt-ios/ptt-ios/README.md`を現行のLiveKitベース構成に
  合わせて書き直すことである（誤った実装判断の再発防止のため）
- バックグラウンド動作: iOSは設定のみで実機未検証、Androidは
  ForegroundService自体が未実装。警備現場で「アプリを閉じたら送受話が
  切れる」のはPhase1の要件と矛盾する

### E. 3クライアント間の機能差（引き続き残る課題）

- 通報UI: Web版のみ。iOS/Androidは未実装
- 録音の開始/停止UI: Web版のみ。iOS/Androidは録音中フラグの受信のみで
  操作ボタンがない

### F. Future Featuresとの距離（優先度は低いが記録のため）

QR/NFC/Nearby Join、AI Participants、Live Translation、Spatial Audio、
Transcription、AI Summary/Moderation等はREADME.mdが「将来追加できるように
設計しておく」と位置づける項目であり、現時点では未着手。Participant Model
（Human/AI/Botを同一概念として扱う）を見据えるなら、現行の
`members`コレクションのスキーマがHuman以外のParticipant種別を将来
無理なく追加できる形になっているか、早めに一度レビューしておくとよい。

**（2026-07-25追記）** README.mdのCommunication Model（Voice/Text/Image/File/
Location/Reaction/System/AI Messageを全て`Event`として扱う）については、
Voice（PTT本体）に加えてText（テキストチャット）が既に3クライアント・サーバー
双方で実装済みであることを確認した。これはPhase1(警備業)が直接必要とする
機能ではないが、「全てをEventとして扱う」という設計思想が最低限2種類の
Eventで実証されている状態と言える。残りのImage/File/Location/Reaction/
System/AI Messageは未着手のままであり、Guestロール・組織階層と同様、
Phase2以降で本格的に必要になった際に、既存のText Event実装（token-server
経由での書き込み一本化＋Firestoreリアルタイム配信＋BAN連動）と同じ設計
パターンを踏襲できるかを確認しておくと着手コストを抑えられる。

---

## 3. 優先順位付きロードマップ案（README.mdのTarget Roadmapに整合）

### Phase 9: Phase1(警備業)を名実ともに完成させる
README.mdのPhase1目的（安定性・音質・低遅延）のうち、権限管理・ログ管理は
Phase8で到達済み。音質・低遅延はLiveKit（WebRTC/NetEQ）への移行により
実質的に対応済みと判断し、残る安定性面とクライアント間の機能差を埋める。

- ~~ジッターバッファの実装~~ **不要と判断（2026-07-25訂正）**。LiveKit
  SDK経由でWebRTCの音声パイプライン（NetEQ）に委譲済みのため、自前実装は
  対応不要。
  ✅ **完了（2026-07-25）**: `ptt-ios/ptt-ios/README.md`をLiveKit移行後の
  実装内容に合わせて書き直した（旧AVAudioEngine実装時代の記述が残っており、
  今回のジッターバッファ誤判断の直接原因になっていたため）。依存パッケージ
  （LiveKit Swift SDK 2.15.1・firebase-ios-sdk 12.15.0・GoogleSignIn-iOS
  9.2.0）・ファイル構成・サインイン〜PTT〜送話ロック〜BAN〜チャットの
  現行の仕組みを実コードから書き起こし済み。要リポジトリ反映
  （成果物: `ptt-ios-README.md`として提示済み）
- iOS: バックグラウンド動作の実機検証・本実装
- Android: ForegroundServiceの実装
- iOS/Androidへの通報UI・録音開始/停止UIの実装（Web版を移植）

### Phase 10: Permission ModelにGuestロールを追加
2026-07-25の検討により、要件レベルでは以下の通り確定。詳細は
「5. Guestロール・バッジシステム 詳細仕様」を参照。

- Guestロールの実装（`token-server`のrole関連API・Firestoreルールへの反映）
  - 送話可能（閲覧専用ではない）
  - 権限系メニュー（BAN・moderator任命・録音操作等）は非表示
  - Firebase匿名認証を利用し、事前登録・アカウント作成は不要
  - 1招待コード＝1Room限定。招待コード（チャネル）が生存中の再入室は
    同一ID扱い、チャネル終了後は無効
  - Room解散後もGuestの参加記録・ID情報は削除しない
  - ニックネームは変更可能・リアルタイム反映。監査ログ・録音の話者記録は
    ニックネームではなく内部IDに追従させ、表示名の変更history自体は
    追わなくてよい
- 3クライアントUIへのGuest導線の追加（Guestとして参加する分岐、
  ニックネーム変更UI、Guestバッジの表示）
- Guest→Member昇格導線の要否検証
  - Firebase匿名認証からMemberアカウントへの昇格自体は技術的に可能
  - 実運用でGuestからMember登録への切り替えニーズが高い場合に導線を実装
    （Phase10時点では優先度未定、運用実態を見て判断）
- 業種プロファイルとの関係：警備業では通常Guestは発生せず、デモ・
  特定用途でのみ利用される想定。Phase2以降（イベント運営等）での
  利用頻度の方が高くなる可能性がある

### Phase 11: 業界ラベリング層の設計・導入
- i18nのキー構造を「言語 × 業種プロファイル」で文言を出し分けられる形へ拡張
- 警備業プロファイルを第一弾として整備し、Phase2(イベント運営等)向けの
  第二プロファイルを追加できることを検証する
- **バッジシステムの導入**（詳細は「5. Guestロール・バッジシステム 詳細仕様」参照）
  - バッジマスタ（アイコン・優先度・自動付与条件）を業種プロファイル単位、
    かつ団体（Company/Branch等）単位で書き換え可能なデータとして設計
  - 業種プロファイルの初期値はシステム管理者が登録・変更する運用とする
  - バッジ管理画面はPhase11でまずPoCを実施し、構成・見せ方
    （ユーザ管理画面への統合を含む）は事後検討とする
  - 自動付与判定はバッチ処理で行う（例：条件達成後1日以内に付与）想定とし、
    リアルタイム評価はしない
- 組織階層（Phase12）とバッジマスタの団体単位管理は依存関係にあるため、
  Phase11時点では「団体ID」相当の仮キーのみ持たせ、Phase12で正式な
  組織階層データに接続する段階的な設計とする

### Phase 12: 組織階層(Long-Term Architecture)の導入
- Room の上位グルーピング概念（Company/Branch/Site、あるいは
  Community/Group）をデータモデルに追加
- 管理者サイトのルーム一覧を階層ナビゲーションに対応させる
- 既存のフラットなRoomデータからの移行方針を設計する

### Phase 13: Phase2(ビジネスチーム)展開に向けた仕上げ
- Firebase App Check導入
- プッシュ通知
- 自動テスト・E2Eテストの拡充（現状はCIでの構文/Lintチェックが中心）

---

## 5. Guestロール・バッジシステム 詳細仕様（2026-07-25 検討分）

Phase10（Guestロール）・Phase11（業界ラベリング層／バッジ）の着手前に、
仕様レベルでの合意形成を行った。実装時はこの内容を出発点とする。

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
| Member昇格 | 匿名認証からの昇格は技術的に可能。運用頻度次第で導線実装を検討（優先度未定） |

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
| 付与経路 | Owner手動、またはSystem自動（業種プロファイル単位の条件） |
| 自動付与条件のイメージ | 技能章（資格・特技）、部隊章（所属）、階級章 |
| 自動付与のトリガー | バッチ処理（例：条件達成後1日以内に付与）。リアルタイム評価はしない |
| 失効・剥奪 | 仕組みとして持つ。Owner手動・System自動どちらの経路からも取消・上書き可能 |
| 表示優先順位 | バッジごとに個別の優先度値を保持し、それに基づき上位を表示 |
| 最大表示数 | 業種プロファイル単位で設定（n件） |
| Room内・参加者一覧での表示 | 最優先バッジ1個のみ表示（例：階級のみ） |
| マスタの保存場所 | 団体（Company/Branch等）ごとに書き換え可能なデータベース。業種プロファイルの初期値はシステム管理者が登録・変更 |
| 管理画面 | Phase11でPoCを実施し、構成・見せ方（ユーザ管理画面への統合を含む）は事後検討 |
| Guestの対象範囲 | 役割バッジ（Guestである表示）のみ付与対象。資格・勤続バッジは対象外 |

### 5.4 洗い出された矛盾点・懸念点（要フォロー）

- **バッジマスタの団体単位管理とPhase12の順序**：バッジマスタは団体単位で
  管理する想定だが、組織階層（Company/Branch/Site）自体はPhase12で
  未実装のため、Phase11時点では「団体ID」相当の仮キーで代替し、Phase12で
  正式接続する段階的設計が必要
- **バッジ付与・失効の履歴管理**：自動付与（バッチ）と手動付与（即時）が
  混在するため、「いつ・誰が（またはどの自動条件が）付与/剥奪したか」を
  Phase8の監査ログ基盤の対象に含める前提を明記する必要がある
- **GuestIDとMember昇格の整合性**：Guestの永続IDが、Member昇格時に
  同一IDのまま認証情報が紐付け変更されるのか、新規Member IDが別途
  発行されるのかが未確定。監査ログ上「同一人物の継続」として扱うか
  どうかに関わるため実装時に確定させる
- **自動付与の遅延と手動付与の即時性のギャップ**：同一バッジ体系内で
  手動付与（即時）と自動付与（最大1日遅延）の体験差が生じるため、
  UI上で遅延の可能性をユーザーに明示する文言が必要

---

## 6. 次アクションの提案

README.mdのビジョンと現状の差分のうち、影響範囲が限定的かつ着手しやすい
ものから始めることを推奨します。

1. **iOS/Androidへの通報UI・録音開始/停止UIの実装**（Web版の実装を移植する
   形で対応可能。3クライアントの機能差を埋める最後のピース。**（2026-07-25
   訂正）** 対象は「iOS/Android両方」で変わらないが、Web版はREADME上「未
   実装」と書かれていた時期の記述が古いだけで実際は実装済み。詳細は項目3参照）
2. ✅ **完了（2026-07-25）**: `ptt-ios/ptt-ios/README.md`をLiveKit移行後の
   実装に合わせて書き直した（旧AVAudioEngine実装時代の記述が残っており、
   ジッターバッファ誤判断の直接原因になった）。成果物は`ptt-ios-README.md`
   として作成済みだが、**実際のリポジトリへの反映（`ptt-ios/ptt-ios/README.md`
   の置き換え）は未実施**のため、次アクションとして残す
3. ✅ **完了（2026-07-25）**: 他ドキュメントの棚卸しを実施。結果は以下の通り。
   - `admin-dashboard/README.md`: 記載ファイル構成・CI設定・`firebase.json`
     の内容は実コードと一致。CI/firebase.json移行の説明が「〜してください」
     という指示口調のまま残っているが、実際には反映済み（軽微な表現ズレ、
     誤解を招くリスクは低い）
   - `token-server/README.md`: ほぼ最新（テキストチャットAPI
     `POST /rooms/:roomId/messages`も既に記載済み）。
     **1点、実装と食い違う記述を発見**: 「未実装・今後の検討事項」に
     「録音の開始/停止ボタンはWeb/iOSともに別途実装が必要」とあるが、
     このREADME自体は2026-07-16更新で止まっており、その後2026-07-24の
     `rec feature`コミットでWeb版には実装済みになっている。**要修正**
     （「Web版は実装済み。iOS/Androidは未実装」に更新する）
   - `API.md` / `DATA_MODEL.md` / `UI_UX.md` / `SECURITY.md` / `AI.md`:
     見出しのみの未記入テンプレート（2026-07-17作成のまま空）。誤った
     内容が書かれているわけではなく「書かれていない」状態のため、iOS
     READMEのような誤判断を誘発するリスクは低い。ただし実装がここまで
     進んだ今、特に`API.md`・`DATA_MODEL.md`は`token-server/README.md`の
     内容を転記するだけでも価値がある（優先度は低）
4. **`token-server/README.md`の録音UI記述を修正**（項目3で判明。
   「Web/iOSともに未実装」→「Web版は実装済み、iOS/Androidは未実装」に
   一行修正するだけの軽微な作業）
5. **Guestロールの実装着手**（旧版の本項目は「要件定義に着手」としていたが、
   これは誤り。「5. Guestロール・バッジシステム 詳細仕様」で要件は既に
   確定済みであり、着手すべきは実装フェーズである。ただし「5.4」に挙げた
   GuestIDとMember昇格時のID整合性（同一IDのまま昇格するか、新規ID発行に
   なるか）は監査ログの設計に直結するため、実装着手前に確定させておく
   必要がある）
