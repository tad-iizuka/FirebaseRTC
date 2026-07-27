# PTTアプリ ブラッシュアップ計画（改定版）

対象リポジトリ: `tad-iizuka/FirebaseRTC`
作成日: 2026-07-09 / 改定: 2026-07-24（README.md「Vision」に基づき全面改定）
再改定: 2026-07-25（Guestロール・バッジシステムの詳細仕様を検討し反映）
再々改定: 2026-07-25（リポジトリ本体（`tad-iizuka/FirebaseRTC`, HEAD=`990dd5d`）を
直接取得しソースコードを検証。README.mdの記述のみに基づく間接的な整理から、
実コード（token-server/ptt-client/ptt-ios/ptt-android）の直接確認に切り替えた）
四訂: 2026-07-25（「ジッターバッファ未実装」の記述を訂正。根拠にしていた
iOS READMEがLiveKit移行前の記述のまま更新されていなかったため誤りと判明。
3クライアントともLiveKit（WebRTC/NetEQ）に音声再生を委譲済みであり、
自前ジッターバッファは不要と判断）
五訂: 2026-07-25（「6. 次アクションの提案」内の「Guestロールの要件定義に
着手」という記述を訂正。Guest要件は「5. 詳細仕様」で既に確定済みであり、
旧版の記述はGuest仕様確定前に書かれたまま更新されていなかった内部矛盾
だった。実装着手が正しいネクストアクションである）
六訂: 2026-07-25（`ptt-ios/ptt-ios/README.md`をLiveKit移行後の実装に合わせて
実際に書き直し、Phase9・次アクションの該当項目を完了扱いに更新。ただし
リポジトリへの反映自体は未実施のため、次アクションとして残した。あわせて
「他ドキュメントの棚卸し」を新規の次アクションとして追加）
七訂: 2026-07-25（「他ドキュメントの棚卸し」を実施。`admin-dashboard/README.md`
はおおむね正確、`API.md`等はテンプレートのまま未記入と判明。加えて
`token-server/README.md`の「録音の開始/停止ボタンはWeb/iOSともに別途実装が
必要」という記述が、2026-07-24のWeb版実装後に更新されておらず陳腐化して
いることを発見。iOS READMEとは別の、同種の文書陳腐化の実例）
八訂: 2026-07-25（アップロードされたリポジトリ一式（HEAD=`e85dc28`）を再取得し
検証。六訂で「未実施」としていた`ptt-ios/ptt-ios/README.md`のリポジトリ反映、
および七訂で発見した`token-server/README.md`の録音UI記述の修正、
`admin-dashboard/README.md`の表現ズレ修正は、いずれも同一コミット
（`e85dc28 change README.md`）で**実際にリポジトリへ反映済み**であることを
`git show`で確認した。次アクションの該当項目を完了扱いに更新する）
九訂: 2026-07-25（「6. 残る空テンプレート文書の整備」を実施。`API.md`・
`DATA_MODEL.md`へ`token-server/README.md`の該当内容（API一覧テーブル・
Firestoreデータモデル）を転記し、`token-server/README.md`側の該当箇所は
転記済みである旨を明記した参照文へ置き換えた。ドキュメント棚卸しで唯一
残っていた未完了項目が解消されたため、次アクションの該当項目を完了扱いに
更新する）
十訂: 2026-07-25（iOS/Android版に通報UI・録音開始/停止UIを実装した。
Web版(`ptt-client`)の設計を移植する形で、`PTTRecordingStore`/
`PTTReportStore`相当の薄いストアを両OSに新設し、Room Metadata経由の
録音状態(`recording.active`/`startedAt`)購読を`PTTConnectionManager`
(iOS/Android双方)に追加した。これにより「1. 実コード確認済みの現状」の
機能差表、および「2-E. 3クライアント間の機能差」で挙げていた最後の項目が
解消された。一方、Web版のみが持つ「自動録音: ON」トグル
(`RecordingBar.vue`のautoRecording設定)はユーザーへ確認のうえ今回の
スコープ外として明示的に除外している。また、今回の変更はアップロードされた
ZIPアーカイブ（`ptt-ios.zip`・`ptt-android.zip`）に対して行い更新版ZIPとして
返却したものであり、`tad-iizuka/FirebaseRTC`リポジトリへの実際のコミット・
反映は本ドキュメント作成時点では未確認のため、六訂・八訂で
`ptt-ios/ptt-ios/README.md`について踏んだのと同じ確認プロセスを次アクション
として残す）
十一訂: 2026-07-25（十訂で実装したiOS/Android版の通報UI・録音開始/停止UIに
ついて、ユーザーから「リポジトリへ反映して動作確認は済んでいます」との
報告を受けた。**（重要な留保）** 六訂→八訂の確認プロセスとは異なり、今回は
リポジトリ本体（`.git`履歴）を再取得して`git show`等で直接検証したわけでは
なく、ユーザー本人からの申告のみに基づく。実コミットハッシュ・実機での
動作確認結果そのものは本ドキュメント側では確認できていない点に留意し、
「次アクションの提案」item 7はユーザー申告に基づく完了として扱うが、
過去の項目のような「確認済み」表現とは区別して記録する）
十二訂: 2026-07-26（Guestロールがサーバー・Web/iOS/Android全てで実装完了
したことを受け、ロードマップを「業態に依存しない土台」を軸に再編。
組織階層(Phase12→Phase11に繰り上げ)・役割と機能の整理(Phase12新設)・
バッジ基本機能(Phase11から分離しPhase13へ)を優先し、業界ラベリング層は
Phase2の具体的要件が確定するまでの着手条件付き(Phase15)へ後退させた。
あわせて「6. 次アクションの提案」がほぼ全項目完了済みだったため、完了分を
「6.1 完了済みアクション（アーカイブ）」へ集約し、新ロードマップに即した
次アクションへ刷新した）
十三訂: 2026-07-26（Phase11(組織階層)を実装し、token-server
（`lib/orgContext.js`新設・`routes/organizations.js`新設・`routes/rooms.js`・
`routes/admin.js`・`server.js`・`firestore.rules`変更）・admin-dashboard
（`OrganizationsView.vue`・`stores/adminOrganizations.ts`新設、
`RoomsListView.vue`・`RoomDetailView.vue`・`types/admin.ts`・
`router/index.ts`・`NavTabs.vue`変更）双方に反映した。実装過程での
やり取りを通じて、以下2点を運用方針として確定した。
(1) Room作成とRoomの組織階層への紐付けは分離する。Room作成は従来通り
PTTクライアントから行い、自動での組織紐付けは行わない。紐付けが必要な
Roomのみ、admin-dashboardのRoom詳細画面(`org-assignment`)で管理者が事後に
手動で行う。これに伴い、「ユーザー×団体の所属関係」（誰がどの団体に
属するか）の設計は当面不要と判断し、着手しない。
(2) 動作確認中、admin-dashboardのRoom詳細画面から招待コードを確認できない
ことが判明した。`token-server/routes/admin.js`の`GET /admin/rooms`・
`GET /admin/rooms/:roomId`はいずれも`inviteCode`を一度も返しておらず、
これはPhase11の実装漏れではなくAdmin API側の既存の仕様(招待コードは
`POST /rooms`作成時のレスポンスとしてのみ返却され、以降はどのAPIからも
再取得できない)であることを確認した。追加を検討する場合、`rooms:monitor`
権限保有者に「Roomへの参加権を事実上配布できる」権限まで広げることになる
ため、Phase12(役割と機能の整理)でrole×操作の対応表と合わせて検討する
持ち越し事項として5.4・Phase12双方に記録する（詳細は該当箇所参照）
十四訂: 2026-07-26（「6. 次アクションの提案」item 1「Phase12 role×操作の
対応表の洗い出し」を実施し、判明した論点のうち挙動を変える3点
（通報API・Room作成API・moderator任命API）についてユーザーの意思決定を
得た上で実装した。対応表の一元化そのものとして`token-server/lib/
permissions.js`を新設し、`routes/rooms.js`・`routes/recording.js`の
個別ホワイトリストをここからの参照に置き換えた。3クライアント側の
role分岐の統一方針は本改定のスコープ外として次アクションに残した。
詳細は「6.1」item 10参照。※本改訂時点で本欄（改定履歴）への追記が
漏れていたため、十五訂時点で遡って追加している）
十五訂: 2026-07-26（十四訂で「未着手」として残した3クライアント側の
role判定統一方針を検討し方針を確定した。(1) サーバーの対応表を実行時に
APIとして配信する方式は見送り、`lib/permissions.js`をSSOTとしつつ
値の一致をビルド時/CIの機械的チェックで保証する方式とする。クライアント側
で実際にrole分岐している箇所は現状「owner||moderator」「role==='guest'」の
2値のみであることをコード確認した上での判断で、現場利用を前提とする
PTTアプリの性質上、権限判定に起動時ネットワーク依存を持ち込むリスクの
方が大きいと判断した。(2) 「Room作成」非表示に使う`isAnonymous`と、
入室後のUIに使う`role`は、統一すべき同一軸ではなく意図的に異なるスコープ
（`isAnonymous`=入室前から判定可能なアカウント種別、`role`=入室後のみ
存在するRoom内での役割）であることを3クライアントのコードで確認し、
統一ではなく使い分けの明文化で決着した。詳細は「6.1」item 11・
Phase12参照）
十六訂: 2026-07-26（十五訂で確定した方針を実装した。(1) `token-server/lib/
permissions.js`をSSOTとし、3クライアントの管理者ロール定数
(`ptt-client/src/lib/roomPermissions.ts`・`ptt-ios/ptt-ios/
PTTRoomPermissions.swift`・`ptt-android/.../ban/PTTRoomPermissions.kt`)を
新設して`RoomView.vue`/`ContentView.swift`/`PTTApp.kt`の該当箇所を
置き換えた。(2) 4ファイルの値の一致をビルド時に機械的検証する
`scripts/check-role-sync.js`を新設し、実際に「値をわざと崩す→検知される
→戻す→成功する」ことを動作確認した。CIへの組み込みとして
`.github/workflows/role-sync-check.yml`も追加した。(3) `isAnonymous`/`role`
の使い分けを`RoomSelectView.vue`・`ContentView.swift`・`PTTApp.kt`の
該当箇所にコメントとして明文化した。(4) 実装中に、`ContentView.swift`の
Room作成ボタン非表示箇所にあったコメント「token-server側(POST /rooms)は
role判定をしないため」が、十四訂でのサーバー側Guest拒否実装後に更新
されていなかった陳腐化コメントであることを発見し、あわせて訂正した
（iOS READMEの件と同種の"実コード追随漏れ"の再発）。
**（重要な留保）** 今回の変更はアップロードされたリポジトリ一式に対して
行ったものであり、`tad-iizuka/FirebaseRTC`リポジトリ本体への実際の
コミット・CI実行結果そのものは本ドキュメント側では未確認。六訂・八訂で
踏んだのと同じ確認プロセス（`git show`等によるリポジトリ反映の直接検証）
を次アクションとして残す）
十七訂: 2026-07-26（十六訂の実装内容について、GitHub Actionsの実行画面
スクリーンショットの提示を受けた。コミット`263b855`("change role check")
に対して、新設した`Role Sync Check`ワークフローが green(✓, 10s)で完走して
いることを確認した。同一コミットで`Android CI`・`iOS CI`・`Web (ptt-client)
Deploy`も揃って green になっており、3クライアントとも今回のコード変更
(`PTTRoomPermissions`系ファイルの追加・呼び出し箇所の置き換え)が各言語の
ビルド・Lintを通過していることも合わせて確認できた。
**（留保の位置づけについて）** これは十一訂で「留保付きで完了扱い」とした
ユーザー申告のみの確認とは異なり、GitHub Actions実行画面という第三者
（GitHub）が生成した記録であり、特定のコミットハッシュに紐づいている点で
証拠としての強度は高い。一方、六訂・八訂で行った`git show`によるコミット
内容そのものの直接検証(diffの中身までは見ていない)とは異なる。そのため
本改定では「リポジトリへの反映・CI合格をスクリーンショットで確認」という、
両者の中間の確度として記録する。次アクションの該当項目は完了として
アーカイブへ移動する）
十八訂: 2026-07-26（「6. 次アクションの提案」item 1「Phase13 バッジ基本機能の
データモデル設計」を実施し、別ドキュメント`phase13-badge-schema.md`として
Firestoreスキーマ案（`badges`/`badgeGrants`/`config/badgeDisplay`の3
コレクション構成）を作成した。設計時、次アクション記載の「団体IDを持たない
シンプルな1マスタ構成」という前提と、「3. 優先順位付きロードマップ案」
Phase13本文の「バッジマスタは団体単位で保持する」という記述が本ドキュメント
内で矛盾していることに気づいた。今回のスキーマ案は次アクション側の前提
（団体IDなし）で作成したが、この矛盾自体は解消せず次アクションとして残す。
詳細は「6.1」item 13参照）
十九訂: 2026-07-26（十八訂で発見したPhase13本文の矛盾を解消した。「団体単位で
バッジマスタを保持する」という記述を検討した結果、以下2点の技術的な依存
関係により、Phase13単体では成立しないと判断し、次アクション側（団体IDなし・
シンプルな1マスタ構成）を正として確定した。(1) 団体単位でマスタを出し分ける
には「どのユーザーがどの団体に属するか」の判定が前提として必要だが、
「ユーザー×団体の所属関係」はPhase11(十三訂)で明示的に着手しないことが
既に確定している（Room作成と組織階層の紐付けを分離し、ユーザー個人が団体に
属するという概念自体を実装していないため）。(2) 「5.3 バッジシステム」の
「業種プロファイルの初期値はシステム管理者が登録・変更」という記述、および
Phase15の「バッジシステムを業種プロファイル単位・団体単位で複数マスタ
切り替え可能な形に拡張する」という記述から、マスタ管理は「業種プロファイル
（テンプレート）→団体（個別上書き）」の二階層構造であり、団体単位の上書きは
業種プロファイル単位の基盤（Phase15）があって初めて成立する。Phase13本文の
当該記述は、Phase13が「旧Phase11から分離」される前（バッジと組織階層が
一体だった頃）の記述が更新されずに残っていたものと判断し、以下を確定した。
- Phase13ロードマップ本文を「団体IDを持たないシンプルな1マスタ構成」に
  訂正し、`phase13-badge-schema.md`の設計方針との整合を取った
