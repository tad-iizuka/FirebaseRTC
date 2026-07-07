# Phase 4: 可観測性・運用

Phase 1〜3で「認証・認可・排他制御」まで固めたので、Phase 4では
「実際に何が起きているかを運用側が把握できる」ようにする。3つの柱:

1. LiveKit Webhookの受信・記録 (`routes/webhooks.js`)
2. LiveKit Cloudダッシュボードの定期確認
3. Cloud Run側のログ集約・異常検知アラート

## 1. LiveKit Webhookの受信・記録

### 何を追加したか

- `routes/webhooks.js`: `POST /webhooks/livekit` で LiveKit Cloud からのイベント
  (`room_started` / `room_finished` / `participant_joined` / `participant_left` /
  `track_published` / `track_unpublished` 等) を受信する。
- `livekit-server-sdk` の `WebhookReceiver` で署名検証を行う
  (`LIVEKIT_API_SECRET` で署名されたJWTがAuthorizationヘッダーに載ってくる)。
- 受信したイベントは
  - Cloud Runの標準出力へ1行のJSONとして`console.log`する(Cloud Logging連携用)
  - Firestoreの `events` コレクションへも保存する(後から集計・調査するための生データ)
  の両方に記録する。Firestoreへの書き込みはベストエフォート(失敗してもWebhook自体には
  200を返す。LiveKit側は非2xx応答をリトライしてくるため、DB側の一時的な不調で
  Webhook配送自体を巻き込みたくないため)。

### なぜこの実装順序が必要か(生ボディ vs JSONパース済みボディ)

`WebhookReceiver.receive(rawBody, authHeader)` は署名検証のために「受信した生の
リクエストボディ文字列」を必要とする。すでに`express.json()`でパースされた
JavaScriptオブジェクトを渡すと署名検証が失敗する。そのため `server.js` では

```js
app.use('/webhooks', express.raw({ type: '*/*' }), webhooksRouter);
app.use(express.json());
```

の順で、`/webhooks`以下だけ先に`express.raw()`を通してから、それ以外のルートに
グローバルな`express.json()`を適用している。

### データモデル (Firestore)

```
events/{eventId}
  - type: string            (例: "participant_joined")
  - roomName: string | null
  - roomSid: string | null
  - participantIdentity: string | null  (uid)
  - trackSid: string | null
  - createdAt: timestamp
```

`firestore.rules`側の変更は不要。既存のキャッチオール
(`match /{document=**} { allow read, write: if false; }`) が
`events`コレクションへのクライアント直接アクセスも既に拒否している。
書き込みはAdmin SDK経由(=このサーバーの`routes/webhooks.js`)のみで、
Admin SDKはセキュリティルールをそもそもバイパスする。

### セットアップ

1. LiveKit Cloud ダッシュボード → 対象プロジェクト → **Settings > Webhooks**
2. Webhook URLに `https://<token-serverのCloud RunドメインD>/webhooks/livekit` を登録
3. デプロイ後、実際にルームに誰かを参加させてみて、Cloud Runのログに
   `"tag":"livekit_webhook"` の行が出ることと、Firestoreの`events`コレクションに
   ドキュメントが増えることを確認する

### 動作確認チェックリスト(追加分)

- [ ] LiveKit Cloud側のWebhook設定画面で、直近のWebhook配信が成功(2xx)しているか確認できる
- [ ] 署名が不正なリクエストを`/webhooks/livekit`に送ると401が返る
- [ ] ルーム作成・参加・退室のたびに`events`コレクションにドキュメントが増える
- [ ] Firestore書き込みを意図的に失敗させても(例: 権限剥奪)、Webhook自体は200を返し続ける

## 2. LiveKit Cloudダッシュボードの定期確認体制

自動化しきれない部分は「誰が・いつ・何を見るか」を運用ルールとして明文化しておく。

| 確認項目 | 確認場所 | 頻度 | 異常の目安 |
|---|---|---|---|
| 同時接続数 | LiveKit Cloud Dashboard > Rooms | 週次 | 想定ユーザー数から大きく乖離 |
| 帯域使用量 | LiveKit Cloud Dashboard > Usage | 週次 | 想定と乖離、または無料/契約枠に接近 |
| 接続品質(パケットロス・ジッター) | LiveKit Cloud Dashboard > Sessions | 品質クレームが出た都度 | 特定リージョン/ISPへの偏りがないか |
| 課金額 | LiveKit Cloud Dashboard > Billing | 月次 | 想定外の急増 |

これらは現状LiveKit Cloud側のUIでしか見られない指標のため、API化された
監視が必要になった場合は改めて別途検討する(現時点ではスコープ外)。

## 3. Cloud Run側のログ集約・アラート設定

### 目的

token発行(`/token`)エンドポイントへの異常なリクエスト急増
(スキャン・トークン乱発・アカウント乗っ取り等)を検知し、通知を受け取れるようにする。
`routes/token.js`は成功時に`console.log('[token発行] room=... identity=...')`という
ログを既に出しているため、これを起点にログベースの指標を作る。

### 3-1. 通知先チャンネルの作成(初回のみ)

```bash
gcloud alpha monitoring channels create \
  --display-name="PTT運用アラート通知先" \
  --type=email \
  --channel-labels=email_address=your-team@example.com
```

出力される`name`(例: `projects/xxx/notificationChannels/1234567890`)を
以降のコマンドの`CHANNEL_ID`として使う。

