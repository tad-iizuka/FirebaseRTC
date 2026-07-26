# Phase13: バッジ基本機能 Firestoreスキーマ案

作成日: 2026-07-26
対象: `brushup-plan.md` Phase13（バッジシステムの基本機能）
参照元仕様: `brushup-plan.md` 「5.3 バッジシステム」「6. 次アクションの提案」item 2

**実装状況（2026-07-26、二十訂）**: 本スキーマ案に基づき、token-server・
admin-dashboard・ptt-client(Web)への実装が完了した。「8.」の
firestore.rules方針は実装時に一部変更しており（badgesも含めクライアント
直接読み取り不可へ統一）、該当箇所に取消線で反映している。iOS/Androidの
バッジ表示UIと、3クライアント共通のRoom内owner向け付与/剥奪UIは未実装
（`brushup-plan.md`「6. 次アクションの提案」item3・4参照）。

## 0. 前提・スコープ

- 本案はPhase13時点のスコープに限定する。**団体（Company/Branch等）単位での
  マスタ切り替え・業種プロファイル単位の複数マスタ管理はPhase15へ持ち越し**、
  ここでは団体IDを持たないシンプルな1マスタ構成とする。**（2026-07-26
  追記）** 本前提は当初、`brushup-plan.md`内で「Phase13本文はバッジマスタを
  団体単位で保持するとしている」という記述と矛盾していたが、(1)団体単位の
  マスタ出し分けに必要な「ユーザー×団体の所属関係」がPhase11で明示的に
  着手対象外とされていること、(2)マスタ管理が「業種プロファイル
  （テンプレート）→団体（個別上書き）」の二階層構造であり団体単位の
  上書きは業種プロファイル基盤（Phase15）が前提となること、の2点の検討を
  経て、団体IDなしの本前提が正として確定した（詳細は`brushup-plan.md`
  「5.4」「6.1」item 14参照）。
- Phase10で実装済みの「Guestバッジ（自分自身のみ表示）」は現状UI側のみの
  簡易実装であり、Firestore上にバッジとして永続化されていない。本案では
  これを「役割バッジ」として本バッジシステムに統合できる形にするが、
  **実際の統合（既存UIの置き換え）は本スキーマ設計のスコープ外**とし、
  別途実装タスクとして切り出すことを推奨する。
- 自動付与条件は「5.3」の通り技能章・部隊章・階級章等を将来含むが、
  Phase13で先行実装するのは**業種に依存しない最小限の条件のみ**。本案では
  条件定義のフィールドは持たせつつ、条件の中身（判定ロジック）は
  最小限（例: 経過日数ベース等）を想定した拡張可能な形にとどめる。

## 1. コレクション設計概要

```
badges/{badgeId}                      … バッジマスタ（団体スコープなし）
badgeGrants/{grantId}                 … 付与・剥奪の実記録（履歴を保持）
config/badgeDisplay                   … 表示設定（最大表示数等）
```

Guestの役割バッジは実グラント（`badgeGrants`への書き込み）にはせず、
`role === 'guest'` から都度算出する「仮想バッジ」として扱う（詳細は3節）。
理由: Guestは入退室のたびに大量に発生しうるため、都度付与・失効の書き込みを
発生させたくない。役割バッジは本人のroleに完全従属する性質であり、
永続化する意味がない。

## 2. `badges`（バッジマスタ）

```
badges/{badgeId}
```