- 「5.4 洗い出された矛盾点・懸念点」に本件を解決済み事項として追記した
- 「6. 次アクションの提案」item 1（矛盾解消タスク）を完了扱いとし、
  「6.1」item 14へ移動した）
二十訂: 2026-07-26（アップロードされたリポジトリ一式(`FirebaseRTC.zip`)に対し、
Phase13バッジ基本機能を実装した。`phase13-badge-schema.md`のスキーマ案
(`badges`/`badgeGrants`/`config/badgeDisplay`)を土台に、token-server・
admin-dashboard・ptt-client(Web)へ反映した。

**実装内容:**
- `token-server`: `lib/badges.js`(新設。マスタCRUD・Guest仮想バッジの合成・
  grant/revokeの一意性制御をトランザクションで担保・Room参加者向けtopBadge
  計算)、`lib/permissions.js`(`badges:grant`/`badges:revoke`をownerのみに
  追加)、`routes/roomBadges.js`(新設。Room内owner専用のgrant/revoke・
  参加者向け閲覧)、`routes/badges.js`(新設。マスタ管理APIと、
  admin-dashboard向けのgrant/revoke並行パス。moderator任命APIが
  Room内owner専用パスとadmin-dashboard経由パスの2経路を持つ十四訂の設計を
  踏襲)、`firestore.rules`(badges/badgeGrants/configへの明示的な拒否
  ブロックを追加)
- `admin-dashboard`: `BadgesView.vue`(新設。バッジマスタのPoC管理画面。
  「5.3」が言う「バッジ管理画面のPoCをここで実施する」に対応)、
  `stores/adminBadges.ts`(新設)、`RoomDetailView.vue`のメンバー台帳に
  バッジ列を追加(付与/剥奪操作)、router/NavTabsに「バッジ」タブを追加
- `ptt-client`(Web): `stores/badges.ts`(新設。GET /rooms/:roomId/badges を
  20秒間隔でポーリング)、`ParticipantList.vue`に最優先1件のバッジアイコン
  表示を追加、`RoomView.vue`に配線

**実装時に確定した設計判断:**
1. Guestの役割バッジは設計通り、`badgeGrants`へ永続化しない仮想バッジ
   として実装した(role==='guest'から都度合成)。5.4「GuestIDとMember昇格の
   整合性」の対象外(そもそも永続化しないため矛盾の余地がない)。
2. **（`phase13-badge-schema.md`からの変更点）** 同スキーマ案「8.」は
   「badgesは全クライアント読み取り可」としていたが、実装時に撤回し、
   badges/badgeGrants/configいずれもクライアント直接読み取り不可
   (Admin SDK経由のAPIのみ)に統一した。参加者一覧の「最優先1個のみ表示」
   判定(badgeGrantsとbadgesの突き合わせ・Guest仮想バッジの合成)を
   Web/iOS/Androidそれぞれで再実装させると、Phase12で問題視した
   「同じロジックの分散実装」を再発させるため。判定済みの結果(topBadge等)
   を返すAPIに一本化し、Phase15で団体・業種プロファイル単位のマスタ
   切り替えが入った際も変更箇所をサーバー側だけに閉じ込められるようにした
   (詳細は`lib/badges.js`冒頭コメント・`phase13-badge-schema.md`該当箇所)。
3. Room内でのgrant/revokeは、Room内owner専用API(`routes/roomBadges.js`)と
   admin-dashboard経由のサイト管理者権限(`badges:manage`)の2経路を用意した。
   十四訂でmoderator任命APIに同じ構成(「room内のownerが不在・連絡が取れない
   場合にサイト管理者が代行できる手段」)を採用した前例に倣った。
4. **（5.4「他参加者のGuest判定手段の欠如」の副次的な解決、Webのみ）**
   `GET /rooms/:roomId/badges`はrole不問(room memberなら誰でも)閲覧可能
   なAPIとして実装したため、Guestの役割バッジも他の参加者から見える形に
   なった。これにより、5.4で「Phase10のスコープ外」としていた「他参加者の
   Guest判定手段の欠如」が、Web版に関しては副次的に解消された(Phase12で
   「他のユーザー情報も含めてどう取得するか」を検討してからという条件付き
   だったが、公開する情報がバッジ(役割表示のみ)に限定されるため、
   displayName以外の追加情報漏洩は無い)。iOS/Androidは未実装のため、
   両OSでは引き続き5.4の制約下にある。

**未実装のまま残した部分(次アクションへ):**
- iOS/Androidの参加者一覧へのバッジアイコン表示
- ptt-client(Web含む3クライアントいずれも)のRoom画面内でのOwnerによる
  付与/剥奪UI。現状、Room内ownerがバッジを付与/剥奪する手段は
  admin-dashboard経由(サイト管理者権限`badges:manage`が必要)のみであり、
  「5.3: 付与経路 Owner手動」が本来意図するRoom内完結の体験にはなっていない
  (token-server側のRoom内owner専用API自体は実装済みのため、UIを追加すれば
  すぐ使える状態)
- 自動付与バッチ処理(Phase13のスコープ外。「2.1」の条件型定義のみで判定
  ロジック・スケジュール実行基盤は未着手)
- Phase13ロードマップ本文の「バッジマスタは団体単位で保持する」との矛盾は
  十九訂で解消済みだが、本実装は解消後の方針(団体IDなし)に基づいている
二十一訂: 2026-07-27（次アクションitem3「iOS/Androidにバッジ表示UIを実装する」
を完了した。Android・iOSで実装の実施主体と本ドキュメント側の確認方法が異なる
ため、以下の通り区別して記録する。

**Android（ユーザー報告に基づく）**: `model/PTTModels.kt`にWeb版と同じ
フィールド構成の`AssignedBadge`・`RoomMemberBadges`を追加、`badges/
PTTBadgesStore.kt`(新設)で`GET /rooms/:roomId/badges`を20秒間隔でポーリング
(Web版`stores/badges.ts`と同じ設計方針。Androidには既存のポーリング
パターンがなかったため、`PTTConnectionManager.connect()`の
`idTokenProvider`パターンを踏襲した独自coroutineループとして実装)、
`MainActivity.kt`・`ui/PTTApp.kt`でストアの生成・`enterRoom`/`leaveRoom`
でのstart/stop・`ParticipantsSection`への`topBadges`受け渡しとアイコン表示
(`:title`ツールチップ相当として`contentDescription`)を配線した、との報告を
受けた。実装過程で`MainActivity.kt`のコメントに「iOS版(PTTBadgesStore.swift)
の移植」という誤記(この時点ではiOS側は未実装)が入ったが訂正済みとのこと
（六訂・十六訂で見られた"陳腐化コメント"とは逆の、実装順序を誤認した
コメントの実例）。本ドキュメント側では`git show`等によるコード自体の
直接確認は行っていない。

**iOS（本ドキュメント側で直接実装）**: `PTTBadgeStore.swift`(新設)で
Android同様`GET /rooms/:roomId/badges`を20秒間隔でポーリングし、
`ContentView.swift`の`enterRoom`/`leaveRoom`でstart/stop、参加者一覧の
各行(`participantRow`)にバッジアイコンを表示する形で配線した。
`README.md`もファイル構成・動作の仕組み・動作確認手順・既知の制約の各
セクションを合わせて更新した(過去のiOS README陳腐化の反省を踏まえ、
実装と同時に反映)。こちらはコード変更そのものを本ドキュメント側で
把握している。

**動作確認について**: 上記iOS・Android双方について、ユーザーから
「実機/エミュレータでの動作確認済み」との報告を受けた。**（重要な留保）**
これは十一訂・八訂の項目8と同水準の、ユーザー申告のみに基づく確認であり、
六訂・八訂で行った`git show`によるコミット内容の直接検証や、十七訂で行った
GitHub Actions実行画面という第三者記録による確認とは異なる。特にAndroid側は
コード自体を本ドキュメント側で見ていないため、確度としては最も低い部類に
あたる点に留意する。

これにより、Phase13「残作業」のうち「iOS/Androidの参加者一覧へのバッジ
アイコン表示」が3クライアントすべてで完了となり、次アクションitem3を
「6.1 完了済みアクション（アーカイブ）」へ移動する。残る次アクションは
item3（3クライアント共通のRoom内owner向け付与/剥奪UI）のみとなる。

あわせて、5.4「他参加者のGuest判定手段の欠如」について、二十訂時点では
「Web版のみ副次的に解消、iOS/Androidは引き続き制約下」としていた記述を、
「3クライアントすべてで解消」に更新する（Guestの役割バッジもiOS/Androidの
参加者一覧に表示されるようになったため）
二十二訂: 2026-07-27（バッジの付与/剥奪の実行場所について設計変更を行った。
二十訂の実装では、admin-dashboardからのバッジ付与/剥奪はRoomDetailView.vue
のメンバー台帳から行う設計だったが、`badgeGrants`はそもそもroomIdを持たない
ユーザー単位のレコードであり(`lib/badges.js`参照)、Room詳細画面から付与する
のは「そのRoomの参加者一覧からuidを見つけられた」という実装上の都合に
すぎず、バッジという概念自体とは無関係というユーザー指摘を受け、新設の
「ユーザー管理」画面に一本化した。

