# Phase 16: チャット添付ファイル(Image/File Event)運用メモ

Text Event(Phase5)に画像・動画・PDFの添付を追加する。要件のたたき台は
`brushup-plan.md`「7. Image/File Event要件たたき台」を参照。実装本体は
`lib/attachments.js`・`routes/messages.js`。

## 追加されたAPI一覧

| Method | Path | 認証/権限 | 説明 |
|---|---|---|---|
| POST | `/rooms/:roomId/attachments/upload-url` | メンバーのみ(Guest可) | GCS書き込み用の署名付きURL発行(5分間有効) |
| POST | `/rooms/:roomId/messages` | メンバーのみ(Guest可) | `attachment`を渡すとGCS実体を検証しメッセージとして確定 |
| GET | `/rooms/:roomId/messages/:messageId/attachment-url` | メンバーのみ(Guest可) | 添付本体の署名付き読み取りURL発行(5分間有効) |
| GET | `/rooms/:roomId/messages/:messageId/thumbnail-url` | メンバーのみ(Guest可) | サムネイルの署名付き読み取りURL発行(5分間有効) |
| PATCH | `/admin/organizations/:orgId` | `organizations:manage`権限 | 団体単位の添付ファイル保持日数(`attachmentRetentionDays`)を設定 |

## GCS側の準備(初回のみ)

録音機能(`RECORDING_GCS_BUCKET`)とは**別の専用バケット・専用サービス
アカウント**を用意する。同じバケットに同居させない理由: 保持期間の考え方
(録音は現状ライフサイクルルールでの移行/削除、添付は団体単位で可変の
削除ポリシー)が異なり、IAM権限のスコープも分けておいた方が事故時の影響を
限定できるため。

```bash
# 添付ファイル保存用のバケットを作成
gcloud storage buckets create gs://your-attachments-bucket --location=asia-northeast1

# アップロード/ダウンロード/削除用のサービスアカウントを作成し、キーを発行
gcloud iam service-accounts create ptt-attachments-uploader \
  --display-name="PTTチャット添付ファイル用"

gcloud storage buckets add-iam-policy-binding gs://your-attachments-bucket \
  --member="serviceAccount:ptt-attachments-uploader@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/storage.objectAdmin"

gcloud iam service-accounts keys create attachments-service-account.json \
  --iam-account="ptt-attachments-uploader@YOUR_PROJECT_ID.iam.gserviceaccount.com"
```

発行した `attachments-service-account.json` の中身(JSON全体)をSecret Manager
に登録し(`recording-gcs-credentials`と同じ手順)、Cloud Runの環境変数
`ATTACHMENTS_GCS_CREDENTIALS_JSON` にマウントする。ローカル開発時は
`ATTACHMENTS_GCS_KEY_FILE` にファイルパスを指定してもよい
(`lib/gcsCredentials.js`が両対応)。

バケット名自体は `ATTACHMENTS_GCS_BUCKET` 環境変数で指定する。

### CORS設定(ブラウザから直接PUTするため)

Web版(`ptt-client`)はブラウザから署名付きURLへ直接PUTする。バケットの
CORS設定でPTTアプリのオリジンからの`PUT`を許可しておく必要がある。

```bash
cat > cors.json << 'EOF'
[
  {
    "origin": ["https://your-ptt-client-domain.example"],
    "method": ["PUT"],
    "responseHeader": ["Content-Type"],
    "maxAgeSeconds": 3600
  }
]
EOF

gcloud storage buckets update gs://your-attachments-bucket --cors-file=cors.json
```

## サムネイル生成の依存パッケージについて

`lib/attachments.js`のサムネイル生成は以下を使う(いずれもpackage.jsonに
追加済み):

- 画像: `sharp`
- 動画(1秒地点のフレーム抽出): `ffmpeg-static` + `fluent-ffmpeg`
  (`ffmpeg-static`はビルド済みバイナリをnpmパッケージ自体に同梱するため、
  Dockerイメージ側でのffmpegインストールは不要)
- PDF(1ページ目のレンダリング): `pdfjs-dist`(legacyビルド、Node(CommonJS)
  からrequireできるよう `3.11.174` にバージョン固定) + `canvas`

`canvas`はprebuiltバイナリを使うが、実行時にcairo/pango/jpeg/gif/rsvg等の
共有ライブラリを要求する。`Dockerfile`に`apt-get install`を追加済み
(ビルドツール一式は不要、ランタイム分のみ)。

サムネイル生成はいずれもベストエフォート(失敗してもメッセージ送信自体は
続行する。クライアント側は生成失敗時に汎用アイコン表示へフォールバックする
想定)。

## 添付ファイルの保持期間・削除について

**[なぜFirestore標準のTTL機能(`reports`/`auditLogs`が使う`expireAt`)を
使わないか]** 標準TTLはFirestoreドキュメントの自動削除のみを行い、GCS側の
ファイル実体までは連動して消してくれない。ドキュメントが消えた後では
`storagePath`が分からず孤児オブジェクトが残るため、添付ファイルについては
専用のクリーンアップスクリプトで「GCS実体を消してからFirestoreドキュメントを
消す」順序を明示的に制御する。

```bash
# 動作確認(実際には削除しない)
node dev-tools/cleanup-expired-attachments.js --dry-run

# 実行
node dev-tools/cleanup-expired-attachments.js
```

Cloud Scheduler + Cloud Run Jobs(または任意のcron環境)から1日1回程度の
頻度で実行する運用を想定する。このスクリプトは`token-server`本体の
デプロイには含まれない(`dev-tools/`配下、`package.json`も別管理)。

団体単位の保持日数は `PATCH /admin/organizations/:orgId` で設定する
(`attachmentRetentionDays`、未設定時はデフォルト30日)。admin-dashboardの
団体管理画面(`OrganizationsView.vue`)からも設定できる。

## Firestoreインデックスのデプロイ

クリーンアップスクリプトの`collectionGroup('messages').where('attachment.
expiresAt', '<=', now)`クエリのため、`firestore.indexes.json`に
COLLECTION_GROUPインデックスを追加済み。以下でデプロイする。

```bash
# リポジトリルートで実行
firebase deploy --only firestore:indexes
```

## 動作確認チェックリスト

- [ ] 画像を送信し、送信者・受信者双方でサムネイル・本体が表示できる
- [ ] 動画・PDFについても同様に確認する
- [ ] 100MBを超えるファイルのアップロードが拒否される
- [ ] 対応していない形式(例: 実行ファイル)のアップロードが拒否される
- [ ] Guestロールで添付の送信・閲覧ができる
- [ ] BAN済みユーザーが添付URLの発行を拒否される(`chat:attachment_read`が
      `requireRoomMembership`より後段のため、BANされたメンバーは
      そもそも`requireRoomMembership`で弾かれる)
- [ ] `--dry-run`でクリーンアップ対象が意図通りリストされる
- [ ] 実行後、GCS・Firestore双方から該当添付が消えている
