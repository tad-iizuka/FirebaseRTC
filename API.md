# API

`token-server/README.md` の内容を転記・整理したもの。詳細な設計判断の背景は
リンク先の README 該当節を参照。

## 認証

全エンドポイント共通で `Authorization: Bearer <Firebase ID Token>` を必須とする
（例外は `POST /webhooks/livekit` のみ、LiveKit独自の署名検証に置き換え）。
Firebase Admin SDK (`admin.auth().verifyIdToken()`) で検証し、得られる `uid` を
以後の処理で本人として扱う。クライアント自己申告のuid相当の値は信用しない。

| Method | Path | 認証 | 説明 |
|---|---|---|---|
| GET | `/` | 不要 | ヘルスチェック |

---

## Room

| Method | Path | 認証 | 説明 |
|---|---|---|---|
| POST | `/rooms` | 必須 | ルーム作成。呼び出しユーザーがownerになる。招待コードを返す |
| POST | `/rooms/:roomId/join` | 必須 | 招待コードを検証しmembersに追加 |
| POST | `/rooms/:roomId/members/:targetUid/ban` | 必須(owner/moderatorのみ) | BAN化 + LiveKitから即時キック |
| POST | `/rooms/:roomId/members/:targetUid/role` | 必須(ownerのみ) | moderator/memberへのrole変更 **[Phase8]** |
| PATCH | `/rooms/:roomId/settings` | 必須(owner/moderatorのみ) | `autoRecording`設定を更新 **[Phase9]** |
| PATCH | `/rooms/:roomId/nickname` | 必須(本人・メンバーのみ) | 自分の表示名を更新 **[Phase10]** |
| GET | `/rooms/:roomId/org-context` | 必須(メンバーのみ) | Roomの組織階層コンテキストを取得 **[Phase11]** |
| PATCH | `/admin/rooms/:roomId/schedule` | 必須(`rooms:manage`) | Roomの開始/終了時刻(`schedule.start`/`end`)を設定・変更 **[2026-08-05追加]** |

**BANについて:** `AccessToken` のTTLは10分。Firestoreの`status`を`banned`に
書き換えるだけでは既存接続が最大10分残ってしまうため、BAN処理では
`RoomServiceClient.removeParticipant()`を同時に呼び、LiveKit接続をその場で
物理的に切断する。

**role変更について【Phase8】:** 実行権限はowner本人のみに固定
(moderatorが別のmoderatorを任命・降格することは不可)。ownerロール自体は
このAPIでは変更できない(誤操作でowner不在になる事故を防ぐため)。

**Guestについて【Phase10】:** Firebase匿名認証で参加したユーザーはサーバー側で
`guest`ロールとして判定される。Guestも送話・チャット・添付ファイル送受信はできるが、
BAN・role変更・録音・Room設定などの管理操作は実行できない。

**開始/終了時刻(Room Schedule)について【2026-08-05追加】:** `POST /admin/rooms`
（ルーム作成）は`schedule: { start, end }`（ミリ秒 or ISO文字列、いずれも省略・
`null`可）を任意で受け取れる。両方未指定なら従来通り「無期限・即入室可」。
作成後は`PATCH /admin/rooms/:roomId/schedule`で変更できる。現在の状態
(`before_start`/`in_session`/`after_end`)は`POST /rooms/:roomId/join`と
`GET /rooms/:roomId/recording/status`のレスポンスに`schedule`/`scheduleState`
として同居させている(自動録音設定・ルーム名と同じ理由。再入室のたびに
最新化する必要があるため)。`before_start`では送話・チャット送受信ともに
不可(入室と待機画面表示のみ)、`after_end`では新規入室とチャット閲覧のみ可能
(送話・チャット送信は不可)。iOS/Android版クライアントはこの機能に
まだ対応していない(Web版のみ実装済み。詳細は`brushup-plan.md`参照)。

---

## Token / Voice(送話ロック)

| Method | Path | 認証 | 説明 |
|---|---|---|---|
| GET | `/token?room=roomId` | 必須 | メンバーシップ確認後、LiveKit接続用JWTを発行 |
| POST | `/rooms/:roomId/talk/start` | 必須(メンバーのみ) | 発話ロックの取得 |
| POST | `/rooms/:roomId/talk/heartbeat` | 必須(メンバーのみ) | 発話ロックの延長 |
| POST | `/rooms/:roomId/talk/stop` | 必須(メンバーのみ) | 発話ロックの解放 |

