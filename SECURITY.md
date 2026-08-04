# Security

> 見出しのみの空テンプレートだった状態から、実装済みのコード
> （`token-server/lib/permissions.js`・`firestore.rules`・`middleware/`）を
> もとに書き起こしたもの（`brushup-plan.md` 6章 次アクション item 2 対応）。

## Authentication

全クライアント共通でFirebase Authenticationを使い、`token-server`は
`Authorization: Bearer <Firebase ID Token>`を検証してリクエスト元のuidを
得る（`middleware/requireAuth.js`）。認証方式は用途によって2種類ある。

| 対象 | 認証方式 | 備考 |
|---|---|---|
| Member | メールアドレス+パスワード | README.mdのPrivacy First原則により電話番号・本名・LINE等は不要 |
| Guest | Firebase匿名認証 | `firebase.sign_in_provider==='anonymous'`をサーバー側で見てroleを自動判定（クライアントの自己申告に依存しない）。招待コードを持たない相手でも匿名認証ボタン自体は押せてしまう点は未解決の課題（`brushup-plan.md` 5.4参照） |
| admin-dashboard | Googleサインイン | Room内roleとは別軸。`adminUsers/{uid}.permissions`の有無で機能を出し分ける |

`adminUsers`コレクションを書き換えるAPIは存在せず、`dev-tools/grant-admin-permission.js`
経由でAdmin SDKを使い運用者が手動で付与/剥奪する運用に固定している
（`middleware/requireAdmin.js`）。自己昇格・権限エスカレーションを避けるため。

---

## Authorization

2つの独立した権限軸を持つ。両者は設計思想が異なる別軸として扱っており、
一つのモデルに統合してはいない（`phase12-role-operation-inventory.md` 3章）。

### Room内role（`owner` → `moderator` → `member` → `guest`）

`token-server/lib/permissions.js`の`ROOM_OPERATIONS`に一元化されている
（Phase12以前は`routes/rooms.js`・`routes/recording.js`にホワイトリストが
個別にハードコードされていた）。

| 操作 | 許可role |
|---|---|
| `members:ban`(BAN) | owner, moderator |
| `members:assign_role`(moderator任命/降格) | owner のみ |
| `room:settings_update`(自動録音トグル) | owner, moderator |
| `recording:start` / `recording:stop` | owner, moderator |
| `recording:download_url` / `recording:delete` | owner, moderator |
| `badges:grant` / `badges:revoke` | owner のみ |
| `talk:control`(送話ロック)・`chat:send`・`nickname:update`（本人のみ）・`org_context:read`・`recording:status/history:read`・`badges:read` | role不問（room memberであれば誰でも） |

`hasRoomPermission(role, operation)`は未定義のoperationを渡すと例外を投げる
フェイルファスト設計にしており、対応表に無い操作を無許可のまま通してしまう
事故を防いでいる。moderator任命/降格の対象ガード
（owner降格禁止・BAN済み対象禁止・**Guest任命禁止**）も
`checkRoleAssignmentTarget()`に一元化し、Room内owner専用APIと
admin-dashboard経由の代行API(`PATCH /admin/rooms/:roomId/members/:targetUid/role`)
の両方から参照している。GuestはFirebase匿名認証由来で本人確認が無いため、
moderatorへ任命できてしまう抜け道を塞ぐ目的で明示的に禁止している。

### サイト管理者権限（`adminUsers/{uid}.permissions`）

Room内roleと無関係に、uidごとに付与される権限文字列の配列
（例: `rooms:monitor`, `rooms:manage`, `audit:read`, `admins:manage`,
`organizations:monitor`, `organizations:manage`, `badges:manage`,
`users:monitor`）。エンドポイントごとの必要権限は`API.md`の各節を参照。

事前チェックは「全部か0か」の粗い粒度のみ実装している：サインイン直後に
`GET /admin/me`で`permissions`（サイト全体権限）と`managedOrgIds`（後述の
組織ロースター層で自分が団体管理者として登録されている団体一覧）を取得し、
両方とも0件の場合のみ`NavTabs`自体を出さず「利用する権限がありません」と
表示する（以前は`auth.currentUser`の有無だけで判定しており、任意の
Googleアカウントでサインインするだけで管理メニューの構成が見えてしまって
いた）。この事前ゲートより細かい粒度――個々のタブや画面内の操作（招待
コード表示ボタン等）を権限別に出し分ける処理――は無く、各画面はAPIを
呼んで403が返ったらエラー表示するのみという設計のままである
（Room内roleのクライアントが持つような`myRole==='owner'`判定の対になる
仕組みは、admin-dashboard側にはトップレベルのゲート以外に存在しない）。

### 組織ロースター（所属）層のスコープ付き権限

`adminUsers.permissions`とは別軸の、団体単位の権限。
`organizations/{orgId}/members/{uid}`に`orgRole: 'admin' | 'staff'`・
`scopeNodeIds`を持つ。所属はアクセス制御の軸にはせず（Roomに入れるか・
何ができるかは従来通りRoom内roleのみで決まる）、団体管理者が自団体の
状況を横断的に見るための付帯情報という位置づけ。権限判定は
`token-server/lib/orgRoster.js#resolveRosterAccess`に一元化している。

- **root**：`adminUsers/{uid}.permissions`に`organizations:manage`を持つ
  ユーザー。対象org・scopeを問わず常に許可
- **団体全体admin**：`orgRole: 'admin'`かつ`scopeNodeIds`未指定/空。
  当該org配下は無条件に許可
- **scope限定admin**：`scopeNodeIds`を指定。対象nodeまたはその配下
  （Phase11で保存済みの`ancestorIds`による祖先判定）のみ許可
