# Phase 8: 運用機能の拡充

Phase 5(管理者ダッシュボード)を土台に、以下を追加する:

1. 監査ログ(誰が・いつ・何をしたか)
2. moderator任命API
3. 録音ファイル一覧・ダウンロードAPI
4. Firestore/GCSのデータライフサイクル管理(TTL・アーカイブ)
5. 管理者ダッシュボードへの監査ログ閲覧・権限管理UI・簡易リアルタイム更新

## 追加されたAPI一覧

| Method | Path | 認証/権限 | 説明 |
|---|---|---|---|
| POST | `/rooms/:roomId/members/:targetUid/role` | owner本人のみ | moderator/memberへのrole変更 |
| GET | `/rooms/:roomId/recordings` | メンバーのみ | 録音履歴一覧 |
| GET | `/rooms/:roomId/recordings/:recordingId/download-url` | owner/moderatorのみ | GCS署名付きダウンロードURL発行(5分間有効) |
| GET | `/admin/audit-logs` | `audit:read`権限 | 監査ログ一覧(roomId/actorUidで絞込可) |
| GET | `/admin/admins` | `admins:manage`権限 | 管理者権限台帳の一覧 |
| POST | `/admin/admins/:uid/permissions` | `admins:manage`権限 | 他ユーザーへの権限付与/剥奪(`admins:manage`自体は対象外) |

## なぜmoderator任命をowner限定にしたか

moderatorが別のmoderatorを任命・降格できる設計にすると、権限の連鎖的な
拡散を追跡しづらくなる。「誰が権限を持つ人を増やせるか」を単純に保つため、
このAPIの実行権限はowner本人のみに固定した(adminUsersの
`admins:manage`をAPI化しなかったのと同じ考え方)。ownerロール自体は
このAPIで変更できない(ownerが誤って自分をmemberに降格し、以後誰も
管理操作できなくなる事故を防ぐため)。

## Firestore TTLポリシーの有効化(初回のみ)

`routes/reports.js` と `lib/auditLog.js` は書き込み時に `expireAt` フィールドを
セットしている。以下のコマンドでTTLポリシーを有効化する
(自動計算はされないため、書き込み側での実装が必須)。

```bash
gcloud firestore fields ttls update expireAt \
  --collection-group=reports --enable-ttl

gcloud firestore fields ttls update expireAt \
  --collection-group=auditLogs --enable-ttl
```

TTL失効後の実削除は即時ではなく、通常24時間以内に非同期でバックグラウンド
実行される(削除猶予中はまだ読み取り可能な場合がある点に注意)。

`token-server/lib/roomMetadata.js` が扱う `rooms/{roomId}` 自体や
`events`(Phase4のWebhookログ)にTTLを導入する場合も同様の手順で追加できる
(README.mdの「未実装・今後の検討事項」の「eventsコレクションの肥大化対策」に対応)。

## 監査ログ検索用の複合インデックス

`GET /admin/audit-logs?roomId=...` / `?actorUid=...` は
`where + orderBy(createdAt)` の複合クエリになるため、事前にインデックスを
作成しておく必要がある。リポジトリルートの `firestore.indexes.json` に
定義済みなので、以下でデプロイする。

```bash
firebase deploy --only firestore:indexes
```

`firebase.json` の `firestore` セクションに `indexes` キーを追加済み。

## GCS(録音ファイル)のライフサイクルルール

```bash
cat > /tmp/recording-lifecycle.json <<'EOF'
{
  "rule": [
    {
      "action": { "type": "SetStorageClass", "storageClass": "COLDLINE" },
      "condition": { "age": 90 }
    },
    {
      "action": { "type": "Delete" },
      "condition": { "age": 365 }
    }
  ]
}
EOF

gcloud storage buckets update gs://<RECORDING_GCS_BUCKET> \
  --lifecycle-file=/tmp/recording-lifecycle.json
```

90日でColdline(低頻度アクセス向けの安価なストレージクラス)へ移行し、
365日で削除する。実際の保持期間は法務・利用規約と相談して調整すること。

## 録音ダウンロードURLの署名について

`GET /rooms/:roomId/recordings/:recordingId/download-url` は
`RECORDING_GCS_CREDENTIALS_JSON`(または`RECORDING_GCS_KEY_FILE`)の
サービスアカウント認証情報を使って `v4` 署名付きURLを発行する。
Cloud Run実行サービスアカウントのADCだけでは署名できないため、
`routes/recording.js` が既に使っている専用サービスアカウントの認証情報を
そのまま流用している(README.mdの「GCSアップロード用の認証情報について」
の節と同じ認証情報)。URLの有効期限は5分間に固定している(必要以上に長く
しない)。

## adminUsersへの新権限の付与