送話ロックはクライアント側UI抑制のみに頼らず、Firestoreトランザクションで
サーバー側から実効的に強制する。取得・延長・解放のたびに現在の話者情報を
LiveKitのRoom Metadataへ書き込み、`RoomMetadataChanged`イベントとして
全クライアントへリアルタイム伝播させる。

---

## Recording(録音・Egress)

| Method | Path | 認証 | 説明 |
|---|---|---|---|
| POST | `/rooms/:roomId/recording/start` | 必須(owner/moderatorのみ) | 録音(Egress)を開始。保存先はGCS |
| POST | `/rooms/:roomId/recording/stop` | 必須(owner/moderatorのみ) | 録音の停止を依頼(確定はWebhook側) |
| GET | `/rooms/:roomId/recording/status` | 必須(メンバーのみ) | 現在の録音状態を取得 |
| GET | `/rooms/:roomId/recordings` | 必須(メンバーのみ) | 録音履歴の一覧 **[Phase8]** |
| GET | `/rooms/:roomId/recordings/:recordingId/download-url` | 必須(owner/moderatorのみ) | GCS署名付きダウンロードURL発行(5分間有効) **[Phase8]** |

LiveKitのRoom Composite Egressでルーム全体の音声を1本のファイルにミックスし、
GCSへ保存する。開始/停止はowner/moderatorのみ。**録音中であることは同意の
観点から全参加者に開示する**設計とし、送話ロックと同じRoom Metadataの仕組みに
相乗りして`recording: { active: true, startedAt }`を全クライアントへ
ブロードキャストする。

送話ロックと録音は同じRoom Metadata(単一のJSON文字列)を更新するため、
個別書き込みによるレースを避けるべく、書き込みは必ず`lib/roomMetadata.js`の
`syncRoomMetadata(roomId)`を経由し、Firestoreの`talkLock`/`recording`両方を
読み出してから1回のJSONとして合成・書き込みする。

`/recording/stop`は「停止の依頼」に過ぎない。Egressの実際の終了(成功/失敗とも)
は非同期にLiveKitから通知されるため、`recording.active`を確定的に`false`に
する処理は`/webhooks/livekit`が受け取る`egress_ended`イベントに一本化している。
古いEgressの遅延イベントで新しい録音の状態を誤って消さないよう、
Firestoreに保存された`egressId`とイベントの`egressId`が一致する場合のみ
状態を更新する。

---

## Internal【2026-08-05追加】

| Method | Path | 認証 | 説明 |
|---|---|---|---|
| POST | `/internal/rooms/sweep-expired` | `X-Internal-Sweep-Secret`ヘッダー(`INTERNAL_SWEEP_SECRET`と一致) | `schedule.end`を過ぎ未処理のRoomを検索し、順に強制退出処理(`expireRoom()`)を実行 |

Firebase Authを使わない(Cloud Scheduler等の定期実行基盤から呼ばれる想定)。
`INTERNAL_SWEEP_SECRET`は`.env.example`のコメントの通りSecret Manager経由で
Cloud Runへ渡し、GitHub Actionsのsecrets/variablesには置かない
(`LIVEKIT_API_SECRET`等と同じ運用)。推奨実行間隔は1分程度で、これは
「誰も操作しないまま自然に終了時刻を迎えたRoom」を検知するための保険であり、
管理者が明示的にスケジュールを変更した場合は`PATCH /admin/rooms/:roomId/schedule`
側で同期的に即時反映される。

---

## Webhook

| Method | Path | 認証 | 説明 |
|---|---|---|---|
| POST | `/webhooks/livekit` | LiveKit署名検証 | LiveKitからのWebhook受信(Egress終了等) |

Firebase Authを使わず、`WebhookReceiver`によるLiveKit独自の署名検証を行う。
検証には生のリクエストボディ文字列が必要なため、`server.js`では`/webhooks`
パスにのみ`express.json()`より前に`express.raw({ type: 'application/webhook+json' })`
を適用している。

---

## Message

