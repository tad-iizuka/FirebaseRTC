# Phase12: role×操作 対応表の棚卸し

対象リポジトリ: `tad-iizuka/FirebaseRTC`（アップロードされたZIP、HEAD=`f6af498`, 2026-07-26）
作成: 2026-07-26（`brushup-plan.md` 6章 次アクション item 1 に対応）

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
| `POST /reports`（通報） | **role/membershipチェックなし** | `requireFirebaseAuth`のみ。対象roomIdのメンバーである保証すら無い | `reports.js:26` |

### 気づいた点（Room内role分岐）

- **`POST /reports`だけmembership非チェック**：他のroom内操作は最低でも
  `requireRoomMembership`（アクティブなメンバーであること）を通すが、通報APIは
  `requireFirebaseAuth`のみ。ログイン済みなら対象roomのメンバーでなくても
  任意の`roomId`/`reportedUid`で通報できてしまう（悪用というより設計漏れの
  可能性）。対応表整理の対象に含めるべき。
- **`POST /rooms`（Room作成）はサーバー側でrole判定していない**：Guestに
  Room作成をさせない制御は3クライアントとも**クライアント側のみ**で行っている
  （後述2章）。API直叩き・改造クライアントからは匿名認証ユーザーでも
  Room作成が可能な状態。
- **moderator任命API(`POST /:roomId/members/:targetUid/role`)を呼ぶUIが
  3クライアントいずれにも存在しない**（後述2章で確認）。サーバーにAPIはあるが
  未使用。

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

1. `POST /reports` に `requireRoomMembership` を足すかどうか（現状は誰でも
   任意roomId宛てに通報できる）
2. `POST /rooms`（Room作成）をサーバー側でもGuest拒否するか、現状通り
   クライアント側のみのガイドに留めるか
3. 「Room作成」非表示の判定軸（`isAnonymous` vs `members/{uid}.role`）を
   どちらかに統一するか、意図的に使い分けるものとして明文化するか
4. moderator任命API（未使用）をどのクライアントかに実装するか、それとも
   仕様として「当面UIは提供しない」と明記するか
5. admin-dashboardに事前権限チェック（メニュー非表示等）を追加するか、
   現状の「403で都度表示」のままでよしとするか
6. 招待コードの可視範囲（`brushup-plan.md` 5.4で確定済みの持ち越し事項）
7. `settings.autoRecording`のような複数権限経路を持つ操作をどう対応表上で
   表現するか（1操作=1行では表現しきれない）

これらは棚卸しの過程で見つかった副産物であり、対応表そのものの設計判断は
含んでいない。次のステップとして、上記1〜7を踏まえたうえで一元化の設計
（対応表の保存場所・参照方法）に進むのが妥当。