### 3-2. ログベース指標の作成

```bash
gcloud logging metrics create ptt_token_issued_count \
  --description="LiveKitトークン発行の回数 (token-server の [token発行] ログを起点にする)" \
  --log-filter='resource.type="cloud_run_revision"
resource.labels.service_name="ptt-token-server"
textPayload:"[token発行]"'
```

同様に、認証エラー・レート制限超過(429)の急増を見たい場合は、
`textPayload:"[認証エラー]"` や `httpRequest.status=429` を条件にした
指標も追加しておくと良い。

### 3-3. アラートポリシーの作成

[注意] `gcloud alpha monitoring policies create` は、しきい値・比較演算子・
集計方法といった条件の詳細を個別のフラグ(`--condition-threshold-value`等)では
受け付けない。フラグで指定できるのは `--display-name` / `--condition-display-name` /
`--condition-filter` 程度に限られるため、実際の条件定義はJSON(またはYAML)の
ポリシー定義ファイルを作り、`--policy-from-file` で渡す必要がある。

`docs/token-issued-alert-policy.json` にサンプルを用意した(このファイルと同じ
ディレクトリにある)。中身は以下の通り:

```json
{
  "displayName": "PTT token発行の異常急増",
  "documentation": {
    "content": "token-server の /token エンドポイントでのトークン発行数が5分間で閾値を超えた場合に通知する。スキャン・トークン乱発・アカウント乗っ取り等の兆候を検知するためのアラート。",
    "mimeType": "text/markdown"
  },
  "combiner": "OR",
  "conditions": [
    {
      "displayName": "5分間でtoken発行が閾値超",
      "conditionThreshold": {
        "filter": "metric.type=\"logging.googleapis.com/user/ptt_token_issued_count\" AND resource.type=\"cloud_run_revision\"",
        "comparison": "COMPARISON_GT",
        "thresholdValue": 100,
        "duration": "0s",
        "aggregations": [
          {
            "alignmentPeriod": "300s",
            "perSeriesAligner": "ALIGN_SUM",
            "crossSeriesReducer": "REDUCE_SUM",
            "groupByFields": []
          }
        ],
        "trigger": { "count": 1 }
      }
    }
  ],
  "notificationChannels": [
    "projects/YOUR_PROJECT_ID/notificationChannels/13710855803860249385"
  ]
}
```

ポイント:

- `notificationChannels` は数字IDだけ(例: `13710855803860249385`)ではなく、
  `projects/YOUR_PROJECT_ID/notificationChannels/13710855803860249385` という
  フルリソース名で指定する必要がある。`YOUR_PROJECT_ID` は実際のGCPプロジェクトIDに
  書き換える(`gcloud config get-value project` で確認できる)。
  通知先IDは `gcloud alpha monitoring channels list` でも確認できる。
- `perSeriesAligner: ALIGN_SUM` + `alignmentPeriod: 300s` で「直近5分間の
  ログ出現回数の合計」を1つの値にしてから、その値が`thresholdValue: 100`を
  超えたか(`COMPARISON_GT`)を見る、という設計にしている
  (ログベース指標はカウンタ型なので、`ALIGN_RATE`を使うと「1秒あたりの発生率」に
  なってしまい、閾値の直感的な意味が変わってしまう点に注意)。
- `duration: "0s"` は「アラート条件を満たした状態が継続する必要がある最小時間」
  であり、アラートを見る時間窓そのものではない(時間窓は`alignmentPeriod`側で
  制御している)。運用上、単発のスパイクではなく継続的な異常のみ通知したい場合は
  ここを`60s`等に伸ばす。

作成コマンド:

```bash
gcloud alpha monitoring policies create \
  --policy-from-file=docs/token-issued-alert-policy.json
```

(ファイル内に`notificationChannels`を書いているため、`--notification-channels`
フラグは不要。両方指定した場合はファイル側が優先される)

閾値(`thresholdValue`)は実際の利用規模(想定同時接続数・再接続頻度)を
見ながら調整する。`uidRateLimiter`が1分20回・`ipRateLimiter`が1分10回に
制限しているため、正規利用であればこのオーダーを大幅に超えることは通常ない。

### 動作確認チェックリスト(追加分)

- [ ] `gcloud logging metrics list` で `ptt_token_issued_count` が確認できる
- [ ] 意図的に`/token`へ連打してレート制限(429)に到達した際、ログに残る
- [ ] アラートポリシーが有効化されていることを`gcloud alpha monitoring policies list`で確認できる
- [ ] 実際にテスト用の通知チャンネルへアラートが届くことを一度確認する
  (Google CloudのMonitoringコンソールから「テスト通知を送信」できる)

## 未実装・今後の検討事項(Phase 4時点)

- **LiveKit Egress連携**: Webhookは「イベントの発生」だけを拾うため、実際の音声データ
  そのもの(録音・STT用の音声区間切り出し等)が必要になった場合は、別途Egress APIの
  導入を検討する。
- **`events`コレクションの肥大化対策**: 現状TTLやアーカイブの仕組みが無いため、
  長期運用する場合はFirestoreのTTLポリシー設定か、定期的なBigQueryへのエクスポート
  ジョブの追加を検討する。
- **ダッシュボードの自動化**: 現状は手動でのLiveKit Cloud確認に留めている。
  API化が可能であれば、Cloud Monitoringのカスタムダッシュボードに統合することも検討可。