**背景の技術的制約**: このアプリには「全ユーザー一覧」を返すAPIも
「ユーザー×団体の所属関係」(Phase11で明示的に非実装)も存在しなかったため、
Room文脈なしに付与対象ユーザーを見つける手段がそもそも無かった。これが
二十訂時点でRoom詳細画面に間借りする設計になっていた実質的な理由である
(`BadgesView.vue`のコメントにもその旨明記されていた)。この制約を解消する
ため、Firebase Authを唯一のグローバルなユーザー台帳とみなし、Admin SDKの
`auth.listUsers`を新規に利用することにした。またこのアプリのMemberは
メールアドレス認証必須(5.2)である一方、Guest(匿名認証)はメールアドレスを
持たないため、「emailを持つユーザーに絞り込む」だけで検索一覧から自然に
Guestを除外できることを確認した。

**実装内容**:
- `token-server`: `routes/users.js`(新設)に`GET /admin/users`(メール
  アドレス部分一致検索、新設の`users:monitor`権限)・`GET /admin/users/:uid`
  (プロフィール+バッジ)・`POST/DELETE /admin/users/:uid/badges*`(付与/剥奪。
  「どの画面から行うかで必要な権限が変わるのは不自然」という考え方から、
  Room詳細画面向け経路が持っていたのと同じ既存の`badges:manage`権限を
  そのまま踏襲し、新規権限は用意していない)を実装した。`routes/badges.js`
  からはRoom内メンバー向けの旧付与/剥奪エンドポイント
  (`POST/DELETE /admin/rooms/:roomId/members/:targetUid/badges*`)を削除し、
  「このRoomの現在のメンバーが何を持っているか」を見るための読み取り専用
  API(`GET /admin/rooms/:roomId/badges`)のみを残した
- `admin-dashboard`: 新設の型`AppUserSummary`/`AppUserListResponse`/
  `AppUserProfile`(既存の`AdminUserEntry`等はサイト管理者権限保有者を指す
  別概念のため、名前が衝突しないよう別プレフィックスにした)、新設の
  `stores/userDirectory.ts`(既存の`stores/adminUsers.ts`が
  「サイト管理者権限を持つ人」向けに既に使われている名前だったため、
  別名にした)、新設の`views/UsersView.vue`(一覧・検索)・
  `views/UserDetailView.vue`(プロフィール・バッジ付与/剥奪)、
  `router/index.ts`・`components/NavTabs.vue`への`/users`・`/users/:uid`
  ルートと「ユーザー」タブの追加。`views/RoomDetailView.vue`は付与/剥奪の
  編集フォームを削除し、読み取り専用のバッジ表示と「ユーザー管理で編集→」
  リンク(uidで`UserDetailView.vue`へ遷移)に置き換えた。`stores/
  adminBadges.ts`からは今回不要になったRoom内メンバー向けgrant/revoke
  関数を削除し、マスタCRUDとRoom詳細画面向けの読み取り専用表示のみを残した

**画面のスコープについて**: 「今回はバッジ付与/剥奪のみのシンプルな画面に
するか、将来のユーザー無効化等の他操作も見据えた拡張しやすい構成にするか」
をユーザーに確認したところ、後者(拡張しやすい構成)を選択された。これを
受け、`GET /admin/users`・`GET /admin/users/:uid`のレスポンスには
Firebase Authが標準で持つ`disabled`フィールドを先行して含めている
(5.2「削除の実体: ユーザー無効化」の将来実装への布石。`auth.updateUser(uid,
{ disabled: true })`で実現できる見込みだが、本改定のスコープ外のため
未実装のまま)。

**動作確認について**: 本改定の実装後、`vue-tsc -b`(型検査)・`eslint .`・
`npm run build`(本番ビルド)がいずれもエラーなく完了することを本ドキュメント
側で直接確認した。ただし実機/ブラウザでの動作確認(実際にユーザーを検索し、
バッジを付与/剥奪できるか)はユーザー側で別途行う必要がある。

なお、「5.3 バッジシステム」の「管理画面」欄が「Phase11でPoCを実施」という、
旧Phase11(バッジと組織階層が未分離だった頃)の記述のまま更新されていな
かった箇所も本改定で見つけたため、あわせて「Phase13でPoCを実施」に訂正した
(六訂で見られたのと同種の、実装分割の経緯を反映しきれていなかった記述の
陳腐化)。)

> 本改定では、アップロードされた `README.md`（"Connect to a place, not to a person."）に
> 明記されたビジョン・原則・ターゲットロードマップを"あるべき姿"の物差しとして採用し、
> 実装済みコードとの差分を再整理した。前版（初回作成）は実装状況の一般的な整理に
> 留まっていたが、本版はプロダクトビジョンとの整合性を軸に組み直している。
>
> **2026-07-25の再々改定について**: これまでの版はREADME.mdおよび口頭の検討内容を
> 前提に組み立てられており、実コードを直接参照していなかった。今回リポジトリ一式
> （`.git`履歴含む）を取得し、`token-server/routes/`・3クライアントのソースを
> grepベースで直接確認した結果、**テキストチャット機能（Communication Modelの
> "Text" Event）がサーバー・Web・iOS・Android全てに既に実装済み**であることが判明した
> （2026-07-08の`add: chat`コミット以降、一度も本計画に記載されていなかった）。
> その他の項目（Guestロール・業界ラベリング・組織階層・
> バックグラウンド動作・通報/録音UIのiOS/Android未実装）については、前版の記述が
> 実コードと一致していることを確認した。

---

## 0. README.mdが定義するビジョンの要点（前提の再確認）

| 項目 | README.mdの定義 |
|---|---|
| ミッション | 「人ではなく場（Room）につながる」。Friend中心ではなくRoom中心 |
| Core Principles | ① Room First ② Temporary Relationships（一時的な関係） ③ Privacy First（電話番号・本名不要） ④ Real-Time First |
| Communication Model | 全てを`Event`として扱う（Voice/Text/Image/File/Location/Reaction/System/AI Message） |
| Participant Model | Human/AI/Botを同じ`Participant`概念として扱う（AIを特別扱いしない） |
| Permission Model | `Owner → Moderator → Member → Guest`。**業界ごとの名称はUIだけ変更する** |
| Target Roadmap | Phase1: 警備業（安定性・音質・低遅延・権限管理・ログ管理） → Phase2: ビジネスチーム（イベント運営・展示会・自治体等） → Phase3: コンシューマー |
| Long-Term Architecture | 実装は業界非依存。警備業=`Company→Branch→Site→Room`、一般=`Community→Group→Room`。**UIだけ変わり内部構造は同じ** |
| Future Features | Public/Temporary Rooms、QR/NFC/Nearby Join、AI Participants、Live Translation、Spatial Audio、Transcription、AI Summary/Moderation 等 |

この物差しに照らすと、現在の実装は **「Phase1（警備業）の土台は完成しつつあるが、
Phase1の目的そのもの（音質・低遅延の作り込み）とPermission ModelのGuest、
Long-Term Architectureの組織階層はまだ手つかず」** という状態にある。なお
2026-07-25の実コード検証により、Communication Modelの`Text` Event
（テキストチャット）は3クライアント・サーバー双方で既に実装済みであることが
判明しており（詳細は「1. 実コード確認済みの現状」参照）、Phase1の要件外の
部分ではあるが着実に前進している。

## 1. 実コード確認済みの現状（README改定前の分析を上書き）

サーバー(token-server)はPhase 1〜8まで実装済み（認証・招待制ルーム・BAN・
送話ロック・録音Egress・Webhook・moderator任命API・監査ログ・管理者権限API・
GCS/FirestoreのTTL/ライフサイクル管理・**テキストチャットAPI**）。クライアント
3種(Web/iOS/Android)もBAN・送話ロック・オンボーディング・i18n・
デザイントークン統一・**テキストチャットUI**まで実装済みで、管理者サイトも
Vue 3の本格SPA(`admin-dashboard/`)へ刷新済み。

**（2026-07-25再々改定時の追記）** `token-server/routes/messages.js`（Phase5、
2026-07-08実装）と、Web(`ChatPanel.vue`/`stores/chat.ts`)・iOS
(`PTTChatStore.swift`)・Android(`PTTChatStore.kt`)の3クライアントを直接確認した
結果、**テキストチャット（README.mdのCommunication Modelが定義する`Text` Event）
は3プラットフォームすべてで実装済み**であることが判明した。設計は
LiveKitのData Channelを使わず、書き込みをtoken-server経由に一本化し
Firestoreの`rooms/{roomId}/messages`をリアルタイム配信元とすることで、
BAN即時反映（`status: 'banned'`になった瞬間`firestore.rules`側で読み取り権限も
失う）と同じモデレーション強制パターンを踏襲している。一方、Communication
Modelが定義する残りのEvent種別（Image/File/Location/Reaction/System/AI
Message）はコード上どこにも見当たらず、依然として未着手である。

**機能の作り込みという意味では従来の想定より進んでいる。** 一方で、README.md
が定義する3つの原則──①Permission ModelのGuestロール、②業界ごとに名称だけ
差し替えるラベリング層、③Company/Branch/Site等の組織階層──は**まだ実装されて
いない**。これらはPhase1(警備業)を"完成"と呼べるかどうかの分水嶺であり、
かつPhase2(ビジネスチーム)へ進む前提条件でもあるため、ここに焦点を当てて
計画を組み直す。

| 領域 | Web | iOS | Android | 備考 |
|---|---|---|---|---|
| サインイン・ルーム作成/参加 | ✅ | ✅ | ✅ | |
| オンボーディング画面 | ✅ | ✅ | ✅ | |
| 送話ロック(排他制御) | ✅ | ✅ | ✅ | |
| BAN機能UI | ✅ | ✅ | ✅ | |
| 多言語化(i18n) | ✅ ja/en | ✅ xcstrings | ✅ strings.xml | |
| デザイントークン統一 | ✅ | ✅ | ✅ | `shared/design-tokens.css`等で一元管理 |
| 通報機能UI | ✅ | ✅ | ✅ | 2026-07-25、Web版を移植する形でiOS/Androidに実装完了（十訂） |
| 録音の開始/停止UI | ✅ | ✅ | ✅ | 同上。録音中判定はRoom Metadata経由で`PTTConnectionManager`が確定状態を保持 |
| **自動録音トグル(auto-recording ON設定)** | ✅ | ❌ | ❌ | Web版`RecordingBar.vue`のみの機能。iOS/Androidは今回意図的にスコープ外（ユーザー確認済み、2026-07-25） |
| **テキストチャット(Text Event)** | ✅ | ✅ | ✅ | `token-server/routes/messages.js`(Phase5)＋3クライアント。2026-07-08実装、本計画では今回初めて記載 |
| バックグラウンド動作 | - | ⚠️設定のみ・未検証 | ❌未実装 | |
| **Guestロール** | ✅ | ✅ | ✅ | 2026-07-25 実装完了。`token-server`のrole自動判定(匿名認証)・3クライアントのGuest導線・ニックネーム変更UI・Guestバッジ(自分自身のみ)まで対応。他参加者のGuest判定は当初別途検討としていたが、下記バッジシステム経由で3クライアントとも解消済み（2026-07-27、二十一訂。詳細は5.4参照） |
| **業界別ラベリング(UIのみ差し替え)** | ❌ | ❌ | ❌ | 「警備業向け」の文言・概念が全画面にハードコード |
| **組織階層(Company/Branch/Site)** | ❌ | ❌ | ❌ | データモデルはRoom直下がフラットなまま |
| **バッジシステム(表示・Owner手動付与/剥奪)** | ✅表示/✅付与 | ✅表示/❌付与 | ✅表示/❌付与 | Phase13。表示は2026-07-26(Web、二十訂)・2026-07-27(iOS/Android、二十一訂)で3クライアントとも完了。付与/剥奪のRoom内完結UIは3クライアントとも未実装で、admin-dashboardの「ユーザー管理」画面経由のみ操作可能(2026-07-27、二十二訂でRoom詳細画面から移設。次アクションitem3参照) |

管理者サイトは`admin-dashboard/`(Vue 3+TS+Pinia)としてルーム一覧/詳細・
監査ログ・管理者権限・録音履歴DLまで実装済み。閲覧専用だった旧
`dev-tools/admin-dashboard.html`とは別物として本番投入可能な水準にある。

---

## 2. README.mdのビジョンに照らした課題整理

