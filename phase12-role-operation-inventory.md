# Phase12: role×操作 対応表の棚卸し

対象リポジトリ: `tad-iizuka/FirebaseRTC`（アップロードされたZIP、HEAD=`f6af498`, 2026-07-26）
作成: 2026-07-26（`brushup-plan.md` 6章 次アクション item 1 に対応）
追記: 2026-07-28（本棚卸しをもとに一元化を実装。「4. 対応表一元化に向けた
論点まとめ」の各項目の対応状況を追記した。詳細は`brushup-plan.md`の
該当改定を参照）

> **位置づけ**: これは一元化の設計そのものではなく、まず現状を機械的に洗い出した
> インベントリ。`token-server`側のホワイトリスト分岐、3クライアント側のUI分岐、
> admin側の権限分岐を実コードから直接抽出した。一元化の設計（対応表をどこに
> 一元管理し、各ルート/コンポーネントがそこからどう参照するか）は次のステップ。

---

## 1. token-server: エンドポイント × role

Room内ロール(`owner` / `moderator` / `member` / `guest`)によるチェックがある
エンドポイントのみ抜粋。チェック方式の列は「サーバーが実際に強制している方式」。

| エンドポイント | 許可role | チェック方式 | ファイル:行 |
|---|---|---|---|
| `POST /rooms`（Room作成） | 制限なし（誰でもowner become） | – | `rooms.js:57` |
| `POST /:roomId/join`（参加） | 制限なし。ただしrole自動判定あり | `firebase.sign_in_provider==='anonymous'`→`guest`、それ以外→`member` | `rooms.js:104,146` |
| `POST /:roomId/members/:targetUid/ban` | `owner`,`moderator` | `['owner','moderator'].includes(role)` | `rooms.js:204` |
| `POST /:roomId/members/:targetUid/role`（moderator任命） | `owner`のみ実行可 | `role !== 'owner'` で拒否。対象が`guest`なら追加で拒否 | `rooms.js:274,293` |
| `PATCH /:roomId/settings`（自動録音トグル） | `owner`,`moderator` | 同上ホワイトリスト | `rooms.js:343` |
| `PATCH /:roomId/nickname` | 全role（本人のみ） | `requireRoomMembership`のみ（role不問） | `rooms.js:388` |
| `GET /:roomId/org-context` | 全role（メンバーなら誰でも） | `requireRoomMembership`のみ | `rooms.js:422` |
| `POST /:roomId/talk/start` `/heartbeat` `/stop`（送話ロック） | 全role | `requireRoomMembership`のみ（role不問） | `talk.js:60,112,154` |
| `POST /:roomId/messages`（チャット送信） | 全role | `requireRoomMembership`のみ（role不問） | `messages.js:44` |
| `POST /:roomId/recording/start` `/stop` | `owner`,`moderator` | `requireModeratorOrOwner`ミドルウェア | `recording.js:105,240,272` |
| `GET /:roomId/recording/status` | 全role | `requireRoomMembership`のみ | `recording.js:310` |
| `GET /:roomId/recordings`（録音履歴一覧） | 全role | `requireRoomMembership`のみ（「全参加者への開示」方針） | `recording.js:342` |
| `GET /:roomId/recordings/:id/download-url` | `owner`,`moderator` | `requireModeratorOrOwner` | `recording.js:381` |
| `DELETE /:roomId/recordings/:id` | `owner`,`moderator` | `requireModeratorOrOwner` | `recording.js:463` |
| `POST /reports`（通報） | 全role | `requireFirebaseAuth`＋ハンドラ内でmembership検証（2026-07-28対応、下記参照） | `reports.js:26` |

### 気づいた点（Room内role分岐）

- ~~**`POST /reports`だけmembership非チェック**~~ → **対応済み（2026-07-28）**。
  `routes/reports.js`のハンドラ内で対象roomIdのメンバーシップ確認・BAN済み
  チェックを追加した(`/reports`は`/:roomId/...`形式でマウントされておらず
  roomIdがbody経由のため、既存の`requireRoomMembership`ミドルウェアではなく
  同等の判定を手動実装)。他のroom内操作は最低でも`requireRoomMembership`
  （アクティブなメンバーであること）を通していたが、通報APIは従来
  `requireFirebaseAuth`のみで、ログイン済みなら対象roomのメンバーでなくても
  任意の`roomId`/`reportedUid`で通報できてしまっていた。
- ~~**`POST /rooms`（Room作成）はサーバー側でrole判定していない**~~ →
  **対応済み（`rooms.js:71-73`で確認）**。`firebase.sign_in_provider===
  'anonymous'`を見て匿名認証ユーザーのRoom作成を403で拒否している。以前は
  Guestに Room作成をさせない制御が3クライアントとも**クライアント側のみ**
  だった（後述2章）ため、API直叩き・改造クライアントからは素通りしていた。
