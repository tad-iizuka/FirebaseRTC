# Phase 5: 複数ルーム横断監視ダッシュボード

## 何を追加したか

- `middleware/requireAdmin.js`: UIDごとに付与された`permissions`配列
  (Firestore `adminUsers/{uid}.permissions`)を見て、必要な権限を持つかを
  確認する汎用ミドルウェア `requireAdminPermission(permission)`。
- `routes/admin.js`:
  - `GET /admin/rooms` … 全ルームを作成日時降順で一覧表示(ページング対応)。
    Firestore側の台帳情報(オーナー・アクティブメンバー数・発話ロック・録音状態)と、
    LiveKit側の「今まさに誰か接続しているか」を突き合わせて返す。
  - `GET /admin/rooms/:roomId` … 1ルームの詳細。メンバー台帳(Firestore)と
    現在の実接続一覧(LiveKit)の両方を返す。
- `dev-tools/grant-admin-permission.js`: `adminUsers/{uid}` への権限付与/剥奪/
  確認を行うローカル専用スクリプト(Admin SDK経由)。
- `dev-tools/admin-dashboard.html`: 上記APIを叩いて表示する開発者用の
  軽量ダッシュボードページ(`dev-tools/get-firebase-token.html`と同じ位置づけ。
  本番のptt-clientには組み込まない)。
- `firestore.rules`: `adminUsers`コレクションへのクライアント直接アクセスを
  明示的に拒否するルールを追加(既存のキャッチオールで元々拒否されてはいたが、
  意図を明確にするため明示した)。

## なぜ「管理者」を単一のbooleanにしなかったか

現状必要なのは「複数ルームの状態を横断的に見られる」権限だけだが、将来的に
「他人の発話ロックを強制解除できる」「他ルームの録音を強制停止できる」等、
性質の異なる権限が増えることが予想される。そのたびに新しいboolean
フィールド(`isSuperAdmin`等)を追加していく設計は破綻しやすいため、
最初から `permissions: string[]` という配列で持たせ、
`requireAdminPermission('rooms:monitor')` のように「必要な権限名」を
明示的に要求する形にした。表示名・所属チームといった管理者自身の
プロフィール情報は、この権限台帳とは別の関心事として扱い(現状は未実装。
必要になれば`adminUsers/{uid}`に`displayName`等を追加するか、別コレクションに
分離する)、ここに混ぜ込んでいない。

## なぜFirestoreとLiveKitの両方を見るのか

`rooms/{roomId}/members` は「招待されて参加した(=メンバーシップを持つ)」
という永続的な台帳であり、「今この瞬間サーバーに接続しているか」とは別物。
アプリを閉じた・ネットワークが切れた等でLiveKitからは切断されていても、
Firestore上のmembersドキュメントはそのまま残り続ける。管理者が本当に
知りたいのは「今、実際に何人がそのルームで話しているか」という
ライブな実態であることが多いため、`RoomServiceClient.listRooms()` /
`listParticipants()` でLiveKit側の実接続状況も取得し、突き合わせて返す。

## パフォーマンス上の注意

- `GET /admin/rooms` は `listRooms()` を1回だけ呼び、返ってきた配列を
  `roomName -> Room` のMapに変換してから各Firestoreドキュメントと
  突き合わせている(ルームごとに`listRooms()`を呼ぶとN+1になるため)。
- 各ルームのアクティブメンバー数は Firestore の集計クエリ
  (`.where('status','==','active').count().get()`)で取得しており、
  ページ内のルーム数だけ読み取りが発生する。無制限に一覧できないよう
  `limit`は最大200件に制限し、既定は50件・cursorベースのページングにしている。
- `GET /admin/rooms/:roomId` の `listParticipants()` は、ルームに現在誰も
  接続していない場合LiveKit側がNotFoundを返しうる。これは異常ではないため、
  空配列にフォールバックしてログにwarnを出すだけに留めている。

## 権限の付与方法

現状、`adminUsers`への書き込みAPIは用意していない(README.mdの
「moderator権限の付与手段が無い」のと同じ理由: 「誰が新しい管理者を
任命できるか」を安全に守る仕組みができるまでは、Firestoreへの書き込み
権限を持つ運用者がローカルから直接操作する)。

```bash
# 権限を付与する(GOOGLE_APPLICATION_CREDENTIALS / FIREBASE_PROJECT_ID が必要)
node dev-tools/grant-admin-permission.js grant <uid> rooms:monitor "運用チームリーダー"

# 確認
node dev-tools/grant-admin-permission.js list <uid>

# 剥奪
node dev-tools/grant-admin-permission.js revoke <uid> rooms:monitor
```

## 動作確認方法

1. 上記コマンドで自分のuidに`rooms:monitor`権限を付与する
2. `dev-tools/admin-dashboard.html` をブラウザで開き、同じFirebaseアカウントで
   サインインする
3. ルーム一覧が表示され、各行の緑ドットが「現在LiveKit上でライブ中」を示す
   ことを確認する
4. 行をクリックすると、Firestore側のメンバー台帳とLiveKit側の実接続一覧の
   両方が表示されることを確認する
5. `rooms:monitor`権限を持たないアカウントでサインインすると
   `GET /admin/rooms` が403になることを確認する

## 動作確認チェックリスト(追加分)

- [ ] `rooms:monitor`権限を持たないユーザーが`/admin/rooms`を叩くと403が返る
- [ ] 未認証(Authorizationヘッダーなし)で`/admin/rooms`を叩くと401が返る
- [ ] 実際に接続中のルームで、`live.numParticipants` / `live.isLive` が
      実態と一致する
- [ ] 誰も接続していないルームで`/admin/rooms/:roomId`を叩いてもエラーに
      ならず、`liveParticipants: []`が返る
- [ ] `adminUsers`コレクションへクライアントSDKから直接読み書きしようとすると
      firestore.rulesで拒否される
- [ ] `cursor`を使って2ページ目以降が正しく取得できる

## 未実装・今後の検討事項

- **権限付与のAPI化**: 現状はローカルスクリプトでの手動運用。管理者UIから
  他の管理者を任命できるようにする場合は、「誰が管理者を任命できるか」を
  慎重に設計した上でAPI化を検討する。
- **監査ログ**: 誰がいつダッシュボードでどのルームを閲覧したかの記録は
  現状取っていない。プライバシー上の観点で必要になれば追加する。
- **リアルタイム更新**: 現状は手動リロード方式。ルーム数が増えてきた場合、
  ポーリング間隔の調整やFirestoreリアルタイムリスナーへの切り替えを検討する。
- **本番Web UIへの統合**: 現状は`dev-tools/admin-dashboard.html`という
  開発者向けの簡易ページのみ。継続的に使う運用フローが固まった段階で、
  ptt-client本体や別の管理者専用SPAへ統合するかを再検討する。