| フィールド | 型 | 説明 |
|---|---|---|
| `name` | string | 表示名（例:「優秀対応賞」「〇〇資格保有」） |
| `icon` | string | アイコン識別子（絵文字コードポイント、またはアイコンキー） |
| `description` | string \| null | バッジの説明（プロフィール画面での補足表示用、未設計につき任意） |
| `category` | `'role' \| 'skill' \| 'unit' \| 'rank' \| 'other'` | 5.3の「技能章・部隊章・階級章」等の分類。`role`はGuest等の役割系（本マスタには通常登録しない。3節参照） |
| `grantMethod` | `'manual' \| 'auto' \| 'both'` | 付与経路。手動のみ／自動のみ／両方許可 |
| `autoGrantCondition` | object \| null | `grantMethod`が`auto`/`both`の場合の条件定義。Phase13は最小限の条件型のみ実装（下記2.1参照） |
| `priority` | number | 表示優先順位。値が大きいほど優先表示（Room内・参加者一覧では最優先1件のみ表示するための基準） |
| `active` | boolean | マスタとして現在有効かどうか（false = 廃止済み、新規付与不可。既存付与は影響を受けない） |
| `createdAt` / `updatedAt` | timestamp | |
| `createdBy` | string (uid) | マスタ作成者（Owner想定） |

### 2.1 `autoGrantCondition`（Phase13最小構成）

Phase13では業種非依存の最小条件のみ対象とする。将来の拡張性のため
`type`によるバリアント形式にしておく。

```jsonc
// 例: 参加からの経過日数
{
  "type": "daysSinceJoin",
  "days": 90
}

// 例: 累計送話時間（分）
{
  "type": "cumulativeTalkMinutes",
  "minutes": 600
}
```

`type`の集合はPhase13実装時点で判明している最小条件に限定し、判定不能な
`type`はバッチ側でスキップ（エラーにはしない）。技能章・部隊章のような
業種依存条件（資格の種類、所属部隊の指定等）はPhase15で`type`を追加する形
で拡張する想定とし、本Phaseでは条件の「型」だけ用意して中身は空でもよい。

## 3. Guestの役割バッジ（仮想バッジ、マスタ非永続）

Guestは「役割バッジ（Guestである表示）」のみが付与対象（5.3）。これは
`role`フィールドから一意に決まり、失効判断も不要（Guestでなくなる＝
role変更ではなくRoom退出/セッション終了のため）なので、`badgeGrants`への
書き込みは行わず、表示側で以下のように合成する。

```jsonc
// アプリケーション定数として保持（Firestoreに書かない）
const ROLE_BADGES = {
  guest: { badgeId: "role:guest", name: "Guest", icon: "🔰", priority: <役割バッジ用の固定優先度> }
};
```

表示ロジック（4節のクエリ想定と合わせて）：

```
displayBadges = [
  ...(member.role === 'guest' ? [ROLE_BADGES.guest] : []),
  ...(badgeGrantsから取得したactiveなバッジ)
].sort by priority desc
```

将来、Member側にも役割バッジ（例: Moderator章）を持たせたくなった場合は
同じ仮想バッジパターンで拡張できる。

## 4. `badgeGrants`（付与・剥奪レコード）

```
badgeGrants/{grantId}   // grantId は自動採番（履歴を残すため決定的IDにしない）
```

| フィールド | 型 | 説明 |
|---|---|---|
| `uid` | string | 付与対象のユーザーID |
| `badgeId` | string | `badges`ドキュメントID |
| `status` | `'active' \| 'revoked'` | 現在の状態 |
| `grantMethod` | `'manual' \| 'auto'` | 今回の付与がどちらの経路か |
| `grantedBy` | string | `'system:<batchRunId>'`（自動時）または付与したOwnerのuid（手動時） |
| `grantedAt` | timestamp | |
| `revokedBy` | string \| null | `'system:<batchRunId>'`またはuid。剥奪時のみ |
| `revokedAt` | timestamp \| null | |
| `revokeReason` | string \| null | 任意（手動剥奪時の理由メモ等） |
| `sourceConditionSnapshot` | object \| null | 自動付与時、その時点の`autoGrantCondition`のスナップショット（後日マスタの条件が変更されても、何を満たして付与されたかを追跡できるようにするため） |

### 4.1 「同一バッジの重複付与・上書き」の扱い

5.3の「失効・剥奪は... 取消・上書き可能」に対応するため、以下のルールとする。