- 上記いずれにも該当しない場合は403

固定の層数を列挙するのではなく、「あるuidがあるnodeIdをscopeとして持つ」
という1種類の関係を木の任意の深さに適用する再帰的スコープモデルとして
実装している（詳細は`phase11-org-roster-design.md`・`DATA_MODEL.md`参照）。

---

## Encryption

| 層 | 方式 |
|---|---|
| クライアント⇔token-server | TLS(HTTPS)。Firebase Hostingおよびtoken-serverのデプロイ先(Cloud Run等)で終端 |
| クライアント⇔LiveKit(音声・データチャネル) | DTLS-SRTP。LiveKit SDK(WebRTC)が標準で提供するメディア暗号化に委譲しており、アプリ側で独自の暗号化は行っていない |
| 保存データ(Firestore・GCS) | Google Cloudのデフォルトの保管時暗号化に依拠。アプリケーション層での追加の暗号化(フィールド単位の暗号化等)は行っていない |

---

## Privacy

README.mdのPrivacy First原則（電話番号不要・LINE交換不要・メールアドレス
非公開・本名不要・ニックネーム可）に沿って、保存する情報を最小化している。

**保存する情報**

- Firebase Authが発行するuid（全コレクション共通の識別子。専用の
  「ユーザー」コレクションは持たない、`DATA_MODEL.md`参照）
- Memberのメールアドレス（本人確認・認証用途のみ。Firebase Auth側が保持し、
  Firestore側の`members`ドキュメントには複製しない）
- 表示名(`displayName`、ニックネーム)、role、参加日時などRoomごとの
  participant情報
- チャット本文・添付ファイルメタデータ（`Message`、`DATA_MODEL.md`参照）
- 録音ファイル(GCS)とそのメタデータ、通報内容、監査ログ

**保存しない情報**

- 電話番号・本名・LINE ID等、README.mdが不要と位置づけている個人情報
- GuestのMemberへの昇格履歴・紐付け（`promotedFrom`等のフィールドは意図的に
  持たせない。GuestとMemberは常に別ID・別記録として扱う設計、
  `brushup-plan.md` 5.4参照）
- ニックネームの変更履歴（変更は即時反映されるが、監査ログ・録音の話者記録
  は内部uid基準のため追跡しない）

**保持期限**：`reports`・`auditLogs`はFirestoreのTTLポリシー
（`expireAt`フィールド）で一定期間後に自動削除。録音ファイル(GCS)は
バケットのライフサイクルルールで低頻度アクセスクラスへの移行・削除を
設定する。添付ファイルは別方式(`expiresAt`、TTLではなくクリーンアップ
スクリプト経由)を採用しており、混同しないよう意図的にフィールド名を
変えている（`DATA_MODEL.md`参照）。

---

## Audit Log

BAN・role変更・録音の開始/停止依頼・ダウンロードURL発行・管理者権限の
付与/剥奪・招待コードの閲覧といった管理系操作は、すべて`lib/auditLog.js`の
`logAdminAction()`経由で`auditLogs`コレクションへ記録される。書き込み失敗時も
本来の操作自体は失敗させないベストエフォート方式。閲覧は
`GET /admin/audit-logs`(`audit:read`権限)経由に限定し、`roomId`/`actorUid`
での絞り込みができる（複合クエリのため`firestore.indexes.json`の
インデックスを事前デプロイする必要がある）。

閲覧そのものを監査ログへ記録する設計は招待コード閲覧API
(`GET /admin/rooms/:roomId/invite-code`)にも踏襲している。これは
`GET /admin/rooms/:roomId`がRoomDetailView.vueから10秒間隔でポーリングされる
ため、そちらに招待コードを含めると画面を開いているだけで大量の閲覧ログが
記録されてしまうことを避けるため、あえて別エンドポイントに切り出した判断
（API.md参照）。

---

## Threat Model

| 脅威 | 主な対策 |
|---|---|
| なりすまし | 全リクエストでFirebase IDトークンを検証(`middleware/requireAuth.js`)。GuestはmoderatorへのroleエスカレーションをRoom内role・admin代行APIの両方で明示的に禁止(`checkRoleAssignmentTarget()`) |
| 盗聴 | クライアント⇔サーバーはTLS、音声・データチャネルはLiveKit(WebRTC)のDTLS-SRTPに委譲(「Encryption」参照) |
| 権限昇格 | Room内role対応表を`lib/permissions.js`に一元化しフェイルファスト設計に。`admins:manage`自体はAPI経由で付与/剥奪できないようガードし、手動運用に固定。Guest→Memberの昇格導線・APIは実装しない方針で恒久的に塞いでいる |
| 情報漏洩 | `firestore.rules`はクライアントからの直接読み書きを原則`false`にし、自分自身の`members/{uid}`ドキュメントの読み取りのみ例外的に許可(BAN即時反映のUI用)。BANされた瞬間`messages`の読み取り権限も同時に失う二重の強制力を持たせている。招待コードはルーム本体・admin一覧APIのいずれにも含めず、専用の権限(`rooms:manage`)と監査ログ付きの専用エンドポイントからのみ取得可能 |
| DoS | `/token`にIPベース(1分10回)・uidベース(1分20回)の2段のレート制限(`API.md`「レート制限」参照)。`/admin/admins*`等、専用のレート制限を設けていないエンドポイントも一部残っており、悪用パターンが見つかった場合に追加を検討する方針 |

未解決の既知の懸念事項は`brushup-plan.md` 5.4「洗い出された矛盾点・懸念点」
にまとめている（例: Guest認証自体の招待制化、招待コードの可視範囲の
権限設計）。