Phase8で追加した `audit:read` `admins:manage` は、既存の
`dev-tools/grant-admin-permission.js` でそのまま付与できる(コード変更不要)。

```bash
node dev-tools/grant-admin-permission.js grant <uid> audit:read
node dev-tools/grant-admin-permission.js grant <uid> admins:manage
```

`admins:manage`(他人への権限付与/剥奪API)の**付与自体**は、自己昇格・
権限エスカレーションのリスクを避けるため、意図的にAPI化せずこのスクリプト
経由の手動運用のままにしている。`POST /admin/admins/:uid/permissions` は
`permission === 'admins:manage'` のリクエストを403で拒否するようガードしている。

## 管理者ダッシュボードのリアルタイム更新について

クライアント(ブラウザ)にFirestoreリアルタイムリスナーを直接張らせる方式は
`firestore.rules` の「クライアント直接アクセス禁止」という既存方針に反するため
採用していない。まずは実装コストの低い方式として、表示中のタブを
10秒間隔でポーリングする方式を導入した(`admin-dashboard/public/index.html`)。

より即時性が必要になった場合は、token-server側でFirestoreをAdmin SDKの
`onSnapshot`で購読し、変更をSSE(Server-Sent Events)でダッシュボードへ
プッシュする「サーバー側ファンアウト」構成への切り替えを検討する。
Cloud Runは複数インスタンスへスケールしうるため、その場合は
`min-instances`の調整やリスナー数の監視が別途必要になる点に注意。

## 動作確認チェックリスト(Phase8追加分)

### moderator任命API
- [ ] owner以外(member)が`/role`を叩くと403が返る
- [ ] ownerが対象をmoderatorに変更でき、`GET /admin/rooms/:roomId`のmembers一覧でroleが更新されている
- [ ] targetがownerの場合、role変更しようとすると403が返る
- [ ] 自分自身のroleを変更しようとすると400が返る
- [ ] BAN済みメンバーのroleを変更しようとすると400が返る
- [ ] role変更のたびに`auditLogs`に`room:role_change`が記録される

### 監査ログ
- [ ] `audit:read`権限を持たないユーザーが`/admin/audit-logs`を叩くと403が返る
- [ ] BAN・role変更・録音開始/停止依頼・ダウンロードURL発行のたびに`auditLogs`へ1件追加される
- [ ] `?roomId=`で絞り込むと該当ルームの操作だけが返る(複合インデックス未作成の場合はFAILED_PRECONDITIONエラーになるので事前デプロイを確認する)
- [ ] `?actorUid=`で絞り込むと該当ユーザーの操作だけが返る
- [ ] `auditLogs`コレクションへクライアントSDKから直接読み書きしようとすると`firestore.rules`で拒否される

### 録音ファイル一覧・ダウンロードAPI
- [ ] ルームメンバーが`GET /rooms/:roomId/recordings`で過去の録音履歴を取得できる
- [ ] メンバーでないユーザーが叩くと403が返る
- [ ] owner/moderator以外が`.../download-url`を叩くと403が返る
- [ ] 発行されたURLで実際にファイルがダウンロードできる
- [ ] 発行から5分経過したURLへのアクセスが失敗する(署名の有効期限切れ)
- [ ] `egress_ended`受信後、`rooms/{roomId}/recordings/{egressId}`にstatus等が正しく保存される
- [ ] `recordings`サブコレクションへクライアントSDKから直接読み書きしようとすると`firestore.rules`で拒否される

### 権限管理UI(API)
- [ ] `admins:manage`権限を持たないユーザーが`/admin/admins`系APIを叩くと403が返る
- [ ] `permission: "admins:manage"`を指定して`POST /admin/admins/:uid/permissions`を叩くと403が返る
- [ ] `audit:read`等の権限付与が成功し、対象ユーザーが該当APIを実行できるようになる
- [ ] 権限の付与/剥奪のたびに`auditLogs`に`admin:grant`/`admin:revoke`が記録される
- [ ] ダッシュボードの「管理者権限」タブから付与操作ができ、一覧が更新される

### Firestore/GCSライフサイクル
- [ ] `gcloud firestore fields ttls update`実行後、`gcloud firestore fields ttls describe`でTTL状態が`ACTIVE`または`CREATING`になっている
- [ ] `reports`/`auditLogs`の新規ドキュメントに`expireAt`が正しくセットされている
- [ ] GCSバケットのライフサイクルルールが`gcloud storage buckets describe --format="default(lifecycle)"`で確認できる

### リアルタイム更新(ポーリング)
- [ ] ダッシュボードを開いたまま10秒待つと、別クライアントでの操作(BAN等)が自動的に反映される
- [ ] サインアウトするとポーリングが停止する(ネットワークタブで確認)
- [ ] タブを切り替えると、切り替え先のデータのみがポーリング対象になる