### A. Permission Model：Guestロールの欠落

README.mdは`Owner → Moderator → Member → Guest`の4段階を定義しているが、
現行実装(`token-server/routes/rooms.js`)は`owner`/`moderator`/`member`の
3種のみ。Guestが想定する「一時参加・権限最小・名前だけ登録して即解散」
というPrivacy First/Temporary Relationshipsの体験が今のところ存在しない。

- Guestロールの権限定義（例: 送話不可・閲覧のみ、あるいは招待コードだけで
  本登録なしに一時参加できる、等）をまず要件として固める
- Firestoreのroleフィールド・Firestoreルール・BAN/moderator任命APIの
  権限チェック全箇所への影響範囲の洗い出しが必要

### B. 業界ごとのUIラベリング層が未着手

README.mdは「実装は業界に依存させない。業界ごとの名称はUIだけ変更する」と
明言しているが、現状の3クライアントは"警備業"を想定した文言・概念
（ルーム、招待コード等）が直接ハードコードされており、Phase2(イベント運営・
展示会・自治体等)向けに名称を差し替える仕組みが存在しない。

- i18n基盤(すでにja/en等で導入済み)を「言語」だけでなく「業種プロファイル」
  の文言差し替えにも転用できるよう、キー設計を拡張するのが現実的な入り口
- 例: `role.owner`を業種設定に応じて「現場責任者」「イベント主催者」等に
  出し分けるレイヤーを追加

### C. Long-Term Architecture：組織階層の欠如

README.mdの警備業モデル`Company → Branch → Site → Room`、一般モデル
`Community → Group → Room`はいずれも未実装。現行のデータモデルは
Room単体がフラットに存在するのみで、複数拠点・複数現場をまたいだ管理者
ビューが作れない。

- Phase2以降(複数現場を横断して管理したい警備会社、複数拠点を持つ
  イベント運営会社)に進む前に、最低限「Room の上位に何らかのグルーピング
  概念を1段挟めるようにする」設計判断が必要
- 管理者サイト(`admin-dashboard`)のルーム一覧も、現状は全ルームがフラットな
  一覧のため、階層が入った時点でナビゲーション設計をやり直す必要がある

### D. Phase1(警備業)としての完成度に直結する残課題

README.mdのPhase1の目的は「安定性・音質・低遅延・権限管理・ログ管理」。
権限管理・ログ管理はPhase8でほぼ到達済みだが、**音質・低遅延**の作り込みは
バックグラウンド動作を除き大きな課題は見当たらない。

- ~~ジッターバッファ未実装~~ **（2026-07-25訂正）** 前版はiOS README
  （`ptt-ios/ptt-ios/README.md`）の「受信したOpusバイナリフレームを
  `AVAudioPlayerNode`にスケジュールして再生」という記述を根拠にジッター
  バッファ未実装としていたが、このREADMEは**LiveKit移行前（自前WebSocket+
  AVAudioEngine+swift-opus実装時代）の記述が更新されずに残っていたもの**
  だった。実際には3クライアントとも`livekit-client`(Web)/
  `livekit-android`(Android)/LiveKit Swift SDK(iOS)経由でLiveKit Cloudに
  接続しており（`PTTConnectionManager.swift`のコメントに「LiveKit移行」と
  明記）、音声の送受信・再生はLiveKit（内部はWebRTC/libwebrtc）に委譲されて
  いる。WebRTCの音声エンジンはNetEQと呼ばれる適応型ジッターバッファ・
  パケットロス隠蔽・タイムストレッチを標準で備えているため、**自前の
  ジッターバッファ実装は不要**と判断する。優先度が高いのはむしろ、
  実態と乖離した`ptt-ios/ptt-ios/README.md`を現行のLiveKitベース構成に
  合わせて書き直すことである（誤った実装判断の再発防止のため）
- バックグラウンド動作: iOSは設定のみで実機未検証、Androidは
  ForegroundService自体が未実装。警備現場で「アプリを閉じたら送受話が
  切れる」のはPhase1の要件と矛盾する

### E. 3クライアント間の機能差 → 解消（2026-07-25、十訂で完了）

~~通報UI: Web版のみ。iOS/Androidは未実装~~
~~録音の開始/停止UI: Web版のみ。iOS/Androidは録音中フラグの受信のみで
操作ボタンがない~~

**（2026-07-25 十訂）** iOS/Android双方に、Web版(`ptt-client`)の設計を
移植する形で通報UI・録音開始/停止UIを実装した。

- **通報**: `PTTReportStore`(iOS: Swift / Android: Kotlin)を新設し、
  `POST /reports`(token-server/routes/reports.js)を呼ぶだけの薄いストアと
  した(Web版`RoomView.vue`の`reportParticipant`の移植)。実際の対応
  (内容確認・BAN実行)はモデレーターがFirestoreの`reports`コレクションを
  見て手動で行う運用は変えていない
- **録音**: `PTTRecordingStore`を新設し、`/rooms/:roomId/recording/start`・
  `/recording/stop`を呼ぶ。ただしこのAPIのレスポンスは「開始/停止を
  試みた/依頼した」ことしか意味せず、実際に録音中かどうかの確定状態
  (active/startedAt)は送話ロックと同じくRoom Metadata経由で
  `PTTConnectionManager`に非同期反映される設計とし、Web版
  `RecordingBar.vue`と同じ「同意表示」の考え方(録音中は全参加者へ
  常時開示)を踏襲した

ただし以下は今回のスコープ外として明示的に除外している(ユーザーへ確認済み)：

- **自動録音トグル(auto-recording ON設定)**: Web版にのみ存在する「入室時に
  自動的に録音を開始する」設定と、その事前開示バナー。iOS/Androidは
  対応していない。将来対応する場合は、設定の永続化先(Firestoreの
  `rooms/{roomId}`ドキュメント等)・事前開示バナーの文言・開始トリガーの
  実装場所(クライアント側かtoken-serverのwebhook側か)を先に洗い出す必要が
  ある

**成果物の反映状況について**: 今回の実装はアップロードされたZIPアーカイブ
（`ptt-ios.zip`・`ptt-android.zip`）に対して行い、更新版ZIPとして返却した。
**（2026-07-25 十一訂）** ユーザーから「リポジトリへ反映して動作確認は
済んでいます」との報告を受けた。ただし六訂・八訂で
`ptt-ios/ptt-ios/README.md`について踏んだような、リポジトリ本体を
再取得し`git show`等で直接検証するプロセスは今回実施していない。
ユーザー申告に基づく完了として扱う。

### F. Future Featuresとの距離（優先度は低いが記録のため）

QR/NFC/Nearby Join、AI Participants、Live Translation、Spatial Audio、
Transcription、AI Summary/Moderation等はREADME.mdが「将来追加できるように
設計しておく」と位置づける項目であり、現時点では未着手。Participant Model
（Human/AI/Botを同一概念として扱う）を見据えるなら、現行の
`members`コレクションのスキーマがHuman以外のParticipant種別を将来
無理なく追加できる形になっているか、早めに一度レビューしておくとよい。

**（2026-07-25追記）** README.mdのCommunication Model（Voice/Text/Image/File/
Location/Reaction/System/AI Messageを全て`Event`として扱う）については、
Voice（PTT本体）に加えてText（テキストチャット）が既に3クライアント・サーバー
双方で実装済みであることを確認した。これはPhase1(警備業)が直接必要とする
機能ではないが、「全てをEventとして扱う」という設計思想が最低限2種類の
Eventで実証されている状態と言える。残りのImage/File/Location/Reaction/
System/AI Messageは未着手のままであり、Guestロール・組織階層と同様、
Phase2以降で本格的に必要になった際に、既存のText Event実装（token-server
経由での書き込み一本化＋Firestoreリアルタイム配信＋BAN連動）と同じ設計
パターンを踏襲できるかを確認しておくと着手コストを抑えられる。

---

## 3. 優先順位付きロードマップ案（README.mdのTarget Roadmapに整合）

### Phase 9: Phase1(警備業)を名実ともに完成させる
README.mdのPhase1目的（安定性・音質・低遅延）のうち、権限管理・ログ管理は
Phase8で到達済み。音質・低遅延はLiveKit（WebRTC/NetEQ）への移行により
実質的に対応済みと判断し、残る安定性面とクライアント間の機能差を埋める。

- ~~ジッターバッファの実装~~ **不要と判断（2026-07-25訂正）**。LiveKit
  SDK経由でWebRTCの音声パイプライン（NetEQ）に委譲済みのため、自前実装は
  対応不要。
  ✅ **完了（2026-07-25）**: `ptt-ios/ptt-ios/README.md`をLiveKit移行後の
  実装内容に合わせて書き直した（旧AVAudioEngine実装時代の記述が残っており、
  今回のジッターバッファ誤判断の直接原因になっていたため）。依存パッケージ
  （LiveKit Swift SDK 2.15.1・firebase-ios-sdk 12.15.0・GoogleSignIn-iOS
  9.2.0）・ファイル構成・サインイン〜PTT〜送話ロック〜BAN〜チャットの
  現行の仕組みを実コードから書き起こし済み。
  ✅ **リポジトリへの反映も完了（2026-07-25, コミット`e85dc28`）**:
  `ptt-ios/ptt-ios/README.md`本体が新記述に置き換わっていることを
  `git show e85dc28 -- ptt-ios/ptt-ios/README.md`で確認済み
- iOS: バックグラウンド動作の実機検証・本実装
- Android: ForegroundServiceの実装
- ~~iOS/Androidへの通報UI・録音開始/停止UIの実装（Web版を移植）~~
  ✅ **完了（2026-07-25、十訂）**: Web版(`ptt-client`)の設計を移植する形で、
  iOS(`PTTRecordingStore.swift`/`PTTReportStore.swift`)・
  Android(`PTTRecordingStore.kt`/`PTTReportStore.kt`)双方に実装した。
  Room Metadata経由の録音状態(`isRecording`/`recordingStartedAt`)購読も
  `PTTConnectionManager`に追加している。Web版の自動録音トグルはスコープ外
  として意図的に除外(ユーザー確認済み)。
  ✅ **リポジトリへの反映・動作確認も完了（2026-07-25、十一訂）**:
  ユーザーからリポジトリ反映・動作確認済みとの報告を受けた
  （`git show`等による本ドキュメント側での直接検証は未実施。ユーザー
  申告に基づく完了として扱う）

### Phase 10: Permission ModelにGuestロールを追加 → **実装完了（2026-07-25）**
2026-07-25の検討により要件を確定し、同日中にサーバー・Web/iOS/Androidの
3クライアントすべてに実装した。詳細は「5. Guestロール・バッジシステム
詳細仕様」を参照。

**実装内容:**

- `token-server`: `POST /:roomId/join`でFirebase IDトークンの
  `firebase.sign_in_provider`が`anonymous`かどうかを見て`role: 'guest'`を
  自動判定（クライアントの自己申告に依存しない）。送話可能・権限系API
  （BAN・moderator任命・録音操作等）は既存のホワイトリスト方式により
  追加実装なしで非表示・拒否される
  - 例外: `POST /:roomId/members/:targetUid/role`（moderator任命API）は
    Guestを対象にした場合を明示的に拒否するガードを追加（本人確認のない
    匿名認証由来のGuestをmoderatorに任命できる抜け道を塞ぐため）
  - `PATCH /:roomId/nickname`（新規）: 本人のみ、自分のdisplayNameを
    変更可能（30文字以内）
  - `firestore.rules`は変更なし（Admin SDK経由の書き込みのみのため）
- `admin-dashboard`: `AdminMember.role`型に`'guest'`を追加（表示は素通しのため他は無変更）
- Web/iOS/Android 3クライアント: 「ゲストとして参加」ボタン（匿名認証）、
  Guestは「ルームを作成」非表示、ニックネーム変更UI、Guestバッジ表示
  （自分自身のみ。他参加者のGuest判定はスコープ外、5.4参照）

**今回のスコープ外として明示的に見送った項目:**

