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

**BANについて:** `AccessToken` のTTLは10分。Firestoreの`status`を`banned`に
書き換えるだけでは既存接続が最大10分残ってしまうため、BAN処理では
`RoomServiceClient.removeParticipant()`を同時に呼び、LiveKit接続をその場で
物理的に切断する。

**role変更について【Phase8】:** 実行権限はowner本人のみに固定
(moderatorが別のmoderatorを任命・降格することは不可)。ownerロール自体は
このAPIでは変更できない(誤操作でowner不在になる事故を防ぐため)。

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

> **[注記]** このAPI.mdはPhase8時点(2026-07-25)の内容を土台にしており、
> Phase11(組織階層 `/admin/organizations` 系)・Phase13(バッジ
> `/rooms/:roomId/badges` 系・`/admin/badges` 系)のエンドポイントはまだ
> 転記できていない(実装自体は完了済み。各`routes/*.js`のコメントが現状の
> 一次情報)。Phase16のMessage節のみ今回あわせて更新した。全体としての
> 棚卸し・転記漏れの解消は別途対応が必要(次アクションとして記録)。

---

## Report(通報)

| Method | Path | 認証 | 説明 |
|---|---|---|---|
| POST | `/reports` | 必須 | 通報の受付(対応は人力運用) |

---

## Admin

| Method | Path | 認証 | 説明 |
|---|---|---|---|
| GET | `/admin/rooms` | 必須(`rooms:monitor`) | 複数ルーム横断の一覧監視 |
| GET | `/admin/rooms/:roomId` | 必須(`rooms:monitor`) | ルーム詳細監視 |
| GET | `/admin/audit-logs` | 必須(`audit:read`) | 監査ログ一覧(roomId/actorUidで絞込可) **[Phase8]** |
| GET | `/admin/admins` | 必須(`admins:manage`) | 管理者権限台帳の一覧 **[Phase8]** |
| POST | `/admin/admins/:uid/permissions` | 必須(`admins:manage`) | 他ユーザーへの権限付与/剥奪(`admins:manage`自体は対象外) **[Phase8]** |

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