| Method | Path | 認証 | 説明 |
|---|---|---|---|
| POST | `/rooms/:roomId/messages` | 必須(メンバーのみ、Guest可) | テキストチャット送信。`attachment`を渡すと添付ファイル付きメッセージとして送信 **[Phase16]** |
| POST | `/rooms/:roomId/attachments/upload-url` | 必須(メンバーのみ、Guest可) | 添付ファイル(画像/動画/PDF)のGCS書き込み用署名付きURL発行(5分間有効) **[Phase16]** |
| GET | `/rooms/:roomId/messages/:messageId/attachment-url` | 必須(メンバーのみ、Guest可) | 添付ファイル本体の署名付き読み取りURL発行(5分間有効) **[Phase16]** |
| GET | `/rooms/:roomId/messages/:messageId/thumbnail-url` | 必須(メンバーのみ、Guest可) | 添付ファイルのサムネイル読み取りURL発行(5分間有効) **[Phase16]** |

**添付ファイル【Phase16】:** 対応形式は画像(jpeg/png/webp/gif)・動画(mp4/mov/webm)・
PDFの3種類、1件あたり100MBまで。アップロードはtoken-serverを経由せず、
発行された署名付きURLへクライアントが直接PUTする。詳細は
`token-server/lib/attachments.js`・`token-server/phase16-operations.md`を参照。

---

## Organization

| Method | Path | 認証 | 説明 |
|---|---|---|---|
| GET | `/admin/organizations` | 必須(`organizations:monitor`) | 団体一覧 |
| GET | `/admin/organizations/:orgId/nodes` | 必須(`organizations:monitor`) | 団体配下の階層node一覧 |
| POST | `/admin/organizations` | 必須(`organizations:manage`) | 団体を作成 |
| POST | `/admin/organizations/:orgId/nodes` | 必須(`organizations:manage`) | 階層nodeを作成 |
| PATCH | `/admin/organizations/:orgId` | 必須(`organizations:manage`) | 添付ファイル保持日数を更新 **[Phase16]** |
| PATCH | `/admin/rooms/:roomId/org-assignment` | 必須(`organizations:manage`) | Roomを団体/nodeへ割り当て、または無所属へ戻す |
| GET | `/admin/organizations/:orgId/members` | 動的(下記参照) | 団体の名簿(所属)一覧 **[組織ロースター層、実装着手2026-08-01]** |
| POST | `/admin/organizations/:orgId/members/:targetUid` | 動的(下記参照) | 名簿への新規登録(所属付与) **[同上]** |
| PATCH | `/admin/organizations/:orgId/members/:targetUid` | 動的(下記参照) | 名簿エントリのrole/scope変更 **[同上]** |
| DELETE | `/admin/organizations/:orgId/members/:targetUid` | 動的(下記参照) | 名簿からの除名(所属剥奪) **[同上]** |

組織階層は`organizations`と任意深さの`nodes`で表す。Roomの組織所属は任意であり、
作成時には自動割り当てされない。

**組織ロースター(所属)API【実装着手 2026-08-01、`phase11-org-roster-
design.md`(案C)・`brushup-plan.md` 二十四訂で確定した設計】:**
`organizations/{orgId}/members/{uid}`(`orgRole: 'admin' | 'staff'`、
`scopeNodeIds`)を管理する。所属はアクセス制御の軸にせず、Roomへ入れるか・
何ができるかはこれまで通りRoom role(owner/moderator/member/guest)だけで
決まる。

上記4エンドポイントは固定の`adminUsers`権限(`requireAdminPermission`)
ではなく、`lib/orgRoster.js#resolveRosterAccess`による動的判定を使う。

- **root**：`adminUsers/{uid}.permissions`に`organizations:manage`を持つ
  ユーザー。対象のorgId・scopeを問わず常に許可される
- **団体全体admin**：`organizations/{orgId}/members/{uid}`に
  `orgRole: 'admin'`, `scopeNodeIds`未指定/空で登録されているユーザー。
  当該org配下は無条件に許可される
- **scope限定admin**：`scopeNodeIds`が指定されているユーザー。対象の
  node(またはnode配下)がそのscopeに含まれる場合のみ許可される
  (既存の`ancestorIds`による祖先判定を流用。祖先nodeへの操作は不許可、
  兄弟nodeへの操作も不許可)
- 上記いずれにも該当しない場合は403

