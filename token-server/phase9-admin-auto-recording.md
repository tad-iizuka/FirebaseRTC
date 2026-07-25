# Phase 9: 管理者ダッシュボードからの自動録音設定切り替え

## 前提: 既にあったもの

`rooms/{roomId}.settings.autoRecording` というルーム単位のフラグ自体は
既存実装(`routes/rooms.js`)にあった:

- `POST /rooms`: 新規ルーム作成時に `settings: { autoRecording: false }` で初期化。
- `PATCH /rooms/:roomId/settings` (body: `{ autoRecording: boolean }`):
  そのルームの **owner/moderatorのみ** が切り替え可能。
- `routes/webhooks.js` の `handleAutoRecordingTrigger` / `handleAutoRecordingStopTrigger`:
  LiveKitの `room_started` イベント(誰かが最初に入室した瞬間)でこのフラグを見て
  録音を自動開始する。
- `routes/recording.js`: `POST /rooms/:roomId/join` のレスポンスに
  `autoRecording: !!room.settings?.autoRecording` を含めて返す。

## 今回追加したもの

管理者ダッシュボード(admin-dashboard)のルーム詳細画面は、監視対象ルームの
owner/moderatorとは限らない管理者アカウントで見るため、既存の
`PATCH /rooms/:roomId/settings` はそのままでは使えない(403になる)。
そのため `routes/admin.js` に専用エンドポイントを追加した。

- `GET /admin/rooms/:roomId` のレスポンスに `settings: { autoRecording }` を追加。
- `PATCH /admin/rooms/:roomId/settings/autoRecording` (body: `{ enabled: boolean }`)
  … `rooms:manage` 権限を持つ管理者が、対象ルームのメンバーかどうかに関わらず
  `rooms/{roomId}.settings.autoRecording` を切り替えられる。書き込み先は
  `routes/rooms.js` 側の同名エンドポイントと同一フィールドなので、
  `handleAutoRecordingTrigger` 等の参照側はどちらの経路で更新されても
  変更なく機能する。
- 操作は他の管理系操作と同様 `lib/auditLog.js` 経由で
  `auditLogs` に `room:settings_update` (`detail.via: "admin_dashboard"`) として記録する。

## なぜ既存の `rooms:monitor` を使い回さなかったか

`rooms:monitor` は `GET /admin/rooms*` にのみ使われている**閲覧専用**の権限として
運用されてきた(phase5-admin-dashboard.md参照)。この意味を書き込み系エンドポイントに
まで広げると、「閲覧だけ任せたい運用担当」に誤って書き込み権限まで与えてしまう
リスクがある。`admins:manage` が「権限管理という書き込み」に専用の権限名を
割り当てているのと同じ考え方で、書き込み用に新しい `rooms:manage` 権限を切った。

## 権限の付与方法

既存の `dev-tools/grant-admin-permission.js` でそのまま付与できる(コード変更不要)。

```bash
node dev-tools/grant-admin-permission.js grant <uid> rooms:manage "運用チームリーダー"
node dev-tools/grant-admin-permission.js revoke <uid> rooms:manage
```

## 動作確認チェックリスト

- [ ] `rooms:manage`権限を持たないユーザーが`PATCH /admin/rooms/:roomId/settings/autoRecording`を
      叩くと403が返る(`rooms:monitor`のみでは不可なことも確認する)
- [ ] `rooms:manage`権限を持つ管理者は、対象ルームのメンバーでなくても切り替えられる
- [ ] `enabled`がboolean以外だと400が返る
- [ ] 存在しない`roomId`を指定すると404が返る
- [ ] 切り替え成功後、`GET /admin/rooms/:roomId`の`settings.autoRecording`が更新されている
- [ ] `routes/rooms.js`の`PATCH /rooms/:roomId/settings`(owner/moderator向け)で
      変更した場合も、管理者ダッシュボード側の表示に正しく反映される(同一フィールドのため)
- [ ] 切り替えのたびに`auditLogs`に`room:settings_update`(`detail.via: "admin_dashboard"`)が記録される
- [ ] OFFにしても、その時点で進行中の録音は停止しない(次回`room_started`から自動開始しなくなるだけ)
