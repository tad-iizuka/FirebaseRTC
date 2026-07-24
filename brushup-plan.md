# PTTアプリ ブラッシュアップ計画（改定版）

対象リポジトリ: `tad-iizuka/FirebaseRTC`
作成日: 2026-07-09 / 改定: 2026-07-24（README.md「Vision」に基づき全面改定）

> 本改定では、アップロードされた `README.md`（"Connect to a place, not to a person."）に
> 明記されたビジョン・原則・ターゲットロードマップを"あるべき姿"の物差しとして採用し、
> 実装済みコードとの差分を再整理した。前版（初回作成）は実装状況の一般的な整理に
> 留まっていたが、本版はプロダクトビジョンとの整合性を軸に組み直している。

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
Long-Term Architectureの組織階層はまだ手つかず」** という状態にある。

## 1. 実コード確認済みの現状（README改定前の分析を上書き）

サーバー(token-server)はPhase 1〜8まで実装済み（認証・招待制ルーム・BAN・
送話ロック・録音Egress・Webhook・moderator任命API・監査ログ・管理者権限API・
GCS/FirestoreのTTL/ライフサイクル管理）。クライアント3種(Web/iOS/Android)も
BAN・送話ロック・オンボーディング・i18n・デザイントークン統一まで実装済みで、
管理者サイトもVue 3の本格SPA(`admin-dashboard/`)へ刷新済み。

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
権限管理・ログ管理はPhase8でほぼ到達済みだが、**音質・低遅延**は未着手。

- ジッターバッファ未実装（iOS README記載の通り、受信バッファを即時
  スケジュールしているのみ）。屋外・電波不安定な現場を想定するPhase1の
  用途では優先度が高い
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

---

## 3. 優先順位付きロードマップ案（README.mdのTarget Roadmapに整合）

### Phase 9: Phase1(警備業)を名実ともに完成させる
README.mdのPhase1目的（安定性・音質・低遅延）のうち、権限管理・ログ管理は
Phase8で到達済み。残る安定性・音質・低遅延と、クライアント間の機能差を埋める。

- ジッターバッファの実装（Web/iOS/Android）
- iOS: バックグラウンド動作の実機検証・本実装
- Android: ForegroundServiceの実装
- iOS/Androidへの通報UI・録音開始/停止UIの実装（Web版を移植）

### Phase 10: Permission ModelにGuestロールを追加
- Guestロールの権限要件定義（送話可否・閲覧範囲・登録なし参加の可否）
- `token-server`のrole関連API・Firestoreルールへの反映
- 3クライアントUIへのGuest導線の追加

### Phase 11: 業界ラベリング層の設計・導入
- i18nのキー構造を「言語 × 業種プロファイル」で文言を出し分けられる形へ拡張
- 警備業プロファイルを第一弾として整備し、Phase2(イベント運営等)向けの
  第二プロファイルを追加できることを検証する

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

## 4. 次アクションの提案

README.mdのビジョンと現状の差分のうち、影響範囲が限定的かつ着手しやすい
ものから始めることを推奨します。

1. **iOS/Androidへの通報UI・録音開始/停止UIの実装**（Web版の実装を移植する
   形で対応可能。3クライアントの機能差を埋める最後のピース）
2. **ジッターバッファの実装**（README.mdのPhase1が掲げる「音質」に直結し、
   かつ3クライアント共通の課題）
3. **Guestロールの要件定義**（実装より先に、権限範囲そのものの合意形成が
   必要なため、まずは仕様レベルでの検討に着手）