- Guest→Member昇格導線 → **対象外（確定）**。昇格導線・APIは実装しない。
  GuestIDは生成された状態のまま保持し、他ID体系との紐付け・統合は一切
  行わない。監査ログ上もGuestとMemberは常に別ID・別人物の記録として扱う
  （`promotedFrom`等の紐付けフィールドも持たせない）
- 他参加者のGuestバッジ表示 → 見送り。room memberなら誰でも呼べる
  「メンバー一覧API」が現状存在せず、かつ「Guestか否かだけでなく他の
  ユーザー情報も含めてどう取得するか」を別途検討したいとの方針のため
  （5.4参照）
- Guest認証自体の招待制化（匿名認証ボタン自体には制限がなく、招待コードを
  持たない相手でも押せてしまう点）→ 課題として記録のみ（5.4参照）、未着手

業種プロファイルとの関係：警備業では通常Guestは発生せず、デモ・
特定用途でのみ利用される想定。Phase2以降（イベント運営等）での
利用頻度の方が高くなる可能性がある。

### Phase 11: 組織階層(Long-Term Architecture)の導入 → **旧Phase12を繰り上げ（2026-07-26）**
業態にかかわらず必要な基盤であり、かつバッジマスタの団体単位管理
（旧Phase11後半）・管理者サイトの階層ナビゲーション等、後続の複数機能が
これに依存するため優先度を上げた。

- Room の上位グルーピング概念（Company/Branch/Site、あるいは
  Community/Group）をデータモデルに追加
- 管理者サイトのルーム一覧を階層ナビゲーションに対応させる
- 既存のフラットなRoomデータからの移行方針を設計する

### Phase 12: 役割(Role)と機能(Permission)の整理・UI/UX基盤化 → **新設（2026-07-26）**
Guestロール追加（Phase10）で顕在化した課題。現状、role別の権限チェックが
サーバー側は各エンドポイントにホワイトリストとして、クライアント側も
`canBan`/`canControlRecording`のような画面ごとの算出プロパティとして
バラバラに分散実装されている。owner/moderator/member/guestという4段階が
出揃った今のタイミングで、一度整理しておく。

- サーバー側: 「role × 操作」の対応表を`token-server`内に一元化し、
  各ルートのホワイトリスト分岐をその対応表からの参照に置き換える
  （現状は`rooms.js`・`recording.js`にそれぞれ個別のホワイトリストが
  ハードコードされている）
- クライアント側: 3クライアント共通の「role別に何が見えるべきか」の
  仕様を明文化し、UIコンポーネント側もその仕様を単一のソースから
  参照する形に揃える（現状はban.ts/PTTBanStore.swift等がそれぞれ
  個別に`myRole === 'owner' || myRole === 'moderator'`を書いている）。
  → **方針確定（2026-07-26、十五訂）**: 実行時にサーバーからAPI配信する
  方式は見送り、`lib/permissions.js`をSSOTとしつつ値の一致を
  ビルド時/CIの機械的チェックで保証する方式を採る。3クライアントで
  実際にrole分岐している箇所は現状「owner||moderator」「role==='guest'」
  の2値のみ（grep確認済み、owner単独・moderator単独を区別する分岐は
  存在しない）で、権限判定に起動時ネットワーク依存を持ち込むほどの
  複雑さは今のところない。将来role構成が本格的に複雑化した時点で
  API配信方式への昇格を再検討する。あわせて「Room作成」非表示の
  判定軸（`isAnonymous`）と入室後UIの判定軸（`role`）は統一すべき
  同一軸ではなく、`isAnonymous`=入室前から判定可能なアカウント種別、
  `role`=入室後のみ存在するRoom内での役割という、意図的に異なる
  スコープであることを3クライアントのコードで確認した（未入室の
  「Room作成」画面ではRoom memberドキュメントが存在せず`role`自体が
  判定不能なため、この使い分けは必然）。統一ではなく、この使い分けを
  コード上・ドキュメント上で明文化することを次アクションとする
  （詳細は「6.1」item 11参照）
- 上記の整理と合わせて、role別のUI/UX（メニュー構成・案内文言等）を
  一通り棚卸しし、Guestロール導入で生まれた表示の抜け漏れ
  （例: 5.4の「他参加者のGuest判定手段の欠如」）の解消方針もここで検討する
- **（2026-07-26追加）招待コードの可視範囲**：`GET /admin/rooms`・
  `GET /admin/rooms/:roomId`はいずれも`inviteCode`を返しておらず、
  admin-dashboard側からRoomの招待コードを確認する手段が現状存在しない
  （Phase11実装時の動作確認で判明。詳細は5.4参照）。追加する場合、
  `rooms:monitor`権限保有者に実質的な「Roomへの参加権配布」権限まで
  広げることになるため、対象権限を`organizations:manage`等に絞るか、
  閲覧自体を監査ログ(`logAdminAction`)に残すか、role×操作の対応表
  整理の一環としてここで方針を決める

### Phase 13: バッジシステムの基本機能 → **旧Phase11から分離（2026-07-26）→ 大部分実装完了（2026-07-26、二十訂）→ 表示機能は3クライアント完了（2026-07-27、二十一訂）**
業種プロファイルに依存しない部分のみ先行実装する。業種プロファイル単位の
自動付与条件・団体単位でのマスタ書き換えはPhase15（業界ラベリング層）側に
分離し、Phase2の具体的な需要が見えてから着手する。

- バッジの基本機能（詳細は「5.3 バッジシステム」参照）
  - ✅ **完了（2026-07-26、二十訂 → 2026-07-27、二十二訂で付与/剥奪の
    実行場所を変更）**: アイコン表示、Owner手動付与・剥奪（token-server +
    admin-dashboard。付与/剥奪はRoomDetailView.vueではなく新設の
    「ユーザー管理」画面(`UsersView.vue`/`UserDetailView.vue`)から行う形に
    二十二訂で変更した。3クライアントのRoom内owner向けUIは未実装、
    次アクション item3参照）
  - ✅ **完了（2026-07-27、二十一訂）**: 優先順位に基づく表示、
    Room内・参加者一覧では最優先1個のみ表示。Webは2026-07-26(二十訂)、
    iOS/Androidは2026-07-27(二十一訂)で実装完了し3クライアントすべてで
    対応済み（Android実装はユーザー報告に基づく。詳細は改定履歴・
    「6.1」item16参照）
  - ✅ **完了（2026-07-26、二十訂）**: Guestの役割バッジ（Guestである表示）
    付与。`badgeGrants`へ永続化しない仮想バッジとして実装
- バッジマスタは、Phase13時点では団体IDを持たないシンプルな1マスタ構成と
  する。**（2026-07-26 十九訂で訂正）** 従来「Phase11で導入する組織階層の
  うち最上位の団体単位で保持する」としていたが、(1)団体単位でマスタを
  出し分けるには「ユーザー×団体の所属関係」が前提として必要だが、これは
  Phase11(十三訂)で明示的に着手しないことが確定していること、(2)マスタ
  管理は「業種プロファイル（テンプレート）→団体（個別上書き）」の
  二階層構造であり、団体単位の上書きは業種プロファイル単位の基盤
  （Phase15）があって初めて成立することの2点から、Phase13単体では
  団体単位保持は成立しないと判断した。団体・業種プロファイル単位への
  拡張はPhase15でまとめて行う（下記参照）。
  ✅ **実装完了（2026-07-26、二十訂）**: `token-server/lib/badges.js`の
  `badges`コレクションとして、団体IDを持たない構成で実装済み
- 自動付与条件（技能章・部隊章・階級章等）のうち、業種に依存しない
  最小限の条件だけをバッチ処理で先行実装し、業種プロファイル単位の
  条件出し分けはPhase15に持ち越す。**未着手（Phase13のスコープ外として
  次アクションへは残さず、Phase15検討時に合わせて着手する）**
- バッジ管理画面のPoCをここで実施する →
  ✅ **完了（2026-07-26、二十訂）**: `admin-dashboard/src/views/
  BadgesView.vue`として実装

**残作業（次アクションitem3参照）**: 3クライアント共通のRoom内owner向け
付与/剥奪UI(token-server側API自体は実装済み)。iOS/Androidのバッジ表示UIは
二十一訂で完了したため、次アクションからは除外した。

### Phase 14: Phase2(ビジネスチーム)展開に向けた仕上げ → **旧Phase13を繰り下げ**
- Firebase App Check導入
- プッシュ通知
- 自動テスト・E2Eテストの拡充（現状はCIでの構文/Lintチェックが中心）

### Phase 15: 業界ラベリング層の設計・導入 → **旧Phase11前半、着手条件待ち（2026-07-26）**
**着手条件: Phase2（イベント運営・展示会・自治体等）の具体的な案件・
要件が確定してから。** README.mdが定義する原則としては正しいが、
2つ目の業種の実要件が無いまま抽象化の軸を設計すると、後で作り直す
リスクの方が高いと判断し、Phase9〜Phase1の実ユーザーに直接効く土台整備
（組織階層・権限整理・バッジ基本機能）を先に優先する方針とした
（ユーザー確認済み、2026-07-26）。

- i18nのキー構造を「言語 × 業種プロファイル」で文言を出し分けられる形へ拡張
- 警備業プロファイルを第一弾として整備し、Phase2向けの第二プロファイルを
  追加できることを検証する
- バッジシステムを業種プロファイル単位・団体単位で複数マスタ切り替え
  可能な形に拡張する（Phase13で実装した基本機能の上に積み増す）
- 自動付与判定の業種プロファイル単位での条件出し分けを実装する

---

## 5. Guestロール・バッジシステム 詳細仕様（2026-07-25 検討分）

Phase10（Guestロール）・Phase11（業界ラベリング層／バッジ）の着手前に、
仕様レベルでの合意形成を行った。実装時はこの内容を出発点とする。

### 5.1 Guestロール

| 項目 | 仕様 |
|---|---|
| 認証方式 | Firebase匿名認証 |
| 送話権限 | 可能（閲覧専用ではない） |
| 権限系メニュー | BAN・moderator任命・録音操作等は非表示 |
| 参加範囲 | 1招待コード＝1Room限定 |
| セッション同一性 | 招待コード（チャネル）が生存中の再入室は同一ID扱い。チャネル終了後は無効 |
| Room解散後のデータ | 参加記録・ID情報は削除しない |
| ニックネーム | 変更可能・リアルタイム反映。監査ログ・録音の話者記録はニックネームでなく内部IDに追従（変更履歴自体は追わなくてよい） |
| 表示名ルール | ニックネームがあればニックネーム、なければID表示 |
| 業種プロファイルとの関係 | 警備業では通常発生せず、デモ・特定用途向け。Phase2(イベント運営等)での利用頻度がより高い想定 |
| Member昇格 | **対象外（2026-07-25 確定）**。昇格導線・APIは実装しない。GuestとMemberは常に別IDの別人物として扱う |

### 5.2 Memberの永続性・個人情報

| 項目 | 仕様 |
|---|---|
| 認証要件 | メールアドレス必須（本人確認・認証用途のみ、以降はIDで管理） |
| 永続性 | 削除しない限り永続的に利用可能 |
| 削除の実体 | ユーザー無効化（ID自体は存続）。個人情報保護の観点でメールアドレスのみ削除も可能 |
| 削除の主体 | 本人の退会申請、または管理者による削除 |

### 5.3 バッジシステム