- ~~**moderator任命API(`POST /:roomId/members/:targetUid/role`)を呼ぶUIが
  3クライアントいずれにも存在しない**~~ → **別経路で対応済み**。PTTクライアント
  側にUIを追加するのではなく、`routes/admin.js`に
  `PATCH /admin/rooms/:roomId/members/:targetUid/role`（`rooms:manage`権限）を
  新設し、admin-dashboardの`RoomDetailView.vue`から任命/降格できるようにした
  （「room内ownerが不在・連絡不可の場合にサイト管理者が代行する」導線として
  整理。詳細は「3. admin-dashboard」章参照）。`routes/rooms.js`側のRoom内
  owner専用APIは引き続き未使用のまま残っている。

---

## 2. クライアント3種: UI側のrole分岐

各プラットフォームで`myRole`相当の値をどう分岐に使っているか。

| UI上の制御 | Web (`ptt-client`) | iOS (`ptt-ios`) | Android (`ptt-android`) |
|---|---|---|---|
| BANボタン表示 | `ban.myRole==='owner'\|\|'moderator'`<br>`RoomView.vue:39` | `ban.myRole=="owner"\|\|"moderator"`<br>`ContentView.swift:816` | `myRole=="owner"\|\|"moderator"`<br>`PTTApp.kt:335` |
| 録音操作ボタン表示 | 同上パターン<br>`RoomView.vue:40` | 同上<br>`ContentView.swift:532` | 同上<br>`PTTApp.kt:311` |
| Guestバッジ表示（自分のみ） | `ban.myRole==='guest'`<br>`RoomView.vue:161` | `ban.myRole=="guest"`<br>`ContentView.swift:399` | `myRole=="guest"`<br>`PTTApp.kt:292` |
| 「ルームを作成」非表示 | **判定根拠が上記と異なる**（`roomSelect.guestCannotCreate`文言のみ確認、role値ではなく別ロジック） | `auth.currentUser?.isAnonymous != true`<br>`ContentView.swift:302`（**匿名認証状態で判定。roomのmembersドキュメントのroleではない**） | `currentUser?.isAnonymous == true`<br>`PTTApp.kt:371`（同上） |
| moderator任命UI | **存在しない** | **存在しない** | **存在しない** |
| 自動録音トグル表示 | `canControl`（owner/moderator）で表示<br>`RecordingBar.vue:13,100` | **機能自体が存在しない**（スコープ外、`brushup-plan.md` 2-E参照） | **機能自体が存在しない**（同上） |
| ニックネーム変更UI | 全role（本人のみ想定） | 全role | 全role |

### 気づいた点（クライアント側）

- **「Room作成」非表示の判定軸が2種類混在している**：BAN/録音/Guestバッジは
  いずれも「room参加後にFirestoreから取得した`members/{uid}.role`」を見ているが、
  「Room作成」非表示だけは「Firebase Authそのものの匿名認証状態
  (`isAnonymous`)」を見ている。これはRoom未参加の画面（ログイン直後の
  Room選択画面）でも判定が必要なため必然的な違いではあるが、"role"という
  同じ概念を指すのに参照元が割れている状態。一元化の際にどちらを正とするか
  （あるいは両方参照する設計にするか）を決める必要がある。
- **サーバー側でRoom作成にGuest制限が無いため、この非表示制御は「UIでの
  ガイド」であり「権限の強制」ではない**（1章参照）。Phase12で対応表を
  一元化する際、Room作成もサーバー側で明示的にrole判定させるかどうかを
  合わせて検討する価値がある。
- **moderator任命APIはサーバーにのみ存在しUIが無い**：Owner専用の機能として
  実装はされているが、3クライアントいずれからも呼び出す導線がない。
  「未実装の権限」として一覧に含めておく。

---

## 3. admin-dashboard / admin.js: permission × 操作

Room内roleとは別軸の「サイト管理者権限」(`adminUsers/{uid}.permissions`)。

| エンドポイント | 必要permission | ファイル:行 |
|---|---|---|
| `GET /admin/rooms`（ルーム一覧） | `rooms:monitor` | `admin.js:66` |
| `GET /admin/rooms/:roomId`（ルーム詳細） | `rooms:monitor` | `admin.js:161` |
| `PATCH /admin/rooms/:roomId/settings/autoRecording` | `rooms:manage` | `admin.js:258` |
| `GET /admin/audit-logs` | `audit:read` | `admin.js:305` |
| `GET /admin/admins` | `admins:manage` | `admin.js:356` |
| `POST /admin/admins/:uid/permissions`（権限付与/剥奪） | `admins:manage`（ただし`admins:manage`自体の付与/剥奪は不可） | `admin.js:383,394` |
| `GET /admin/organizations`（団体一覧） | `organizations:monitor` | `organizations.js:67` |
| `GET /admin/organizations/:orgId/nodes` | `organizations:monitor` | `organizations.js:109` |
| `POST /admin/organizations`（団体作成） | `organizations:manage` | `organizations.js:159` |
| `POST /admin/organizations/:orgId/nodes`（node作成） | `organizations:manage` | `organizations.js:217` |
| `PATCH /admin/rooms/:roomId/org-assignment` | `organizations:manage` | `organizations.js:301` |