**最初の団体管理者の代理登録(鶏卵問題)について**：専用の代理登録APIは
用意していない。`POST /admin/organizations/:orgId/members/:targetUid`は、
まだ誰も管理者登録されていない団体に対しても、root(`organizations:manage`
保持者)であればそのまま呼べる(上記の判定式が「root OR 対象orgの既存
admin」であるため)。対象uidはFirebase Authに存在する(先にMember登録
済みの)必要があり、存在しない場合は404を返す。

**PATCHでのscope拡大防止**：役割/scopeの変更時は、変更前・変更後の
両方のscopeをactorがカバーしていることを要求する(自分の管理範囲を
超えるscopeへ書き換える抜け道を塞ぐため)。

---

## Badge

| Method | Path | 認証 | 説明 |
|---|---|---|---|
| GET | `/rooms/:roomId/badges` | 必須(メンバーのみ) | Roomのアクティブメンバーのバッジ/最優先バッジ一覧 |
| POST | `/rooms/:roomId/members/:targetUid/badges` | 必須(ownerのみ) | Roomメンバーへバッジを付与 |
| DELETE | `/rooms/:roomId/members/:targetUid/badges/:badgeId` | 必須(ownerのみ) | Roomメンバーからバッジを剥奪 |
| GET | `/admin/badges` | 必須(`badges:monitor`) | バッジマスタ一覧 |
| POST | `/admin/badges` | 必須(`badges:manage`) | バッジマスタを作成 |
| PATCH | `/admin/badges/:badgeId` | 必須(`badges:manage`) | バッジマスタを更新・無効化 |
| GET | `/admin/config/badge-display` | 必須(`badges:monitor`) | 表示件数設定を取得 |
| PATCH | `/admin/config/badge-display` | 必須(`badges:manage`) | 表示件数設定を更新 |
| GET | `/admin/rooms/:roomId/badges` | 必須(`badges:monitor`) | 管理画面向けRoomバッジ一覧 |

`badges`と`badgeGrants`はクライアントから直接読めない。参加者一覧はこのAPIで
返す判定済みの`topBadge`を表示する。

---

## Report(通報)

| Method | Path | 認証 | 説明 |
|---|---|---|---|
| POST | `/reports` | 必須 | 通報の受付(対応は人力運用) |

---

## Admin

| Method | Path | 認証 | 説明 |
|---|---|---|---|
| GET | `/admin/me` | 必須(権限は問わない) | 自分自身の権限一覧を取得 **[2026-07-31、item3対応]** |
| GET | `/admin/rooms` | 必須(`rooms:monitor`) | 複数ルーム横断の一覧監視 |
| GET | `/admin/rooms/:roomId` | 必須(`rooms:monitor`) | ルーム詳細監視 |
| GET | `/admin/rooms/:roomId/invite-code` | 必須(`rooms:manage`) | 招待コードの取得(閲覧のたびに監査ログへ記録) **[招待コードのadmin-dashboard移管]** |
| GET | `/admin/audit-logs` | 必須(`audit:read`) | 監査ログ一覧(roomId/actorUidで絞込可) **[Phase8]** |
| GET | `/admin/admins` | 必須(`admins:manage`) | 管理者権限台帳の一覧 **[Phase8]** |
| POST | `/admin/admins/:uid/permissions` | 必須(`admins:manage`) | 他ユーザーへの権限付与/剥奪(`admins:manage`自体は対象外) **[Phase8]** |
| GET | `/admin/users` | 必須(`users:monitor`) | メールアドレスを持つユーザーの検索一覧 |
| GET | `/admin/users/:uid` | 必須(`users:monitor`) | ユーザープロフィールと保持バッジ |
| POST | `/admin/users/:uid/badges` | 必須(`badges:manage`) | ユーザーへバッジを付与 |
| DELETE | `/admin/users/:uid/badges/:badgeId` | 必須(`badges:manage`) | ユーザーからバッジを剥奪 |

**監査ログ【Phase8】:** BAN・role変更・録音の開始/停止依頼・ダウンロードURL発行・
管理者権限の付与/剥奪といった管理系操作は、すべて`lib/auditLog.js`の
`logAdminAction()`経由で`auditLogs`コレクションへ記録される(書き込み失敗時も
本来の操作自体は失敗させないベストエフォート方式)。`roomId`/`actorUid`での
絞り込みは複合クエリになるため、`firestore.indexes.json`のインデックスを
事前にデプロイしておく必要がある。