| 項目 | 仕様 |
|---|---|
| 表現形式 | アイコン（絵文字的なもの） |
| 表示先 | プロフィール画面（未設計、複数表示） |
| 個人による選択 | 不可（付与されるもののみ） |
| 付与経路 | Owner手動、またはSystem自動（業種プロファイル単位の条件） |
| 自動付与条件のイメージ | 技能章（資格・特技）、部隊章（所属）、階級章 |
| 自動付与のトリガー | バッチ処理（例：条件達成後1日以内に付与）。リアルタイム評価はしない |
| 失効・剥奪 | 仕組みとして持つ。Owner手動・System自動どちらの経路からも取消・上書き可能 |
| 表示優先順位 | バッジごとに個別の優先度値を保持し、それに基づき上位を表示 |
| 最大表示数 | 業種プロファイル単位で設定（n件） |
| Room内・参加者一覧での表示 | 最優先バッジ1個のみ表示（例：階級のみ） |
| マスタの保存場所 | 団体（Company/Branch等）ごとに書き換え可能なデータベース。業種プロファイルの初期値はシステム管理者が登録・変更 |
| 管理画面 | Phase13でPoCを実施(`BadgesView.vue`、マスタCRUDのみ)。「ユーザ管理画面への統合」は2026-07-27に実施し、個々のユーザーへの付与/剥奪はマスタ画面ではなく新設の「ユーザー管理」画面(`UsersView.vue`/`UserDetailView.vue`)で行う形に確定した(詳細は改定履歴・5.4参照) |
| Guestの対象範囲 | 役割バッジ（Guestである表示）のみ付与対象。資格・勤続バッジは対象外 |

### 5.4 洗い出された矛盾点・懸念点（要フォロー）

- **バッジマスタの団体単位管理とPhase12の順序**：バッジマスタは団体単位で
  管理する想定だが、組織階層（Company/Branch/Site）自体はPhase12で
  未実装のため、Phase11時点では「団体ID」相当の仮キーで代替し、Phase12で
  正式接続する段階的設計が必要
- **バッジ付与・失効の履歴管理**：自動付与（バッチ）と手動付与（即時）が
  混在するため、「いつ・誰が（またはどの自動条件が）付与/剥奪したか」を
  Phase8の監査ログ基盤の対象に含める前提を明記する必要がある
- **GuestIDとMember昇格の整合性 → 確定済み（2026-07-25）**：Member昇格の
  導線自体を実装しない（対象外）。GuestとMemberは常に別ID・別記録として
  扱い、`promotedFrom`等の紐付けフィールドも持たせない。監査ログ上、
  同一人物であっても「継続」としては扱わない前提で設計する
- **自動付与の遅延と手動付与の即時性のギャップ**：同一バッジ体系内で
  手動付与（即時）と自動付与（最大1日遅延）の体験差が生じるため、
  UI上で遅延の可能性をユーザーに明示する文言が必要
- **Guest認証自体の招待制化（2026-07-25 課題化、未着手）**：現行実装は
  「ルームへの参加」は既存の招待コード必須ロジックを素通りするため
  引き続き招待制だが、「匿名認証でサインインするボタン」自体には制限が
  なく、招待コードを持たない相手でも押せてしまう。将来のQR/招待リンク
  からの直接参加（README.mdのFuture Features）を見据えるなら、
  「招待コードを先に入力させてから匿名認証させる」順序への変更を
  検討する余地がある。優先度は低いが、匿名アカウントの量産余地を
  塞ぎたい場合は着手を検討する
- **他参加者のGuest判定手段の欠如（2026-07-25 課題化 → Webのみ副次的に
  解消、2026-07-26 二十訂 → 3クライアントで解消、2026-07-27 二十一訂）**：
  現行の`firestore.rules`はクライアントが自分自身の`members/{uid}`
  ドキュメントしか読めない設計であり、かつroomメンバー向けに他メンバーの
  role等を返すAPIも存在しない（`admin-dashboard`が使う`GET /admin/rooms/:id`
  はサイト管理者専用APIで別軸の権限のため転用不可）。そのため3クライアント
  とも「自分自身がGuestであること」の表示のみに留め、参加者一覧上での
  他人のGuestバッジ表示はPhase10のスコープ外とした。着手する場合、
  「Guestか否かだけを返す」のではなく、他のユーザー情報（表示名以外に
  何を一般メンバーへ公開してよいか）を含めて要件から検討する方針
  （ユーザー確認済み、2026-07-25）としていた。
  **（2026-07-26 二十訂）** Phase13でRoom参加者向けバッジ閲覧API
  (`GET /rooms/:roomId/badges`、role不問で誰でも呼べる)を実装した際、
  Guestの役割バッジも他参加者から見える形で返す設計にしたため、Web版に
  限り本課題が副次的に解消された。公開される情報はバッジ(役割表示のみ)に
  限定され、displayName以外の追加情報漏洩は無いため、「他のユーザー情報を
  含めて要件から検討する」という当初の懸念には抵触しない。iOS/Androidは
  バッジ表示UI自体が未実装のため、両OSでは引き続き本課題が残っていた。
  **（2026-07-27 二十一訂）** iOS(`PTTBadgeStore.swift`)・
  Android(`PTTBadgesStore.kt`)双方に同APIを使ったバッジ表示UIが実装された
  ことで、3クライアントすべてで本課題が解消された。iOS側はコード変更を
  本ドキュメント側で直接把握しているが、Android側はユーザー報告に基づく
  実装であり、コード自体の直接確認は行っていない（確度の区別は改定履歴・
  「6.1」item16参照）
- **Room作成と組織階層への紐付けの分離（2026-07-26、確定）**：Phase11
  実装時の検討により、Room作成時に組織階層(orgId/nodeId)へ自動で紐付ける
  機能は実装しないことを確定した。Room作成は従来通りPTTクライアントから
  行い、紐付けが必要なRoomのみadmin-dashboardのRoom詳細画面
  (`PATCH /admin/rooms/:roomId/org-assignment`)から管理者が事後に手動で
  行う運用とする。入室方法(招待コード検証)も組織階層とは無関係のまま
  変更しない。これに伴い、「ユーザーがどの団体に属するか」という
  ユーザー×団体の所属関係の設計・実装は当面行わない（自動紐付けや
  招待不要参加が必要になった時点で、改めて別Phaseとして検討する）
- **招待コードの可視範囲（2026-07-26 課題化、未着手）**：Phase11の
  動作確認中、admin-dashboardのRoom詳細画面から招待コードを確認できない
  ことが判明した。`token-server/routes/admin.js`の`GET /admin/rooms`・
  `GET /admin/rooms/:roomId`はいずれも`inviteCode`を返しておらず、これは
  Phase11の実装漏れではなく、招待コードが`POST /rooms`(Room作成)の
  レスポンスとしてのみ返却され、以降どのAPIからも再取得できないという
  既存の仕様によるもの。「Room作成後、必要に応じて招待コードを手動共有する」
  という2026-07-26確定の運用（上記）を実際に回すには、admin-dashboardから
  招待コードを確認できる手段が必要になる可能性が高いが、これを追加すると
  `rooms:monitor`権限保有者に実質的な「Roomへの参加権配布」権限まで
  広がってしまう。Phase12（role×操作の対応表整理）で、対象権限の絞り込み・
  監査ログ記録の要否と合わせて検討する
- **業界ラベリング層をロードマップ後方へ移動（2026-07-26）**：
  Phase2の具体的な案件・要件が無いまま「言語×業種プロファイル」の
  抽象化軸を設計すると、後で作り直すリスクの方が高いと判断。Phase1の
  実ユーザーに直接効く土台整備（組織階層・権限整理・バッジ基本機能）を
  Phase11〜13として先に優先し、業界ラベリング層自体はPhase15へ移動して
  「Phase2の要件確定」を着手条件とした。ロードマップからは外していない
  （優先順位と着手条件を変更しただけ）
- **バッジマスタの団体単位保持は成立しない → 解決済み（2026-07-26、十九訂）**：
  Phase13ロードマップ本文に残っていた「バッジマスタは団体単位で保持する」
  という記述は、(1)団体単位でマスタを出し分けるために必要な「ユーザー×
  団体の所属関係」がPhase11で明示的に着手対象外とされていること、
  (2)マスタ管理が「業種プロファイル（テンプレート）→団体（個別上書き）」
  の二階層構造であり、団体単位の上書きは業種プロファイル単位の基盤
  （Phase15）が先に必要なこと、の2点によりPhase13単体では成立しないと
  判断した。Phase13は団体IDを持たないシンプルな1マスタ構成に統一し、
  団体・業種プロファイル単位への拡張はPhase15でまとめて行う方針を確定した
  （詳細はPhase13欄参照）

---

## 6. 次アクションの提案（2026-07-26 二十訂で更新）

旧版の提案（項目1〜9）は全て完了済みのため「6.1 完了済みアクション
（アーカイブ）」へ集約した。現行ロードマップ（Phase11〜13の土台整備を
優先する再編後の順序）に即して、次アクションを以下の通り刷新する。
なお、Phase12の旧item1（role×操作の対応表の洗い出し・一元化）は
本改定(十四訂)時点でサーバー側の一元化まで完了しており、
「6.1 完了済みアクション（アーカイブ）」item 10へ移動した。
また、旧item1として残っていた「3クライアント側のrole判定の統一方針」は
十五訂で方針を確定し、十六訂で実装、十七訂でGitHub Actions実行画面による
反映確認まで完了したため、「6.1」item 12へ移動した。「Phase13 バッジ基本
機能のデータモデル設計」は十八訂でFirestoreスキーマ案(`phase13-badge-
schema.md`)を作成し完了したため「6.1」item 13へ移動した。十八訂で発見した
「バッジマスタの団体スコープに関するドキュメント内矛盾」は十九訂で解消
（団体IDなしのシンプルな1マスタ構成に統一）したため「6.1」item 14へ移動した。
「Phase13 バッジ基本機能のFirestoreスキーマの実装着手」は二十訂で
token-server・admin-dashboard・ptt-client(Web)へ実装したため「6.1」
item 15へ移動した。実装過程で判明した2つの未実装部分(iOS/Androidのバッジ
表示、3クライアント共通のRoom内owner向け付与/剥奪UI)は当時新たな次
アクションとして追加していたが、このうち「iOS/Androidのバッジ表示」は
二十一訂でiOS・Android双方に実装完了(Android実装はユーザー報告に基づく、
iOS実装は本ドキュメント側で直接実施)したため「6.1」item 16へ移動した。
残る次アクションは以下の2件のみとなる。

1. **（低優先度・継続）** `UI_UX.md`・`SECURITY.md`・`AI.md`の空テンプレート
   整備：旧6.項目3で洗い出したまま未着手。転記元となる詳細記述が
   `token-server/README.md`側に存在しないため、内容そのものをこのタイミングで
   新規に書き起こす必要がある。優先度は引き続き低いが、Phase11〜13で
   ドキュメント化すべき内容（組織階層のスキーマ・role対応表・バッジ
   スキーマ）が増える見込みのため、それらと合わせて着手すると効率的
2. **admin-dashboardの事前権限チェックの要否を検討する**：Phase12棚卸しで
   判明した論点。現状、`admin-dashboard`には「自分の権限を見てメニューを
   隠す」事前チェックが無く、各画面はAPIを呼んで403が返ってから
   エラー表示する作りになっている。Room内roleの3クライアントとは
   設計思想が異なるため、揃えるかどうかを検討する（優先度は低い）
3. **3クライアントにRoom内owner向けバッジ付与/剥奪UIを実装する**：
   token-server側のRoom内owner専用API(`POST/DELETE /rooms/:roomId/
   members/:targetUid/badges*`)は実装済みで未使用のまま残っている。
   現状Room内ownerがバッジを付与/剥奪する手段はadmin-dashboard経由
   (サイト管理者権限`badges:manage`が必要)のみであり、「5.3: 付与経路
   Owner手動」が本来意図するRoom内完結の体験になっていない。moderator
   任命API(Room内owner専用パスが実装済みだがどのクライアントからも
   呼ばれていない、とPhase12棚卸しで判明した前例)と同様の状態にある

### 6.1 完了済みアクション（アーカイブ）

<details>
<summary>2026-07-25〜2026-07-27に完了した旧提案1〜17（クリックで展開）</summary>

1. ✅ **完了（2026-07-25、十訂）**: iOS/Androidへの通報UI・録音開始/停止UIを
   実装した。Web版(`ptt-client`)の設計(`recording.ts`・`reportParticipant`)
   を移植する形で、`PTTRecordingStore`/`PTTReportStore`相当の薄いストアを
   両OSに新設し、Room Metadata経由の録音状態購読を`PTTConnectionManager`
   に追加した。Web版のみが持つ「自動録音: ON」トグルはユーザーへ確認の上
   スコープ外とすることで合意済み(対応不要)。詳細は「2-E」参照
