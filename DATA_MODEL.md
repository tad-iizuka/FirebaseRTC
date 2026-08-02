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
| settings.autoRecording | boolean | Roomがアクティブになったときの自動録音設定 [Phase9] |
| orgId | string \| null | 所属する団体ID。無所属はnull [Phase11] |
| nodeId | string \| null | 団体内の所属node ID。無所属はnull [Phase11] |
| nodeAncestorIds | string[] | 所属nodeの祖先ID。階層フィルター用 [Phase11] |

---

## Participant

`rooms/{roomId}/members/{uid}`

| Field | Type | Description |
|--------|------|-------------|
| role | string | `"owner"` \| `"moderator"` \| `"member"` \| `"guest"` |
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
[組織ロースター層、実装着手 2026-08-01] `action`に`org:member_grant` /
`org:member_revoke` / `org:member_view` / `org:member_edit`を追加。
`detail`に`orgId`・`targetNodeId`・`actorType`(`'root'` \|
`'org_admin_full'` \| `'org_admin_scoped'`)・`actorScopeNodeId`・
`isOverride`を格納する(トップレベルスキーマは変更しない)。

---

## Organization / Badge

`organizations/{orgId}` [Phase11]

| Field | Type | Description |
|--------|------|-------------|
| name | string | 団体名 |
| industryProfile | string \| null | 将来の業界ラベリング用の任意プロファイル |
| ownerUid | string | 団体を作成した管理者uid |
| attachmentRetentionDays | number \| null | 添付ファイルの保持日数。null/未設定は30日 [Phase16] |

`organizations/{orgId}/nodes/{nodeId}` は任意深さの階層nodeで、`name`、
`parentNodeId`、`ancestorIds`、`depth`を持つ。

`organizations/{orgId}/members/{uid}` [組織ロースター層、実装着手
2026-08-01。`phase11-org-roster-design.md`(案C)・`brushup-plan.md`
二十四訂で確定した設計]

| Field | Type | Description |
|--------|------|-------------|
| uid | string | ドキュメントIDと同値を明示的にフィールドとしても保持(`GET /admin/me`の`managedOrgIds`が使うcollectionGroupクエリの絞り込み条件のため) |
| orgRole | `'admin'` \| `'staff'` | 団体内での役割。Room role(owner/moderator/member/guest)とは別軸 |
| scopeNodeIds | string[] | `orgRole: 'admin'`のみ意味を持つ。空配列 = 団体全体を管理。1件以上 = 列挙node配下の兼務管理。`staff`は常に空配列 |
| grantedAt | timestamp | 付与日時 |
| grantedBy | string | 付与者uid |

**Room roleとの分離**：所属(このコレクション)はアクセス制御の軸にしない。
Roomに入れるか・何ができるかはこれまで通り`rooms/{roomId}/members/{uid}`
のroleだけで決まる。所属情報は団体管理者が自団体の状況を横断的に見るための
付帯情報という位置づけ(Guestは名簿の対象外)。

**権限判定**：「団体管理者(特定orgId配下のみ管理)」というスコープ付き
権限は、`adminUsers`(サイト全体権限)とは別の再帰的スコープモデルとして
表現する。root(`adminUsers/{uid}.permissions`に`organizations:manage`を
含む)は常時override可能。org内adminは、`scopeNodeIds`が指す node の
`ancestorIds`(Phase11で計算済み・非正規化)を流用して祖先判定する
(広いscopeを持つadminが、その配下の狭いscopeを持つadminをoverride可能)。
判定ロジックは`token-server/lib/orgRoster.js#resolveRosterAccess`に
集約している。

`badges/{badgeId}` と `badgeGrants/{grantId}` [Phase13]

- `badges`はグローバルなバッジマスタで、名称、アイコン、カテゴリ、付与方式、
  優先度、有効状態を保持する。
- `badgeGrants`はユーザー単位の付与/剥奪履歴であり、同一`uid`と`badgeId`に
  対してアクティブな付与は1件だけにする。
- Guestの役割バッジは`badgeGrants`へ書き込まない仮想バッジである。

これらのコレクションはクライアントから直接読めず、token-serverの組織・
バッジAPI経由で参照する。

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
Organization / Node … Roomを任意にグループ化
Badge / BadgeGrant … Userへ付与するバッジを表す
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