- 同一`uid`×`badgeId`について、**同時にstatus=`active`なレコードは1件のみ**
  とする（アプリケーション側で担保。Firestore側での一意制約は張れないため、
  書き込み時にトランザクションで既存activeレコードの有無を確認する）
- 再付与（一度剥奪されたバッジを再度付与）は、既存レコードを更新するのでは
  なく**新しいドキュメントを追加**する。これにより「いつ剥奪され、いつ
  再付与されたか」の履歴がそのまま残る（Phase8監査ログ基盤との連携要件、
  5.4参照）
- 「上書き」（Owner手動 → System自動、あるいはその逆）は、既存activeレコード
  を`revoked`にした上で新規`active`レコードを追加する形で表現する

### 4.2 現在有効なバッジの取得クエリ

```
badgeGrants
  where uid == <対象uid>
  where status == 'active'
```

複合インデックス: `(uid ASC, status ASC)` が必要。加えてプロフィール画面での
優先順位表示のため、取得後にアプリ側で`badges.priority`と突き合わせて
ソートする（`badgeGrants`自体は`priority`を持たないため、`badges`を
別途batch getする）。

### 4.3 Room内・参加者一覧での「最優先1件のみ表示」

Room参加者一覧はメンバー数が限られるため、参加者ごとに上記4.2のクエリを
都度発行するのは非効率。Phase13では以下のいずれかを採用する（実装時に選定）。

- **案A（読み取り時計算）**: 参加者一覧表示時、対象uid一覧に対して
  `badgeGrants`を`where uid in [...]`（最大30件までのFirestore制約に注意）
  でまとめて取得し、クライアント/サーバー側でuidごとにpriority最大の1件を
  算出する
- **案B（非正規化キャッシュ）**: `members/{uid}`ドキュメント（既存の
  Room参加者コレクション）に`topBadge: { badgeId, icon, priority }`を
  非正規化フィールドとして持たせ、付与/剥奪時に該当uidの全Room参加中
  メンバードキュメントを更新する

Phase13時点ではバッジ運用量が少ない想定のため**案Aを先行実装**し、
Room参加者数やバッジ付与頻度が増えて性能課題が出た場合に案Bへ移行する
方針を推奨する（5.4の「自動付与の遅延と手動付与の即時性のギャップ」の
UI文言対応とあわせて検討）。

## 5. `config/badgeDisplay`（表示設定）

```
config/badgeDisplay   // 単一ドキュメント
```

| フィールド | 型 | 説明 |
|---|---|---|
| `maxDisplayCount` | number | プロフィール画面での最大表示件数（5.3「業種プロファイル単位で設定」だが、Phase13は団体・業種スコープがないため単一のグローバル値） |
| `updatedAt` | timestamp | |
| `updatedBy` | string (uid) | |

Phase15で団体・業種プロファイル単位の切り替えが必要になった際は、
このドキュメントを`config/badgeDisplay/{orgId}`または
`organizations/{orgId}`配下のフィールドへ移行する想定（6節参照）。

## 6. Phase15への拡張ポイント（設計時の申し送り）

Phase15で「団体単位でのマスタ切り替え」「業種プロファイル単位の
自動付与条件出し分け」が入る際、Phase13スキーマへの変更点を以下に
あらかじめ記録しておく（後方互換を意識した設計判断）。

- `badges`に`orgId`（またはPhase11の組織階層ノードID）フィールドを追加し、
  未設定＝全団体共通のグローバルマスタとして扱えるようにしておく
  （Phase13で作成したバッジは`orgId`未設定のまま自動的に「共通バッジ」
  として扱われる形にできると移行コストが低い）
- `autoGrantCondition.type`に業種依存の条件バリアントを追加する
  （資格種別、部隊指定等）。Phase13で用意した「バリアント形式」を
  そのまま踏襲できる
- `config/badgeDisplay`を団体単位に分割する（5節参照）

## 7. 監査ログ（Phase8基盤）との連携