2. ✅ **完了（2026-07-25、コミット`e85dc28`でリポジトリ反映済みを確認）**:
   `ptt-ios/ptt-ios/README.md`をLiveKit移行後の実装に合わせて書き直した
   （旧AVAudioEngine実装時代の記述が残っており、ジッターバッファ誤判断の
   直接原因になった）。**（2026-07-25 八訂）** 前版では成果物
   `ptt-ios-README.md`のリポジトリへの反映が未実施としていたが、
   アップロードされたリポジトリ一式（HEAD=`e85dc28`）を`git show`で
   確認したところ、`ptt-ios/ptt-ios/README.md`本体が既に新記述へ
   置き換わっていた。反映済み・完了項目として扱う
3. ✅ **完了（2026-07-25）**: 他ドキュメントの棚卸しを実施。結果は以下の通り。
   - `admin-dashboard/README.md`: 記載ファイル構成・CI設定・`firebase.json`
     の内容は実コードと一致。当時「〜してください」という指示口調のまま
     残っていた1箇所も、**（2026-07-25 八訂）同一コミットで「〜済み」という
     完了形の表現に修正済み**であることを確認した
   - `token-server/README.md`: ほぼ最新（テキストチャットAPI
     `POST /rooms/:roomId/messages`も既に記載済み）。当時「録音の開始/停止
     ボタンはWeb/iOSともに別途実装が必要」という2026-07-24の`rec feature`
     コミット以前の記述が残っていた点も、**（2026-07-25 八訂）同一コミット
     で「Web版は実装済み。iOS/Androidは録音中フラグの受信のみで、開始/
     停止ボタン自体は別途実装が必要」へ修正済み**であることを確認した
   - `API.md` / `DATA_MODEL.md` / `UI_UX.md` / `SECURITY.md` / `AI.md`:
     見出しのみの未記入テンプレート（2026-07-17作成のまま空、八訂時点でも
     未変更）。誤った内容が書かれているわけではなく「書かれていない」状態の
     ため、iOS READMEのような誤判断を誘発するリスクは低い。ただし実装が
     ここまで進んだ今、特に`API.md`・`DATA_MODEL.md`は`token-server/README.md`
     の内容を転記するだけでも価値がある（優先度は低・引き続き未着手）
4. ✅ **完了（2026-07-25、項目3で判明した内容の修正自体も同一コミットで
   完了済みを確認）**: `token-server/README.md`の録音UI記述修正
   ・`admin-dashboard/README.md`の表現ズレ修正は、いずれも追加作業不要
5. ✅ **完了（2026-07-25）**: Guestロールの実装。
   「5. Guestロール・バッジシステム 詳細仕様」で要件確定後、5.4で保留
   していたGuestIDとMember昇格時のID整合性も**Member昇格は対象外
   （実装しない）、GuestIDは生成されたIDのまま保持し他ID体系との紐付けも
   行わない**ことで確定。同日中に`token-server`（role自動判定・
   ニックネームAPI）、`admin-dashboard`（型定義）、Web/iOS/Androidの
   3クライアントすべてに実装完了。詳細はPhase10・5節を参照
6. ✅ **完了（2026-07-25）**: 残る空テンプレート文書の整備を実施。
   `API.md`・`DATA_MODEL.md`へ`token-server/README.md`の該当内容
   （API一覧テーブル・Firestoreデータモデル）を転記し、
   `token-server/README.md`側は該当箇所を「転記済み・詳細は`API.md`/
   `DATA_MODEL.md`を参照」という参照文へ置き換えて重複を解消した。
   `UI_UX.md`・`SECURITY.md`・`AI.md`は転記元となる詳細記述が
   `token-server/README.md`側に存在しないため、依然として未着手のまま
   残っている（→ 上記「次アクション4」として継続）
7. ✅ **完了（2026-07-25、十一訂）**: iOS/Android通報UI・録音開始/停止UI
   実装のリポジトリ反映確認。ユーザーから「リポジトリへ反映して動作確認は
   済んでいます」との報告を受けた。**（留保）** 六訂・八訂で
   `ptt-ios/ptt-ios/README.md`について踏んだような、リポジトリ本体を
   再取得し`git show`等でコミット内容を直接検証するプロセスは今回実施して
   いない。ユーザー申告に基づく完了として扱う
8. ✅ **完了（2026-07-25）**: Guestロール Android版の実装完了。ユーザーから
   「Androidは終わりました」との報告を受けた。**（留保）** 項目7と同様、
   Android側のリポジトリ本体を取得してのコード検証は行っておらず、
   ユーザー申告に基づく完了として扱う。これでGuestロールはサーバー・
   Web/iOS/Androidの3クライアントすべてで実装完了
9. ✅ **完了（2026-07-26、十三訂）**: Phase11 組織階層のデータモデル設計・
   実装。`Company → Branch → Site`（警備業）・`Community → Group`（一般）
   の両方を任意の深さの再帰ツリー(`organizations`/`organizations/{orgId}/
   nodes`)として表現する設計をまず合意し、その後実装まで完了した。
   - `firestore.rules`: `organizations`/`nodes`へのクライアント直接
     読み書きを全面拒否(rooms本体と同じ理由)
   - `token-server`: `routes/organizations.js`新設
     （団体・node一覧/作成、`PATCH /admin/rooms/:roomId/org-assignment`
     によるRoomの割り当て/解除）、`lib/orgContext.js`新設（パンくず解決
     ロジックを`routes/rooms.js`の`GET /:roomId/org-context`と
     `routes/admin.js`のルーム詳細で共有）
   - `admin-dashboard`: `OrganizationsView.vue`（団体・nodeツリー管理画面）・
     `stores/adminOrganizations.ts`新設。`RoomsListView.vue`に階層ナビゲーション
     （既知の制約: サーバー側フィルタ未実装のため読み込み済みページ内のみ）、
     `RoomDetailView.vue`に組織階層の表示・割り当て変更UIを追加
   - 既存Roomの移行：強制バックフィルは行わず、無所属Roomを正式な状態として
     許容。団体を持つ運用者が任意のタイミングでadmin-dashboardから手動割り当て
   - 動作確認を経て、Room作成と組織階層への紐付けを分離する運用方針、
     および招待コードの可視範囲という新たな課題を確定・記録した
     （詳細は5.4参照）
10. ✅ **完了（2026-07-26、十四訂）**: 「6. 次アクションの提案」item 1
    （Phase12 role×操作の対応表の洗い出し）を実施し、判明した論点のうち
    挙動を変える3点についてユーザーの意思決定を得た上で実装まで行った。
    - `POST /reports`（通報API）: **現状維持**（`requireRoomMembership`を
      追加しない）。通報を行う側にはmember以上の権限が想定されるという
      判断のため、対象roomのメンバーシップを要求する制約は付けない
      （ユーザー確認済み、2026-07-26）
    - `POST /rooms`（Room作成）: **サーバー側でもGuest拒否を追加**。
      `firebase.sign_in_provider === 'anonymous'`なら403を返すガードを
      `routes/rooms.js`に実装した。従来はクライアント側のUI非表示のみで、
      API直叩きからは素通りしていた抜け穴を塞いだ
    - moderator任命API: **admin-dashboardから任命できるようにする**方針
      のため、`routes/admin.js`に`PATCH /admin/rooms/:roomId/members/
      :targetUid/role`（`rooms:manage`権限）を新設し、`admin-dashboard`の
      `RoomDetailView.vue`（メンバー台帳テーブル）・`stores/adminRooms.ts`
      に任命/降格UIを追加した。Room内owner専用の既存API
      （`routes/rooms.js`側）はそのまま残し、admin側は別経路として並存
      させている
    - あわせて、対応表の一元化そのものとして`token-server/lib/
      permissions.js`を新設した。Room内role(owner/moderator/member/guest)
      ×操作のホワイトリストをこのモジュールに集約し、`routes/rooms.js`
      （BAN・moderator任命・自動録音設定）・`routes/recording.js`
      （録音開始/停止・ダウンロードURL発行・削除）はいずれもここから
      参照する形に置き換えた（`['owner','moderator'].includes(role)`の
      重複ハードコードを解消）。**サイト管理者権限
      （`adminUsers/{uid}.permissions`、`rooms:monitor`等）はRoom内role
      とは別軸のため対象外**とし、`middleware/requireAdmin.js`側の管理を
      変更していない
    - **未着手として残した項目**: 3クライアント(Web/iOS/Android)側の
      role分岐（`ban.myRole==='owner'||'moderator'`等）は、`lib/
      permissions.js`のようなサーバー側の一元化とは違い、各クライアントの
      実装言語が異なる(TypeScript/Swift/Kotlin)ため、同じ意味での「一元化」
      は単純なモジュール共有では実現できない。クライアント側をどう揃えるか
      （例: サーバーから対応表そのものを配信する、各言語で同型の定数を
      手動同期する等）は本改定のスコープ外とし、次アクションとして残す
11. ✅ **完了（2026-07-26、十五訂）**: 「6. 次アクションの提案」item 1
    （3クライアント側のrole判定の統一方針の検討）について方針を確定した。
    - **同期方式**: サーバーの対応表(`lib/permissions.js`)を実行時にAPI
      配信する方式は見送り、同モジュールをSSOTとしつつ値の一致を
      ビルド時/CIの機械的チェックで保証する方式を採用する。判断根拠として、
      3クライアントで実際にrole分岐している箇所を確認したところ
      「owner||moderator」「role==='guest'」の2値のみで、owner単独・
      moderator単独を区別する分岐は存在しなかった（grep確認済み）。
      この規模であれば手動同期＋CI差分チェックで十分であり、警備現場での
      利用を前提とするPTTアプリの性質上、権限判定に起動時ネットワーク
      依存を新たに持ち込むことのリスク（通信不良時のフェイルオープン/
      フェイルクローズ問題）の方が大きいと判断した。将来role構成が
      本格的に複雑化した場合はAPI配信方式への昇格を再検討する
    - **`isAnonymous` vs `role`の統一について**: Web(`RoomSelectView.vue`)・
      iOS(`ContentView.swift`)・Android(`PTTApp.kt`)いずれも、
      `isAnonymous`は**未入室**の「Room作成」ボタン非表示にのみ使われ、
      `role`は**入室後**のバッジ表示・BAN/録音操作可否にのみ使われている
      ことをコードで確認した。これは表記の揺れではなく、`role`が
      `rooms/{roomId}/members/{uid}`ドキュメントの値である以上、
      どのRoomにも入っていない画面ではそもそも判定不能という構造的な
      理由によるもの。したがって「統一」ではなく「使い分けの明文化」を
      対応方針として確定した（次アクション2参照）
