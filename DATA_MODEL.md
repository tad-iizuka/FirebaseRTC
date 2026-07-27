# Data Model

`token-server/README.md`「データモデル (Firestore)」節の内容を転記・整理した
もの。クライアントからFirestoreへの直接書き込みは一切許可しない
(`firestore.rules`参照)。ルーム作成・参加・BAN・送話ロック・録音の開始/停止は
すべてこのサーバーのAPI(Admin SDK経由)でのみ行われる。例外として、自分自身の
`members/{uid}`ドキュメントの読み取りだけはクライアントに許可している
(リアルタイムリスナーで「自分がBANされたこと」を即座にUIへ反映するための
補助。BAN自体の強制力はLiveKit側の即時キックが担う)。

## User / Identity

専用のFirestoreコレクションは持たない。Firebase Authが発行する`uid`を
「そのユーザー本人」の識別子として全コレクションで共通利用する
(`Authorization: Bearer <Firebase ID Token>`を検証して得る)。

---

## Room

`rooms/{roomId}`

| Field | Type | Description |
|--------|------|-------------|
| ownerUid | string | ルーム作成者のuid |
| createdAt | timestamp | 作成日時 |
| visibility | string | `"invite_only"` 固定 |
| inviteCode | string | 8文字の英数字 |
| maxMembers | number | 定員 |
| talkLock | `{ uid, acquiredAt, expiresAt }` \| null | 送話ロックの状態 [Phase2で追加] |
| recording | `{ active, egressId, startedAt, startedByUid }` \| null | 現在進行中の録音1件のみ保持 [Phase5で追加] |

---

## Participant

`rooms/{roomId}/members/{uid}`

| Field | Type | Description |
|--------|------|-------------|
| role | string | `"owner"` \| `"moderator"` \| `"member"` |
| displayName | string | 表示名 |
| status | string | `"active"` \| `"banned"` |
| joinedAt | timestamp | 参加日時 |

---

## Message

`rooms/{roomId}/messages/{messageId}` [Phase5で追加、Phase16でattachment追加]

| Field | Type | Description |
|--------|------|-------------|
| uid | string | 送信者uid |
| displayName | string | 送信者表示名 |
| text | string | 本文(添付のみの場合は空文字) |
| createdAt | timestamp | 送信日時 |
| attachment | map \| なし | 添付ファイル(画像/動画/PDF)。無い場合はフィールド自体が存在しない **[Phase16]** |

`attachment`の内部構造:

| Field | Type | Description |
|--------|------|-------------|
| storagePath | string | GCS上の保存パス(本体) |
| thumbnailPath | string \| null | GCS上のサムネイル保存パス。生成失敗時はnull |
| contentType | string | GCS実体から取得した実際のMIMEタイプ(クライアント自己申告値ではない) |
| kind | 'image' \| 'video' \| 'pdf' | 内部区分 |
| fileName | string | サニタイズ済みファイル名 |
| size | number | GCS実体から取得したバイト数 |
| expiresAt | timestamp | 保持期限。`dev-tools/cleanup-expired-attachments.js`が過ぎたものを削除する |

---

## Recording

`rooms/{roomId}/recordings/{egressId}` [Phase8で追加]

| Field | Type | Description |
|--------|------|-------------|
| egressId | string | Egress ID |
| filepath | string | GCS上の保存パス |
| startedAt | timestamp | 開始日時 |
| endedAt | timestamp | 終了日時 |
| status | string | 終了ステータス |
| startedByUid | string | 開始操作を行ったuid |

`routes/webhooks.js`の`handleEgressEnded()`が`egress_ended`受信時に書き込む、
録音の「確定した履歴」。`rooms/{roomId}.recording`が「現在進行中の録音1件」
しか保持しないのに対し、こちらは過去分を含めて蓄積される。

---

## Event

`events`コレクション(Webhookログ、Phase4で追加)。README本文の
データモデル節には未記載だが、「未実装・今後の検討事項」節で言及あり:
現状TTLが未導入で、`reports`/`auditLogs`と同じ手順で追加できるとされている。

---

## Report(通報)

`reports/{reportId}`

| Field | Type | Description |
|--------|------|-------------|
| reporterUid | string | 通報者uid |
| reportedUid | string | 被通報者uid |
| roomId | string | 対象ルームID |
| reason | string | 理由 |
| status | string | 対応状況 |
| createdAt | timestamp | 通報日時 |
| expireAt | timestamp | TTL用 [Phase8で追加] |

---

## Admin / 権限管理

`adminUsers/{uid}` [Phase5で追加]

| Field | Type | Description |
|--------|------|-------------|
| permissions | string[] | 例: `["rooms:monitor", "audit:read", "admins:manage"]` |
| grantedAt | timestamp | 付与日時 |
| note | string | 備考 |

`auditLogs/{logId}` [Phase8で追加]

| Field | Type | Description |
|--------|------|-------------|
| actorUid | string | 操作者uid |
| action | string | 操作種別 |
| targetRoomId | string | 対象ルームID |
| targetUid | string | 対象uid |
| detail | object/string | 詳細 |
| createdAt | timestamp | 記録日時 |
| expireAt | timestamp | TTL用 |

`lib/auditLog.js`の`logAdminAction()`が管理系操作のたびに書き込む。

---

## Notification

README本文に該当コレクションの記載なし。「未実装・今後の検討事項」節で
プッシュ通知は今後の実装対象とされている。

---

## Relationships

```
Room
 ├─ Participant (members/{uid})
 ├─ Message (messages/{messageId})
 └─ Recording (recordings/{egressId})

Report … Room / Participant を roomId・reporterUid・reportedUid で参照
AdminUser / AuditLog … Room横断で管理者操作を扱う
```

---

## データライフサイクル【Phase8】【Phase16】

`reports`と`auditLogs`は書き込み時に`expireAt`フィールドをセットしており、
FirestoreのTTLポリシーを有効化することで一定期間後に自動削除される。
録音ファイル本体(GCS)にはバケットのライフサイクルルールで、一定期間後に
低頻度アクセスクラスへの移行・削除を設定する。具体的な`gcloud`コマンドは
`phase8-operations.md`にまとめられている。

**[Phase16] 添付ファイルは同じ`expireAt`/TTL方式を採用していない。**
フィールド名も意図的に`expiresAt`(Phase8の`expireAt`とは綴りを変えている)
としており、これは表記揺れではなく設計上の区別である。TTLはFirestore
ドキュメントの自動削除のみを行い、そのタイミングでGCS側のファイル実体
(`storagePath`/`thumbnailPath`)を削除する機会を与えてくれない。そのため
添付ファイルについては`dev-tools/cleanup-expired-attachments.js`が
「GCS実体を消してからFirestoreドキュメントを消す」順序を明示的に制御する
運用とした。詳細は`token-server/phase16-operations.md`を参照。