- `badgeGrants`への書き込み（付与・剥奪いずれも）は、Phase8で確立済みの
  `logAdminAction`相当の仕組みを呼び出し、アクション種別
  `badge.grant` / `badge.revoke`、対象`uid`、`badgeId`、実行者
  （`grantedBy`/`revokedBy`と同一値）を記録する
- 自動付与バッチ（`system:<batchRunId>`）についても同様に監査ログへ記録し、
  「どのバッチ実行が何件付与したか」を`batchRunId`で後から追跡できるように
  する（5.4「バッジ付与・失効の履歴管理」に対応）

## 8. firestore.rules方針

**（2026-07-26 実装時に変更）** 当初案は以下の通り「badges/config/badge
Displayは全クライアント読み取り可」としていたが、実装時に撤回し、
**badges/badgeGrants/configのいずれもクライアント直接読み取り不可
（Admin SDK経由のAPIのみ）に統一した**。理由は、参加者一覧の「最優先1個
のみ表示」判定（badgeGrantsとbadgesの突き合わせ・Guest仮想バッジの合成）
をWeb/iOS/Android 3クライアントそれぞれで再実装させると、Phase12で
問題視した「同じロジックの分散実装」を再発させてしまうため。判定済みの
結果（topBadge等）を返すAPI（`GET /rooms/:roomId/badges`,
`GET /admin/rooms/:roomId/badges`）に一本化し、Phase15で団体・業種
プロファイル単位のマスタ切り替えが入った際も変更箇所をサーバー側だけに
閉じ込められるようにした（`brushup-plan.md`二十訂、
`token-server/lib/badges.js`冒頭コメント参照）。

~~- `badges`: 全クライアント読み取り可（プロフィール画面・参加者一覧での
  アイコン/優先度参照のため）。書き込みは不可（Admin SDK経由、
  Owner操作もtoken-server経由でのみ許可）~~
- `badges`: **（訂正）** クライアントからの直接読み取りは不可。
  書き込みも不可（Admin SDK経由、`/admin/badges*`のみ）
- `badgeGrants`: クライアントからの直接読み取りは**不可**とし、
  token-server側でuidごとにフィルタしたレスポンスを返すAPI経由とする
  （5.4「他参加者の情報公開範囲」の議論とも関連するため、Phase12の
  role×操作整理と合わせて公開範囲を最終決定する）
  → **実装確定**: 公開する情報はバッジ(役割表示のみ)に限定し、
  displayName等の追加情報は含めない設計とした（`brushup-plan.md`
  「5.4」参照。Web版はこれによりGuestバッジの他参加者への表示が
  副次的に解消された）
- ~~`config/badgeDisplay`: 全クライアント読み取り可、書き込み不可
  （Admin SDK経由）~~
- `config/badgeDisplay`: **（訂正）** クライアントからの直接読み取りは
  不可。閲覧は`GET /admin/config/badge-display`(badges:monitor権限)経由

## 9. 未確定事項（実装着手前に確認したい点） → 2026-07-26 二十訂で解消

1. ~~**Guestの役割バッジを本バッジシステムへ統合するか**~~ → **解消**:
   Phase10実装済みの既存UI（自分自身のみのGuest表示。`GuestStatusBar.vue`
   等）はそのまま残し、置き換えは行わなかった。本バッジシステムの
   仮想バッジは参加者一覧（他者から見える表示）に新規追加する形とし、
   両者は並行して存在する
2. ~~**`badgeGrants`の他人からの可視範囲**~~ → **解消**: 上記「8.」の通り、
   badges/badgeGrants双方を直接非公開とし、topBadge等の判定済み結果のみ
   APIで返す方針に統一した。Phase12のrole×操作整理を待たずに確定した
   （公開情報をバッジ表示に限定することで、他ユーザー情報の追加公開を
   避けられたため）
3. **バッチ処理の実行主体・頻度**：「1日以内に付与」という要件（5.3）を
   満たす具体的なジョブ実行基盤（Cloud Functions scheduled function等）は
   本スキーマ案の範囲外。別途インフラ側の設計が必要