12. ✅ **完了（2026-07-26、十六訂）**: 十五訂で確定した方針を実装した。
    - `token-server/lib/permissions.js`をSSOTとし、3クライアントの
      管理者ロール定数を新設: `ptt-client/src/lib/roomPermissions.ts`
      (`ROOM_MANAGE_ROLES`/`canManageRoom()`)・`ptt-ios/ptt-ios/
      PTTRoomPermissions.swift`(`manageRoles`/`canManageRoom(role:)`)・
      `ptt-android/.../ban/PTTRoomPermissions.kt`(`MANAGE_ROLES`/
      `canManageRoom()`)。`RoomView.vue`の`canBan`/`canControlRecording`、
      `ContentView.swift`の同名computed property、`PTTApp.kt`の
      `canControl`/`canBan`引数を、いずれもこの共有定数経由の呼び出しに
      置き換えた
    - `scripts/check-role-sync.js`を新設。`token-server/lib/permissions.js`
      の`members:ban`/`recording:start`/`recording:stop`の許可role集合を
      正とし、上記3クライアントの定数ファイルを正規表現でパースして
      一致を検証する。値を意図的に崩す→検知される(exit 1)→戻す→成功する
      (exit 0)ことを実際に動作確認済み。`.github/workflows/
      role-sync-check.yml`でCIにも組み込んだ(関連4ファイルのいずれかが
      変更された場合のみ動作)
    - `isAnonymous`/`role`の使い分けを、`RoomSelectView.vue`・
      `ContentView.swift`(Room作成ボタン非表示箇所)・`PTTApp.kt`
      (`RoomSelectionSection`呼び出し箇所)のコメントとして明文化した
    - **副次的に発見・訂正した項目**: `ContentView.swift`のRoom作成ボタン
      非表示箇所にあった「token-server側(POST /rooms)はrole判定をしない
      ため」というコメントが、十四訂でのサーバー側Guest拒否実装
      （`routes/rooms.js`への403ガード追加）後に更新されていなかった
      陳腐化コメントだったため、あわせて訂正した（六訂で発見した
      iOS READMEの陳腐化と同種の、実コード追随漏れの再発）
    - **リポジトリ反映・CI合格の確認について（2026-07-26、十七訂）**:
      ユーザーからGitHub Actionsの実行画面スクリーンショットの提示を
      受けた。コミット`263b855`("change role check")に対し、新設した
      `Role Sync Check`ワークフローが green(✓, 10s)で完走していることを
      確認した。同一コミットで`Android CI`・`iOS CI`・`Web (ptt-client)
      Deploy`も揃って green になっており、3クライアントとも今回の
      コード変更が各言語のビルド・Lintを通過していることも確認できた。
      これは十一訂の「ユーザー申告のみ」の確認より確度は高い
      （GitHub Actions実行画面という第三者記録で、特定のコミットハッシュに
      紐づいている）が、六訂・八訂で行った`git show`によるコミット内容
      そのものの直接検証（diffの中身の確認）とは異なる、中間の確度の
      確認として記録する
13. ✅ **完了（2026-07-26、十八訂）**: 「6. 次アクションの提案」item 1
    （Phase13 バッジ基本機能のデータモデル設計）を実施し、別ドキュメント
    `phase13-badge-schema.md`としてFirestoreスキーマ案を作成した。
    - コレクション構成: `badges`（マスタ）・`badgeGrants`（付与/剥奪の
      履歴を保持する追記型レコード）・`config/badgeDisplay`（表示設定）
      の3本構成とした
    - Guestの役割バッジ（Guestである表示）は`badgeGrants`へ永続化せず、
      `role === 'guest'`から都度算出する「仮想バッジ」として扱う設計とした
      （入退室のたびに書き込みが発生するのを避けるため）
    - 付与・剥奪は既存レコードの上書きではなく新規ドキュメント追加で
      履歴を残す方式とし、Phase8監査ログ基盤（`badge.grant`/`badge.revoke`
      アクション種別）との連携を前提に含めた
    - Phase15での団体・業種プロファイル単位への拡張を見据え、`badges`へ
      `orgId`を後付けしやすいフィールド設計にとどめた
    - **（重要な留保 → 解決済み、2026-07-26 十九訂）** 本スキーマ案は次
      アクション記載の「Phase13時点では団体IDを持たないシンプルな1マスタ
      構成でよい」を前提に設計したが、「3. 優先順位付きロードマップ案」
      Phase13本文には「バッジマスタは、Phase11で導入する組織階層のうち
      最上位の団体単位で保持する」という**逆の前提**が残っており、本
      ドキュメント内で矛盾していることに気づいた。十九訂で検討の結果、
      団体IDなしの前提（本スキーマ案の設計）が正しいと確定し、Phase13
      ロードマップ本文側を訂正した（詳細はitem 14参照）
    - その他の未確定事項（Phase10実装済みGuestバッジ表示との統合要否、
      `badgeGrants`の他参加者への公開範囲）はスキーマ案側に明記し、
      Phase12のrole×操作整理待ちとして次アクションに残した
14. ✅ **完了（2026-07-26、十九訂）**: item 13で発見した「バッジマスタの
    団体スコープに関するドキュメント内矛盾」を解消した。「団体単位で
    バッジマスタを保持する」を検討した結果、Phase13単体では成立しないと
    判断した。
    - **論拠(1)**: 団体単位でマスタを出し分けるには「どのユーザーがどの
      団体に属するか」の判定が前提として必要だが、「ユーザー×団体の
      所属関係」はPhase11(十三訂)で明示的に着手しないことが既に確定して
      いる（Room作成と組織階層の紐付けを分離し、ユーザー個人が団体に
      属するという概念自体を実装していないため）
    - **論拠(2)**: 「5.3 バッジシステム」の「業種プロファイルの初期値は
      システム管理者が登録・変更」、およびPhase15の「バッジシステムを
      業種プロファイル単位・団体単位で複数マスタ切り替え可能な形に拡張
      する」という既存の記述から、マスタ管理は「業種プロファイル
      （テンプレート）→団体（個別上書き）」の二階層構造であり、団体単位
      の上書きは業種プロファイル単位の基盤（Phase15）があって初めて
      成立する
    - Phase13本文の当該記述は、Phase13が「旧Phase11から分離」される前
      （バッジと組織階層が一体だった頃）の記述が更新されずに残っていた
      ものと判断し、Phase13ロードマップ本文を「団体IDを持たないシンプルな
      1マスタ構成」に訂正した。あわせて「5.4」に解決済み事項として記録した
15. ✅ **完了（2026-07-26、二十訂）**: Phase13バッジ基本機能を実装した。
    `phase13-badge-schema.md`のスキーマ案を土台に、`token-server`
    (`lib/badges.js`新設・`lib/permissions.js`変更・`routes/badges.js`
    新設・`routes/roomBadges.js`新設・`server.js`変更・`firestore.rules`
    変更)、`admin-dashboard`(`BadgesView.vue`新設・`stores/adminBadges.ts`
    新設・`RoomDetailView.vue`変更・router/NavTabs変更・`types/admin.ts`
    変更)、`ptt-client`(`stores/badges.ts`新設・`ParticipantList.vue`変更・
    `RoomView.vue`変更・`types/api.ts`変更)に反映した。
    - Guestの役割バッジは設計通り`badgeGrants`へ永続化しない仮想バッジと
      して実装した
    - `phase13-badge-schema.md`「8.」からの変更点として、badges/
      badgeGrants/configをクライアントへ直接公開せず、判定済みの結果
      (topBadge等)を返すAPIに一本化する方針へ変更した(3クライアントでの
      ロジック分散実装を避けるため)
    - Room内でのgrant/revokeは、Room内owner専用API(`routes/roomBadges.js`)
      とadmin-dashboard経由(`badges:manage`)の2経路を用意し、十四訂の
      moderator任命APIと同じ構成を踏襲した
    - 副次的な成果として、Web版に限り5.4「他参加者のGuest判定手段の欠如」
      が解消された(`GET /rooms/:roomId/badges`がrole不問で閲覧可能なため)
    - **未実装のまま次アクションへ**: iOS/Androidのバッジ表示UI(次アクション
      item3)、3クライアント共通のRoom内owner向け付与/剥奪UI(次アクション
      item4。token-server側のAPI自体は実装済みで未使用)。自動付与バッチ
      処理はPhase13のスコープ外のため対象外
16. ✅ **完了（2026-07-27、二十一訂）**: 旧次アクションitem3「iOS/Androidに
    バッジ表示UIを実装する」を完了した。実施主体・確認方法がiOSとAndroidで
    異なるため、以下の通り区別して記録する。
    - **Android（ユーザー報告に基づく）**: `model/PTTModels.kt`に
      `AssignedBadge`・`RoomMemberBadges`を追加、`badges/PTTBadgesStore.kt`
      (新設)で`GET /rooms/:roomId/badges`を20秒間隔でポーリング(Web版
      `stores/badges.ts`と同じ設計方針。既存のポーリングパターンが
      Androidになかったため、`PTTConnectionManager.connect()`の
      `idTokenProvider`パターンを踏襲した独自coroutineループとして実装)、
      `MainActivity.kt`・`ui/PTTApp.kt`で配線(ストア生成・`enterRoom`/
      `leaveRoom`でのstart/stop・`ParticipantsSection`への`topBadges`
      受け渡しとアイコン表示、`contentDescription`によるツールチップ相当
      表示)したとの報告を受けた。実装過程で発生した「iOS版の移植」という
      誤記(その時点でiOS側は未実装)は訂正済みとのこと。本ドキュメント側
      では`git show`等によるコード自体の直接確認は行っていない
    - **iOS（本ドキュメント側で直接実装）**: `PTTBadgeStore.swift`(新設)
      で同APIを20秒間隔でポーリングし、`ContentView.swift`の`enterRoom`/
      `leaveRoom`でstart/stop、参加者一覧の各行にバッジアイコンを表示する
      形で配線した。`README.md`も合わせて更新した。こちらはコード変更を
      本ドキュメント側で直接把握している
    - **動作確認**: ユーザーから「iOS・Android双方で実機/エミュレータでの
      動作確認済み」との報告を受けた。**（留保）** 十一訂・八訂item8と
      同水準のユーザー申告のみに基づく確認であり、`git show`によるコミット
      内容の直接検証や、十七訂のGitHub Actions実行画面による確認とは異なる
      （特にAndroidはコード自体を未確認のため、確度としては相対的に低い）
    - これにより、5.4「他参加者のGuest判定手段の欠如」が3クライアント
      すべてで解消された
17. ✅ **完了（2026-07-27、二十二訂）**: バッジの付与/剥奪の実行場所を、
    RoomDetailView.vueのメンバー台帳から新設の「ユーザー管理」画面
    (`UsersView.vue`/`UserDetailView.vue`)へ移設した。`badgeGrants`が
    そもそもroomIdを持たないユーザー単位のレコードであるため、Room詳細
    画面から付与するのは不自然というユーザー指摘を受けての変更。
    - **背景**: 全ユーザー一覧APIも「ユーザー×団体の所属関係」(Phase11で
      非実装)も存在しなかったため、Room文脈なしに対象ユーザーを見つける
      手段が無かった。これがRoom詳細画面に間借りしていた実質的な理由
      だった。解決策として、Firebase Authを唯一のグローバルなユーザー
      台帳とみなし`auth.listUsers`を新規利用。Memberはメール認証必須
      (5.2)・Guestはメールを持たないため、検索一覧から自然にGuestを
      除外できることを確認した
    - **サーバー側**: `routes/users.js`新設(`GET /admin/users`検索・
      `GET /admin/users/:uid`プロフィール・`POST/DELETE /admin/users/:uid/
      badges*`付与剥奪。権限は新設の`users:monitor`+既存の`badges:manage`
      を踏襲)。`routes/badges.js`からRoom内メンバー向け旧付与/剥奪
      エンドポイントを削除し、読み取り専用GETのみ残した
    - **admin-dashboard側**: 新設`stores/userDirectory.ts`
      (既存`stores/adminUsers.ts`はサイト管理者権限保有者を指す別概念の
      ため別名にした)・`views/UsersView.vue`・`views/UserDetailView.vue`・
      ルーティング/ナビ追加。`RoomDetailView.vue`は読み取り専用表示+
      プロフィール画面へのリンクに縮小。`stores/adminBadges.ts`から
      不要になったgrant/revoke関数を削除
    - **画面スコープ**: ユーザーに確認の上、将来のユーザー無効化等も
      見据えた拡張しやすい構成を選択。レスポンスに`disabled`フィールドを
      先行して含めている(未実装、布石のみ)
    - **動作確認**: `vue-tsc -b`・`eslint .`・`npm run build`がエラーなく
      完了することを本ドキュメント側で確認した。実機/ブラウザでの動作
      確認はユーザー側で別途必要
    - 副次的に、「5.3 バッジシステム」の「管理画面」欄にあった旧Phase11
      時代の陳腐化した記述(「Phase11でPoCを実施」)も発見し、「Phase13で
      PoCを実施」に訂正した

</details>