### 気づいた点（admin側）

- **admin-dashboardにはクライアント側の事前権限チェックが一切無い**：Web版の
  `ban.myRole`のような「自分の権限を見て要素を隠す」ロジックが
  `admin-dashboard/src`のどこにも存在しない（grep結果0件）。各画面は
  とりあえずAPIを呼び、403が返ったらエラーメッセージを表示するだけ
  （例: `RoomsListView.vue`「管理者権限がありません」）。Room内roleの3
  クライアントとは設計思想が異なる。これも一元化のスコープに含めるか、
  「サーバー権限とRoom内roleは元々別軸なので対応表も分けてよい」と割り切るかの
  判断が要る。
- **招待コード(`inviteCode`)は`GET /admin/rooms`・`GET /admin/rooms/:roomId`
  いずれのレスポンスにも含まれない**ことをコード上で確認（`admin.js:116-142`,
  `205-232`）。`brushup-plan.md` 5.4/Phase12で挙げていた懸念の通り。
- **`PATCH /admin/rooms/:roomId/settings/autoRecording`（admin経由）と
  `PATCH /rooms/:roomId/settings`（PTTクライアント経由、owner/moderator）は
  同じ`rooms/{roomId}.settings.autoRecording`を2つの別権限軸（`rooms:manage`
  と Room内role）から書き換えられる**設計になっている（`admin.js:247`
  のコメントで意図的と明記）。対応表には「同一操作に複数の権限経路がある例」
  として記録しておく価値がある。

---

## 4. 対応表一元化に向けた論点まとめ（次の設計フェーズへの引き継ぎ）

**（2026-07-28追記）** 1〜4は実装まで完了した。5〜7は仕様判断待ちのため
未着手のまま残している。

1. ✅ **対応済み**: `POST /reports` に `requireRoomMembership` 相当の検証を
   追加した（`routes/reports.js`。ルーターのマウント形式上ミドルウェアを
   そのまま流用できないためハンドラ内で実装）
2. ✅ **対応済み**: `POST /rooms`（Room作成）はサーバー側でもGuestを拒否する
   実装がすでに存在していた（`rooms.js:71-73`、確認のみ）
3. ⏳ **未着手（仕様判断待ち）**: 「Room作成」非表示の判定軸（`isAnonymous`
   vs `members/{uid}.role`）は、Room未参加画面ではroleという概念自体が
   存在しないためisAnonymousを正とする、という判断が
   `ptt-client/src/lib/roomPermissions.ts`のコメントで明文化されていることを
   確認した。「統一するか」ではなく「意図的な使い分け」として決着している
   と見てよい
4. ✅ **対応済み**: moderator任命APIについて、PTTクライアント側にUIを追加
   するのではなく、`routes/admin.js`に`rooms:manage`権限の代行API
   （`PATCH /admin/rooms/:roomId/members/:targetUid/role`）を新設し
   admin-dashboardから任命/降格できる形で決着していた（確認のみ）。
   ただしこのAPIは`routes/rooms.js`側のRoom内owner専用APIと全く同じ
   「owner降格禁止・BAN済み対象禁止・guest任命禁止」のガードを重複実装
   していたため、`lib/permissions.js`の`checkRoleAssignmentTarget()`に
   集約し、両ルートから参照する形に揃えた
5. ⏳ **未着手**: admin-dashboardに事前権限チェック（メニュー非表示等）を
   追加するか、現状の「403で都度表示」のままでよしとするか。優先度は
   低いと判断し今回は対応していない
6. ⏳ **未着手**: 招待コードの可視範囲（`brushup-plan.md` 5.4で確定済みの
   持ち越し事項）。方針判断が先に必要
7. ⏳ **未着手**: `settings.autoRecording`のような複数権限経路を持つ操作を
   どう対応表上で表現するか（1操作=1行では表現しきれない）。ドキュメント
   表現の問題であり実装アクションは無い

**（新たに見つかった論点8、2026-07-28）**
`lib/permissions.js`の`ROOM_OPERATIONS`には`talk:control`/
`nickname:update`/`org_context:read`/`chat:send`がrole不問(`ROOM_ROLES`)
として定義済みだったが、実際の`routes/talk.js`（3エンドポイント）・
`routes/rooms.js`（nickname/org-context）・`routes/messages.js`
（チャット送信）は`requireRoomMembership`止まりで`hasRoomPermission`/
`requireRoomPermission`を経由していなかった。「対応表を変更しても一部の
操作には反映されない」事故のもとになるため、いずれも
`requireRoomPermission('...')`を追加して表と実装の経路を一致させた
（挙動は変わらない。`chat:attachment_upload`/`chat:attachment_read`は
元々配線済みだったため対象外）。

これらは棚卸しの過程で見つかった副産物であり、対応表そのものの設計判断は
含んでいない。次のステップとして、上記5〜7を踏まえたうえで一元化の設計
（対応表の保存場所・参照方法）に進むのが妥当。