**管理者権限の管理【Phase8】:** `admins:manage`自体はこのAPIでは付与/剥奪
できないようガードしている(自己昇格・権限エスカレーション防止)。
`admins:manage`の付与は`dev-tools/grant-admin-permission.js`経由の手動運用に
固定している。

**`GET /admin/rooms/:roomId/invite-code`【招待コードのadmin-dashboard移管】:**
招待コードは従来`POST /rooms`(または`POST /admin/rooms`)作成時のレスポンス
でしか返却されず、以降どのAPIからも再取得できなかった
(brushup-plan.md 5.4「招待コードの可視範囲」)。この課題を解消するために
追加したエンドポイントだが、`GET /admin/rooms/:roomId`(`rooms:monitor`)とは
あえて分離し、以下2点を満たす設計にしている。

- 要求権限は`rooms:monitor`ではなく、より強い`rooms:manage`。
  `rooms:monitor`保有者全員に「Roomへの参加権を事実上配布できる」権限まで
  広げないため
- 呼び出しのたびに`logAdminAction()`で`room:invite_code_viewed`として
  監査ログに記録する。`GET /admin/rooms/:roomId`はRoomDetailView.vueから
  10秒間隔でポーリングされているため、そちらに招待コードを含めると画面を
  開いているだけで大量の閲覧ログが記録されてしまう。そのため専用の
  エンドポイントに切り出し、admin-dashboard側は「表示」ボタン押下など
  ユーザーの明示的な操作でのみ呼び出す

**`GET /admin/me`【2026-07-31追加、brushup-plan.md item3(論点5)対応】:**
特定の管理者権限を要求せず、サインインしてさえいれば誰でも呼べる。目的は
「自分が何の権限を持っているか」をクライアント側が把握できるようにし、
admin-dashboardが権限を1つも持たないユーザーに対してNavTabs自体を出さない
ようにするため(以前は`auth.currentUser`の有無だけで画面を出し分けており、
任意のGoogleアカウントでサインインするだけで管理画面のメニュー構成が
見えてしまっていた)。`adminUsers/{uid}`が未作成の場合も含め、常に配列
(空配列もありうる)を返す。他人の権限体系を開示するものではない。

レスポンスは`{ uid, email, permissions, managedOrgIds }`。
`managedOrgIds`【2026-08-01追加、item5(組織ロースター層)対応】は自分が
`orgRole: 'admin'`として名簿登録されている団体の`orgId`一覧
(scopeNodeIdsの有無・中身は含まない)。root(`organizations:manage`
保持者)であっても、自分自身が名簿に登録されていなければ含まれない。

---

## レート制限

`/token`には、IPベース(1分10回)と認証後のuidベース(1分20回)の2段の
レート制限をかけている。IPベースは未認証段階での連打・スキャン対策、
uidベースはNAT配下で複数の正規ユーザーが同一IPになるケースを考慮して
少し緩めにしている。

**[Phase8]** `/admin/audit-logs` / `/rooms/:roomId/recordings*` /
`/admin/admins*` には現状専用のレート制限をかけていない。悪用パターンが
見つかった場合に`uidRateLimiter`相当の仕組みの追加を検討する。

---

## Error Codes

README本文には専用のエラーコード一覧表はないため、動作確認チェックリストから
確認できている代表的なステータスコードを記載する(網羅ではない)。

| Code | 説明 |
|-------|-------------|
| 401 | `Authorization`ヘッダーなし/不正・期限切れのID Token/Webhook署名不正 |
| 403 | 権限不足(メンバーでない、owner/moderatorでない、対象がownerなど)、誤った招待コード |
| 400 | 自分自身をrole変更/通報の対象にした場合、BAN済み対象へのrole変更 |
| 409 | 送話ロック取得済み(`talk_locked`)、録音中の重複開始 |
| 429 | レート制限超過(`/token`への同一IPからの連打など) |
| 500 | GCSアップロード用サービスアカウントに書き込み権限がない場合など
      (この場合Firestore側の`recording`は`null`に戻し、仮登録状態を残さない) |
