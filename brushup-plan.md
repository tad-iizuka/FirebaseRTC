# PTTアプリ ブラッシュアップ計画（改定版）

対象リポジトリ: `tad-iizuka/FirebaseRTC`
作成日: 2026-07-09 ／ 最終改定: 2026-08-02（三十七訂）

このドキュメントは訂（改定）のたびに履歴を積み増していく形式のため、
冒頭の改定履歴は下記に折りたたんである。通常の参照では「0. README.mdが
定義するビジョンの要点」以降の本文と「6. 次アクションの提案」を読めば足りる。

<details>
<summary>改定履歴（初訂〜三十七訂、クリックで展開）</summary>

改定: 2026-07-24（README.md「Vision」に基づき全面改定）
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
十四訂: 2026-07-27（Phase9残作業のうち「バックグラウンド動作」を実装した。
ユーザーとの確認の結果、対応範囲は「受信のみ」ではなく送受信両方（通知・
ロック画面・ヘッドセットボタン等からバックグラウンドでも送話操作できる
こと）とし、iOS/Androidとも実装まで進めた。詳細は「2-D. Phase1(警備業)
としての完成度に直結する残課題」および「Phase 9」を参照。
- **Android**: `PTTConnectionManager`の所有者をActivityから新設の
  `PTTForegroundService`へ移管した。従来`MainActivity`のCompose内で
  `remember`生成されていたため、Activity破棄(バックグラウンドで長時間
  放置されOSに殺される等)で接続ごと失われる作りだった。Serviceが
  `status`(Connecting/Connected/Reconnecting)を監視し、その間だけ
  `startForeground()`(type=microphone)して常駐通知を出す設計とし、
  ルーム未参加中は常駐通知を出さない。常駐通知に「送話開始/終了」の
  トグルアクションを追加し、あわせて`android.media.session.MediaSession`
  でBluetoothヘッドセット等の物理ボタン(`KEYCODE_HEADSETHOOK`)を
  「押している間だけ送話」として画面上のPTTボタンと同じ体験に、
  ロック画面/クイック設定のNow Playing風コントロールはタップでトグル、
  として対応した。`MainActivity`は`bindService`でインスタンスを取得する
  だけになり、`PTTApp.kt`以下（`connect()`/`startTalking()`等のAPI）は
  無変更。新規ライブラリ依存は追加していない（既存の`androidx.core:core-ktx`
  とフレームワークAPIのみ使用）。`AndroidManifest.xml`(service登録・
  `POST_NOTIFICATIONS`権限)・`strings.xml`(ja/en)・通知アイコンも追加した。
- **iOS**: 新設の`PTTBackgroundControlManager`が`PTTConnectionManager`の
  `status`/`isSending`/`currentTalkerUid`をCombineで購読し、
  `MPRemoteCommandCenter`(ロック画面/コントロールセンターの再生系
  コントロール、およびBluetoothヘッドセットのシングルクリック等の
  物理ボタンも同じ経路で届く)・`UNUserNotificationCenter`による
  バックグラウンド中のみの常駐通知(「送話開始」「送話終了」の2アクション)
  の2経路で送話操作を仲介する。既存の`UIBackgroundModes=audio`と
  `AVAudioSession`(`.playAndRecord`/`.voiceChat`、起動時設定済み)により
  音声の送受信自体はプロセスが生きている限り継続できる前提を活かした
  設計とした。あわせて`AVAudioSession.interruptionNotification`を購読し、
  電話着信等でオーディオセッションを奪われた際は安全側に倒して送話を
  自動終了するようにした。`ContentView.swift`に`@StateObject`として
  追加し、`.onAppear`で一度だけ`attach(to:)`する形で組み込んだ。
`Localizable.xcstrings`に新規文言のen翻訳を追加した。

十五訂: 2026-07-28（実装済みコードを再棚卸しし、Phase13のバッジ基本機能、
管理者のユーザー管理、Phase16のチャット添付ファイルを計画へ反映した。Phase13は
グローバルな1バッジマスタ、ユーザー単位の付与記録、3クライアントでの参加者一覧
表示、管理画面でのマスタ・ユーザー別付与/剥奪まで実装済み。Phase16は画像・動画・
PDFをGCSの署名付きURLで送受信するサーバーおよびWeb UIまで実装済みである。一方、
iOS/Androidの添付UI、自動付与バッチ、添付用GCSの本番運用設定、バックグラウンド
動作のビルド・実機検証は未完了として次アクションに残す。）

**（重要な留保）** 以下の2点は本改定時点で未実施・未確認である。
1. **実機検証が未実施**: このドキュメント作成時点でのAndroid/iOSの
   バックグラウンド動作検証は静的なコードレビューの範囲に留まり、
   実機でのロック画面操作・長時間バックグラウンド接続維持・Doze/App
   Standbyやメーカー独自の電力最適化による強制終了の有無・Bluetooth
   ヘッドセットとの実際の挙動については確認できていない。次アクション
   として残す。
2. **ビルド確認が未実施**: 今回の変更を行った環境はネットワークアクセスが
   制限されており、Gradle/Xcodeいずれもビルド実行ができなかった
   （`./gradlew`はGradle配布物のダウンロードで失敗、Xcodeは環境に
   存在しない）。コード上のimport・API シグネチャ・波括弧/丸括弧の
   対応関係は目視・簡易チェックで確認したが、コンパイルレベルでの
   検証はユーザー側の手元環境で行う必要がある。
- 今回の変更はアップロードされたZIPアーカイブ（`ptt-ios.zip`・
  `ptt-android.zip`）に対して行い、更新版ZIPとして返却したものであり、
  `tad-iizuka/FirebaseRTC`リポジトリへの実際のコミット・反映は本ドキュメント
  作成時点では未確認。六訂・八訂で踏んだような`git show`等での確認プロセスを
  次アクションとして残す。

十六訂: 2026-07-28（「6. 次アクションの提案」item 3「Phase16 添付ファイルの
運用・クライアント展開」のうち、iOS/Android版の添付UI実装が完了したことを
アップロードされたリポジトリ一式（HEAD=`cc9369b`）の`git show`で直接検証した。
- **iOS**: コミット`50a56a5`("update")で`PTTChatStore.swift`に
  `sendAttachment`/`getAttachmentURL`/`getThumbnailURL`等を追加し、
  Web版(`ptt-client/src/stores/chat.ts`)と同じ3段階の流れ（署名付き
  アップロードURL発行 → token-serverを経由せず直接PUT → `POST /messages`で
  確定）を実装済みであることを確認した。`ContentView.swift`側には
  `PhotosPicker`（写真/動画）・ファイルアプリ経由のPDF選択・送信前プレビュー
  （pendingAttachment）・画像は送信前クライアント圧縮・添付付きメッセージの
  表示（画像はサムネイル、動画/PDFはアイコン＋ファイル名でタップ時に
  署名付きURLを開く）まで一通り配線されていることをコードで確認した
- **Android**: コミット`0507c28`("upadte")で`PTTChatStore.kt`に同等の
  `sendAttachment`/`getAttachmentUrl`等を追加し、`PTTApp.kt`に
  `ActivityResultContracts.OpenDocument()`による添付ピッカー・送信前
  プレビュー・添付付きメッセージ表示までiOS版と同じ構成で実装済みで
  あることを確認した
- 両OSともWeb版の設計（token-serverを経由しない直接PUT、5分間有効な
  署名付きURLをmessageId単位でメモリキャッシュ、画像の送信前クライアント
  圧縮）を踏襲しており、六訂で問題視した「実コード追随漏れ」は今回は
  見当たらなかった

一方、item 3のもう一方の要素である「添付用GCSバケット・CORS・
サービスアカウント・保持期限クリーンアップの本番設定・検証
（`token-server/phase16-operations.md`参照）」は、今回の変更対象に含まれて
おらず（`token-server/cors.json`・同ドキュメントの更新履歴に今回のコミットは
含まれていない）、引き続き未着手であることも確認した。したがって item 3は
「クライアント実装」と「本番運用設定」の2つの要素のうち前者のみが完了した
状態として扱い、後者を次アクションとして残す（詳細は「6.1」item 10・
「6. 次アクションの提案」item 3参照）

十七訂: 2026-07-28（十六訂で残した item 3 の残り要素「添付用GCSバケット・
CORS・サービスアカウント等の本番運用設定」について、ユーザーから
「終わっている。実際にアップロードした画像が保存されていることを確認済み」
との報告を受けた。**（留保の位置づけについて）** これは十一訂・十七訂
（旧版、Guest/role-sync関連）の「申告のみ」の確認とは異なり、実際に本番
環境へ画像をアップロードし、それが保存される（＝署名付きURL発行→GCSへの
PUT→GCS実体検証を伴う`POST /messages`確定、という一連の経路が本番で
実際に動作した）ことをユーザー自身が確認したという、エンドツーエンドの
機能確認である点で、単なる口頭申告より確度は高い。一方で、`gcloud`
コマンドでのバケット作成・CORS設定・IAMバインディング等はクラウド側の
リソース操作であり、六訂・八訂で行ったような`git show`によるリポジトリ内の
コミット内容の直接検証はそもそも対象にならない（設定はコードではなく
インフラ状態のため）。そのため本改定では、「本番での実アップロード動作を
ユーザーが確認した」という中間〜高めの確度の確認として記録し、次アクション
item 3を完了扱いとして「6.1」へ移動する）

十八訂: 2026-07-28（「6. 次アクションの提案」item 2「Phase12 role×操作の
対応表を実装へつなげる」に着手・完了した。棚卸し
（`phase12-role-operation-inventory.md`）の時点で判明していた論点のうち
実装アクションが伴うもの（論点1・2・4）と、実コード確認の過程で新たに
見つかった「対応表に定義はあるが実装が経由していない」操作群（論点8として
追記）を解消した。詳細は`phase12-role-operation-inventory.md`「4. 対応表
一元化に向けた論点まとめ」の追記も参照。
- **`POST /reports`のmembership非チェックを修正**: `routes/reports.js`の
  ハンドラ内で、通報者が対象roomIdのメンバーであること・BAN済みでないことの
  検証を追加した。このルーターは`/reports`直下にマウントされておりroomIdは
  bodyから来るため（`server.js`参照）、`req.params`前提の既存
  `requireRoomMembership`ミドルウェアはそのまま使えず、同等の判定を
  ハンドラ内に直接実装する形をとった。以前はログイン済みであれば対象roomの
  メンバーでなくても任意の`roomId`/`reportedUid`で通報できてしまっていた
- **`ROOM_OPERATIONS`に定義済みだが未配線だった4操作を配線**:
  `lib/permissions.js`の対応表には`talk:control`（送話ロック）・
  `nickname:update`・`org_context:read`・`chat:send`がrole不問
  （`ROOM_ROLES`）としてすでに定義されていたが、実際の`routes/talk.js`
  （3エンドポイント）・`routes/rooms.js`（nickname/org-context）・
  `routes/messages.js`（チャット送信）は`requireRoomMembership`止まりで
  `hasRoomPermission`/`requireRoomPermission`を経由していなかった。
  「対応表を変更しても一部の操作の挙動には反映されない」という事故の
  もとになるため、いずれも`requireRoomPermission('...')`を追加し、表と
  実装の強制経路を一致させた（現状は全roleが対象のため挙動自体は変わらない。
  `chat:attachment_upload`/`chat:attachment_read`は元々配線済みだったため
  対象外だった）
- **`rooms.js`/`admin.js`間で重複していたmoderator任命ガードを共通化**:
  Room内owner専用API（`routes/rooms.js`）とサイト管理者代行API
  （`routes/admin.js`、`rooms:manage`権限、Phase12で追加されていたことを
  今回確認）の両方に、「owner降格禁止・BAN済み対象禁止・guest任命禁止」
  という全く同じガードが重複実装されていた（棚卸しの論点4で指摘した内容）。
  `lib/permissions.js`に`checkRoleAssignmentTarget()`を新設し、両ルートから
  参照する形に一本化した
- 変更した6ファイル（`token-server/routes/{reports,talk,rooms,messages,
  admin}.js`・`token-server/lib/permissions.js`）はいずれも`node --check`で
  構文確認済み。既存の`scripts/check-role-sync.js`（サーバーの対応表と
  3クライアントの定数の同期チェック）も引き続き成功することを確認した
  （今回の変更はクライアント側定数には触れていないため無関係だが、
  退行が無いことの確認として実行した）
- **今回対応しなかった論点（棚卸しの論点3・5・6・7）**: 「Room作成」非表示の
  判定軸は`isAnonymous`を正とする決定がすでにコード上のコメントで明文化
  されていることを確認した（論点3、実質決着済み）。admin-dashboardの事前
  権限チェック追加（論点5）・招待コードの可視範囲（論点6）は実装ではなく
  仕様判断が先に必要なため、次アクションとして残す。`settings.autoRecording`
  の複数権限経路の表現方法（論点7）はドキュメント表現の問題であり実装
  アクションを伴わない
- **今回の変更はアップロードされたリポジトリのソースファイルへ直接行った
  ものであり、`tad-iizuka/FirebaseRTC`への実際のコミット・反映は本改定時点
  では未確認**。六訂・八訂・十六訂で踏んだのと同じ、`git show`等による
  リポジトリ側での反映確認を次アクションとして残す

十九訂: 2026-07-30（「6. 次アクションの提案」item 5「十八訂の変更のリポジトリへの
反映確認」を実施した。アップロードされたリポジトリ一式（HEAD=`d2b1b27`）を
取得し、`git show`でコミット`d802de0`("update"、2026-07-28 18:03:02 +0900)を
直接検証した結果、十八訂で行った`token-server/lib/permissions.js`・
`routes/{reports,talk,rooms,messages,admin}.js`の変更（通報APIの
メンバーシップ検証追加・`ROOM_OPERATIONS`未配線4操作の配線・
`checkRoleAssignmentTarget`の共通化）が、いずれもこのコミットで実際に
リポジトリへ反映されていることを確認した(`git show --stat d802de0`で
変更8ファイルを確認、`reports.js`の差分は本文まで目視で照合)。なお同一
コミットで本ドキュメント（`brushup-plan.md`）自体の十八訂記述・
`phase12-role-operation-inventory.md`もあわせてコミットされていた。
これは六訂・八訂・十六訂で踏んだのと同じ、`git show`によるコミット内容の
直接検証であり、ユーザー申告のみ(十一訂等)やスクリーンショット(旧版十七訂)
より確度の高い分類として記録する。次アクションの該当項目を完了扱いとし
「6.1」item 13へ移動する）

二十訂: 2026-07-30（「6. 次アクションの提案」item 1「バックグラウンド動作
(十四訂)のビルド確認・実機検証」のうち、iOS分について実機（iPhone）での
動作確認結果を、ユーザーからのスクリーンショット2枚とともに受けた。
確認できた内容は以下の3点。
(1) バックグラウンド遷移時・接続状態変化時に、十四訂で実装した
`PTTBackgroundControlManager`経由の常駐通知（「接続中: {roomId} / 待機中」）が
実際にロック画面/ホーム画面上に表示されている（スクリーンショット2枚目）
(2) バックグラウンド中にBluetoothヘッドセット等のハンドセット物理ボタンで
送話を開始すると、`MPRemoteCommandCenter`経由の仲介によりアプリが
フォアグラウンドへ復帰し、送話中（スクリーンショット1枚目の「送話中」表示・
オレンジ枠）の状態が実際に確認できる
(3) その状態から再度バックグラウンドに戻しても、通話（送受信）自体は継続
して動作する
ユーザーからは「現状の実装です」との説明があり、今回新たに実装を加えた
ものではなく、十四訂時点の既存コードによる挙動であることを確認した。

**（留保）** 十四訂・十五訂で「未実施」としていた実機検証のうち、今回
確認できたのはiOS・かつ (a)フォアグラウンド/バックグラウンド間の遷移と
それに伴う通話継続、(b)ハンドセットボタンでの送話開始、(c)常駐通知表示、
の3点である。以下は今回の報告だけでは確認できておらず、次アクションに
残す。
- Android側の実機検証（`PTTForegroundService`）は今回未報告
- 長時間バックグラウンド接続維持（Doze/App Standby等の電力最適化による
  強制終了の有無）
- Bluetoothヘッドセット単体（物理ハンドセットではなく）での送話開始・終了
- Xcodeでのビルド確認自体は、実機で動作している以上、少なくとも
  ユーザー環境でのコンパイル・実行には成功していると判断してよいが、
  `git show`等によるコミット内容の直接検証（六訂・八訂・十六訂・十九訂の
  ような形）は今回実施していない
また、確認方法はユーザー提供のスクリーンショット2枚と説明文であり、
`git show`によるコミット内容の直接検証（十九訂等）よりは確度が高いものの
（実際の画面表示という一次証跡がある点で十一訂の「口頭申告のみ」より強い）、
リポジトリ側の実コード確認ではない点は区別して記録する。次アクションの
該当項目は「iOS: 主要シナリオ確認済み、Android・長時間/電力最適化・
Bluetoothヘッドセット単体は未確認」として範囲を絞り込んだ上で残す）

二十一訂: 2026-07-30（二十訂で確認した「ハンドセットボタン押下でフォアグラウンドに
復帰する」挙動について、ユーザーとの対話の中で原因調査・設計判断・実装撤回まで
実施した。

**（重要な発見）実コード側に、これまでどの改定にも記載のなかった実装が存在していた**：
`ptt-ios/ptt-ios/PTTCallKitManager.swift`（CallKit統合）。十四訂で実装した
バックグラウンド動作は`MPRemoteCommandCenter`/`UNUserNotificationCenter`のみを
対象に記載していたが、実際のコードにはCallKit統合が別途存在しており、本改定まで
本ドキュメントのどこにも記録されていなかった。冒頭コメントによれば、Elecom
LBT-HS11等HFP接続のBluetoothヘッドセットの物理ボタン信号は`MPRemoteCommandCenter`
に一切届かないことが実機検証で確認されており、これを拾うためにRoom接続を
「発信して即接続済みになった通話」としてCallKitに偽装登録する回避策が別途
実装されていたと分かった（十四訂以降、本ドキュメントの記載更新なしに追加された
実装である可能性が高い）。

**原因の特定**：CallKitの`CXEndCallAction`（ボタン1回の押下に対応）を受け取ると
その「通話」はCallKit上で終了扱いになり、次のボタン押下を拾うには
`CXStartCallAction`で即座に新しい通話として再登録する必要がある。Appleの仕様上、
`CXStartCallAction`（発信通話）の登録はアプリを自動的にフォアグラウンドへ
引き上げる（着信応答`CXAnswerCallAction`と異なり、発信はユーザーがダイヤル画面を
見ている前提のため）。ボタンを押すたびに「終了→即再発信」を繰り返す設計のため、
押すたびに前面化していた。またこれとは別に、`PTTBackgroundControlManager`の
常駐通知が状態変化(送話フラグ・発話者UID・接続状態のいずれか)のたびに
`willPresent`でバナー+サウンドを毎回出す実装になっており、他の参加者の発話でも
鳴る点も合わせて指摘した（**こちらは今回未修正、次アクションに残す**）。

**検討した選択肢**：
- A. 現状維持(前面化を許容)
- B. CallKit統合を撤回し`MPRemoteCommandCenter`のみに戻す
  （このヘッドセット機種のボタンは無反応になるが前面化・関連する通知連鎖は解消）
- C. 着信(`reportNewIncomingCall`)方式へ変更(未検証。着信音・着信UIが出る懸念が
  実装当初から却下理由になっており、試すまで改善するか分からない)

ユーザーからは「バックグラウンド中に勝手にフォアグラウンドに戻るのはバッテリー
消費の観点から許容できない」との方針が示され、影響範囲の洗い出し
（画面PTTボタンのhold-to-talk・Bluetoothヘッドセットのマイクルーティングへの
影響有無を含む）を経て、**Bを選択・実装した**。

**実装内容（`ptt-ios.zip`に適用、Xcode 16のファイルシステム同期グループ形式の
プロジェクトのため`.pbxproj`側の追加修正は不要と確認済み）**：
- `PTTCallKitManager.swift`を削除
- `ContentView.swift`: `callKitManager`の`@StateObject`宣言・`attach(to:)`呼び出しを削除
- `ptt_iosApp.swift`: 起動時にエンジンを`.none`にしてCallKitの`didActivate`を待つ
  設計をやめ、`session.setActive(true)`＋`setEngineAvailability(.default)`を
  直接呼ぶ形に戻した。Bluetoothマイク優先の`.allowBluetooth`等のセッション
  カテゴリ設定はCallKitと無関係のため変更していない（画面のPTTボタンで送話中は
  Bluetoothヘッドセットのマイクが使われる、というユーザー指摘の挙動は維持される）
- `PTTConnectionManager.swift`: keep-aliveトラックのpublishを、CallKitの
  `didActivate`経由の呼び出し待ちから`connect()`直後の直接呼び出しに戻した
  （エンジンが起動時から常時利用可能になったため、CallKit導入時に生じていた
  不安定さの原因も併せて解消される）
- `Info.plist`: `UIBackgroundModes`から`voip`を削除し`audio`のみに戻した
- `PTTAudioDiagnostics.swift`: 未使用のまま残置（コメントのみ更新。将来CallKit再検討時の
  切り分け用に保持）

**留保**：この変更を行った環境はオフラインのためビルド確認・実機検証は未実施。
また、この修正は今回もアップロードされたZIPアーカイブに対して行い、更新版ZIPとして
返却したものであり、`tad-iizuka/FirebaseRTC`リポジトリへの実際の反映は本ドキュメント
作成時点では未確認（六訂・八訂等と同じ確認プロセスを次アクションとして残す）。
なお`PTTBackgroundControlManager`の通知頻発（状態変化のたびにバナー+サウンド、
他参加者の発話でも鳴る）は今回のスコープ外として未修正のまま残っている。）
二十二訂: 2026-07-30（実装ではなく設計検討として、「ユーザー×団体の所属関係」
（十三訂でPhase11実装時に明示的に着手対象外とした論点。5.4参照）をどう補うかを
ユーザーと検討し、別ドキュメント`phase11-org-roster-design.md`としてまとめた。
MLBの「球団と選手の関係は一時的なつながりであり、トレード・フリーエージェントも
あり得る」という例えを出発点に、警備業における「団体所属」と「Room参加」を
別レイヤーとして扱う設計（本ドキュメント内では**案C「任意のロースター層」**と
呼称）で方向性の合意を得た。

**検討内容の要旨（詳細は`phase11-org-roster-design.md`参照）：**

- 案A（現状維持・所属関係を持たない）、案B（所属を必須かつRoom参加権限とも
  連動する形で実装）、案C（所属情報は追加するが、Room入室の権限判定には使わず
  `rooms/{roomId}/members/{uid}`のroleのみで判定する付帯情報として位置づける）
  の3案を比較し、**案Cを採用**することでユーザーと合意した。Room First原則・
  Guestの扱い（昇格導線を持たせない方針、5.1参照）を崩さずに警備業の実務要件
  （団体単位の名簿・配置管理）に対応できるため
- データモデル案として`organizations/{orgId}/members/{uid}`
  （`orgRole: 'admin' | 'staff'`程度の粗い区分のみ）を提示した
- 具体的な動線として、(1) 新しい警備会社を登録・管理する人（サイト管理者による
  初回団体管理者の代理登録 → 以降は団体管理者自身による名簿管理）、
  (2) 一般警備士がシステムに入る動線（団体管理者による名簿招待 → Member登録 →
  Room参加自体は従来通り招待コード、という所属と参加の分離）の2つを具体化した
- 波及効果として、5.4「バッジマスタの団体単位管理」（当時の未解決依存）・
  「招待コードの可視範囲」（Phase12検討事項）の双方に、この名簿層があれば
  道筋がつくことを確認した。ただし**本ドキュメントの現行版では、Phase13
  バッジ基本機能は既にグローバル1マスタ構成で実装完了しており（「Phase 13」
  参照）、団体単位拡張はPhase15（業界ラベリング層）に位置づけられている**ため、
  ロースター層の主な適用対象は当面「招待コードの可視範囲」（Phase12）および
  団体管理者向けの新しい管理画面機能となる

**留保・未確定事項（次アクションへ）**：

- 団体管理者というスコープ付き権限をadmin-dashboardの権限モデルにどう
  追加するか（現状は「サイト管理者」「Room内owner/moderator」の二択のみで、
  「特定orgId配下だけ管理できる」中間スコープが存在しない）
- 最初の団体管理者の代理登録フロー（鶏卵問題）の具体的なAPI設計
- `orgRole`の粒度（`admin`/`staff`の2値で足りるか）
- 本改定は**設計合意のみであり、データモデル・API・権限モデルいずれも
  未実装**。実装着手前に、Phase12（役割と機能の整理）の詳細設計と合わせて
  仕様を固める必要がある）

二十三訂: 2026-07-31（ユーザーから受け取った最新の`brushup-plan.md`・
新規`phase11-org-roster-design.md`を起点に、アップロードされたリポジトリ
一式（`FirebaseRTC.zip`、HEAD=`544b853`）の`.git`履歴を再度直接検証した。
二十二訂までに記載のない、2026-07-30中の後続コミットが2件見つかったため、
六訂・八訂・十六訂・十九訂と同じ`git show`による直接検証として反映する。
`phase11-org-roster-design.md`自体はリポジトリ内には存在せず（`git log`で
無履歴を確認）、二十二訂の記述通りまだ設計メモの段階に留まっていることも
あわせて確認した。

**(1) コミット`f7388aa`（2026-07-30 04:23）: 二十一訂のCallKit撤回が
リポジトリへ反映済みであることを確認**
`git show --stat f7388aa`で、`PTTCallKitManager.swift`の削除・
`ContentView.swift`/`Info.plist`/`PTTAudioDiagnostics.swift`/
`PTTConnectionManager.swift`/`ptt_iosApp.swift`の変更、および
`brushup-plan.md`自体の更新（128行）が同一コミットに含まれていることを
確認した。二十一訂で「次アクション」としていた「リポジトリへの反映確認」
（次アクション item1(e)の一部）はこの範囲で解消したとして扱う。

**(2) コミット`c8d05cf`（2026-07-30 04:45）: 次アクション item1(d)
「常駐通知の頻発」を解消**
`PTTBackgroundControlManager.swift`から常駐通知(`UNNotification`)機構を
全面撤去し、Now Playingウィジェット（`MPRemoteCommandCenter`）のみに一本化
したことを`git show`で確認した。ファイル冒頭に追加されたコメントによれば、
理由は「送話開始/終了のたびに常駐通知内容を更新する設計だったため、
`interruptionLevel`を`.passive`にしてもロック画面の通知一覧に残り続け、
Now Playingウィジェットと表示が完全に重複していた」「通知側のアクション
ボタンも、Now Playingウィジェットの再生/一時停止と同じ操作を別の見た目で
提供しているだけだった」の2点。次アクション item1(d)（他参加者の発話でも
バナー+サウンドが鳴ってしまう問題）は、通知機構自体をなくしたことで解消
されたと判断する。

**(3) コミット`544b853`（2026-07-30 09:57、現HEAD）: これまでの改定に
一度も記載のなかった新規バグ修正（音声再生の遅延）**
`PTTConnectionManager.swift`（+62行）・`PTTAudioDiagnostics.swift`（+6行）
に対する変更で、コミットメッセージは今回も`update`のみだったため、コード内
コメントから経緯を再構成した。
- **症状**: 実機で「PTTボタンを押すまでWeb→iOS方向の音声が一切聞こえず、
  ボタンを押した瞬間に溜まっていた音声が再生される」現象が確認されていた
- **原因診断**: LiveKit Room接続時点では音声エンジン(ADM)が起動しておらず、
  ローカルのマイク入力を開始して初めて起動する実装になっていたと判断。
  コメント上、`setRecordingAlwaysPreparedMode(true)`(@MainActor上でのawait
  がハングする疑いで撤回)・`acquireSessionRequirement(...)`(SDKソースを
  確認した結果、要求登録のみでADMを実際には起動しないAPIと判明)の2つを
  試した上で、最終的に`AudioManager.shared.startLocalRecording()`
  （Room接続やトラックpublishと独立してADMを直接起動できる、LiveKit SDKの
  同期APIとコメントに明記）をRoom接続直後に呼ぶ「事前ウォームアップ」方式を
  採用したと分かる
- **実装内容**: `connect()`内でRoom接続完了直後に
  `AudioManager.shared.startLocalRecording()`を呼び、成功可否に関わらず
  接続自体は継続（失敗時は非致命的としてログのみ）。`disconnect()`・
  切断時のRoomDelegateコールバック双方で対応する
  `stopLocalRecording()`の後始末を追加。あわせて、`appendLog()`が従来
  アプリ内ログ画面にのみ書き出しており、Xcodeコンソール/実機ログには
  出力されていなかった点を`print()`併用に変更し、`isEngineRunning`の状態や
  マイク有効化に要した時間を記録する診断ログ（`[診断]`プレフィックス）を
  複数箇所に追加している
- **確認レベルについて**: これは`git show`によるコード内容の直接検証であり、
  実装が存在すること自体は確認できた。一方、この修正によって実機で実際に
  症状が解消したかどうかは、コード内コメントからは判断できず（診断ログを
  仕込んだ状態であり、まさに検証中の可能性が高い書きぶりである）、本改定
  ではその点を未確認として次アクションに残す。またAndroid版で同種の問題が
  起きていないかどうかも、本コミットの対象がiOSのみであるため未確認である

**(4) `phase11-org-roster-design.md`の反映状況**
`git log --all -- phase11-org-roster-design.md`で無履歴であることを確認した。
二十二訂の記述通り、現時点ではドキュメントとしてのみ存在し、
`organizations/{orgId}/members/{uid}`等の実装（データモデル・API・
Firestoreルール・admin-dashboardの権限モデル拡張）はいずれも未着手のまま
である。次アクション item5（本ドキュメントの5点目）の記載と齟齬はない。

> **本改定の確認レベルについて**: 上記(1)〜(3)は、六訂・八訂・十六訂・
> 十九訂と同じ「アップロードされたZIPの`.git`履歴・コード本体を直接読む」
> レベルの確認である。ただし(3)の「実機での症状解消」自体は、リポジトリ
> 側の情報だけでは判断できないため未確認として扱う。

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

二十四訂: 2026-07-31（`phase11-org-roster-design.md`（案C）を踏まえ、
admin-dashboardの権限モデルへの「団体管理者（特定orgId配下のみ管理）」
スコープの追加方法について検討し、以下の通り合意した。`token-server`の
実コード（`middleware/requireAdmin.js`・`routes/organizations.js`）を
確認した上で決定しており、design memo単体の想定から一部修正を加えている）

**1. 階層構造の確定（再帰的スコープモデルを維持）**

固定された名前付きの階層（Company admin / Branch group等）を列挙するのでは
なく、「あるuidが、あるnodeIdをscopeとして持つ」という**1種類の関係**を
木の任意の深さに対して適用する、当初合意した再帰的スコープモデルを
そのまま採用する。固定されているのは以下の2点のみで、それ以外は
すべて`scopeNodeIds`の値次第で任意の深さ・組み合わせを表現できる。

```
root（既存のadminUsers権限モデル。木構造の外側にある別ロジック。
      今回の文脈では'organizations:manage'権限の保持者をrootとして扱う）
  └─ org内admin（organizations/{orgId}/members/{uid}、orgRole:'admin'。
       scopeNodeIds未指定 = org木全体を管理
       scopeNodeIds: [nodeId, ...] = 指定node(木の任意の深さ、Branch/Site
         問わず)とその配下を管理。複数指定で兼務も表現できる）
       └─ staff（orgRole:'staff'。管理権限を持たない末端）
```

「Company admin」「Branch group」という呼び方は、あくまで
`scopeNodeIds`が空(org全体)か、特定node(Branch相当)を指しているかの
**代表的な2ケースの説明**であり、モデル上は固定の層ではない。例えば
`scopeNodeIds: ['siteA1']`のようにSite単位を直接指すことも、
`scopeNodeIds: ['branchA', 'branchB']`のように複数nodeを跨いで兼務する
ことも、同じ`scopeNodeIds`という1つの仕組みでカバーされる。「祖先の
scopeは子孫のscopeを包含する」というoverride関係も、名前付きの層をまたぐ
特別な規約としてではなく、次項の`ancestorIds`包含判定から自然に導かれる
（scopeNodeIdsにBranchAを持つuidは、その配下のSiteA1に対する判定でも
SiteA1の`ancestorIds`にBranchAが含まれるため許可される）。

当初「rootを木の頂点ノードとして`node_admins`という新設コレクションに
統合する」案も検討したが、既存の`adminUsers`権限モデル
（`middleware/requireAdmin.js`）は単一のrootフラグではなく、
`admins:manage`/`organizations:manage`/`rooms:monitor`等の権限文字列配列
（現状10種）であることを実コードで確認した。これを踏まえ、rootは既存の
権限モデルへの素直な参照（`organizations:manage`権限の保持）とし、
それ以外（org内admin以下）のみを再帰的スコープモデルで表現する、
という切り分けに確定した。

**2. データモデル**

当初検討した独立コレクション`node_admins`は不採用。既存の
`organizations/{orgId}/members/{uid}`（ロースター、`phase11-org-roster-
design.md`で提案済み・未実装）を拡張する形に統一した。

```
organizations/{orgId}/members/{uid}
  orgRole: 'admin' | 'staff'
  scopeNodeIds?: string[]   // 省略/空配列 = Company全体管理
                            // 1件以上 = 列挙node配下の兼務管理（同列。
                            // 兼務する階層間で権限・付与者を分ける
                            // 運用上の必要性は薄いと判断し、
                            // grantedAt/grantedByはドキュメント単位で
                            // 単一のまま持たせない）
  grantedAt: timestamp
  grantedBy: uid
```

**3. 祖先判定は既存の`ancestorIds`を流用（新規実装不要）**

Phase11の`routes/organizations.js`で、node作成時に`ancestorIds`
（非正規化された祖先ID配列）が既に計算・保存されていることを確認した
（`ancestorIds = [...(parent.ancestorIds || []), parentNodeId]`。
`PATCH /admin/rooms/:roomId/org-assignment`でもRoom側に
`nodeAncestorIds`として同様に複製されている）。そのため、scope限定admin
の判定は「parentNodeIdを逐次辿るループ」を新設する必要がなく、既存の
`node.ancestorIds`（+自身のnodeId）と`scopeNodeIds`の共通要素の有無で
判定できる。

```
権限判定(uid, orgId, 対象nodeId):
  1. adminUsers の permissions に 'organizations:manage' が含まれるか
     → Yes ならroot、無条件許可
  2. organizations/{orgId}/members/{uid} を読む
  3. orgRole !== 'admin' → 不許可
  4. scopeNodeIds が空/未指定 → 許可（Company全体admin）
  5. scopeNodeIds が指定されている場合：
     対象nodeIdの ancestorIds（+自身）と scopeNodeIds の
     共通要素があれば許可、なければ不許可
```

**4. override規約**

rootは常時org内admin(scope問わず)をoverride可能。org内adminどうしは、
`ancestorIds`の包含関係により、広いscope(浅いnode、または未指定=org全体)
を持つadminが、狭いscope(その配下のnode)を持つadminをoverride可能
（固定の層数ではなく、scopeの包含関係のみで決まる）。監査ログは必須。
通知は当面「ログのみ、即時通知はしない」（Phase14のプッシュ通知基盤待ち。
将来的に`organizations/{orgId}`側へ通知要否設定を団体管理者が持てるように
する余地を残す）。

**5. 監査ログスキーマ**

新規コレクションは作らず、既存の`auditLogs`（`lib/auditLog.js`・
`logAdminAction()`、`actorUid`/`action`/`targetRoomId`/`targetUid`/
`detail`/`createdAt`/`expireAt`という既存スキーマ、TTL 400日）を拡張する
形で統合する。

- `action`：既存の"namespace:verb"命名規則（`room:ban`等）に合わせ、
  `org:member_grant` / `org:member_revoke` / `org:member_view` /
  `org:member_edit`を新設
- `detail`（既存の自由形式フィールド）に以下を格納し、トップレベル
  スキーマは変更しない（既存の`AuditLogsView.vue`・`adminAuditLogs.ts`
  への影響を避ける）：
  - `orgId`, `targetNodeId?`
  - `actorType`: 'root' | 'org_admin_full' | 'org_admin_scoped'
    （`scopeNodeIds`の有無で機械的に判別）
  - `actorScopeNodeId?`: scope限定adminの場合、一致したnodeId
  - `isOverride`: boolean。`organizations/{orgId}/members/{actorUid}`に
    admin登録が無ければ常にtrue（機械的に判定）
- `action: 'org:member_view'`は、招待コード再取得に加えて名簿一覧の
  閲覧も対象に含める

**6. 未決事項（次アクションへ）**

- 最初の団体管理者の代理登録フロー（鶏卵問題）の正式API化
- `GET /admin/me`の実装（`managedOrgIds`等、団体管理者UIの成立要件として
  保留から昇格）
- 通知設定（`organizations/{orgId}`側の要否フィールド）の具体的な
  フィールド名・デフォルト値
- `phase11-org-roster-design.md`自体のリポジトリ反映（引き続き未反映。
  設計メモの段階）
- Site単位以下の粒度（招待コードの「Site限定閲覧」）は今回もスコープ外の
  まま。Branch単位の`scopeNodeIds`で当面代替する方針を維持

二十五訂: 2026-07-31（次アクション item1「バックグラウンド動作・音声再生の
実機検証」について、ユーザーから実機検証結果の報告を受けた。**（確認レベル
について）** 今回はスクリーンショット等の一次証跡は伴わない、ユーザー本人
からの申告のみに基づく。十一訂・十七訂（旧版）と同じ「申告のみ」の分類で
あり、二十訂（スクリーンショット2枚を伴う確認）や、六訂・八訂・十六訂・
十九訂・二十三訂（`git show`によるコード内容の直接検証）よりは確度が低い
点に留意して記録する。

報告内容は以下の通り。

- **iOS: CallKit撤回版でのビルド確認・実機再検証** → 確認済み。画面PTTボタン
  のhold-to-talk・Bluetoothヘッドセットのマイクルーティングが維持されている
  ことを含めて確認したとの報告
- **(a) Android実機検証（`PTTForegroundService`）** → 確認済み
- **(b) 長時間バックグラウンド接続維持・Doze/App Standby等の電力最適化機能の
  影響** → 確認済み
- **(c) AVRCP系Bluetoothヘッドセットでのトグル動作確認** →
  **「トグルはしない」ことを確認済み**。二十一訂でCallKit統合を撤回した際、
  「HFP系ヘッドセットのボタンは無反応になる」ことは想定済みだったが、
  AVRCP系ヘッドセットについても同様にトグル動作しないことが実機で確認
  された。これは不具合ではなく、`MPRemoteCommandCenter`経由の実装が
  対応する入力経路の範囲についての仕様上の制約として記録する（Bluetooth
  ヘッドセットの音声プロファイルにより、物理ボタンでのPTT操作に対応
  できる機種とできない機種がある、という制約が確定した）
- **(d) 常駐通知の頻発（コミット`c8d05cf`で解消済みとしていた点）の実機再
  確認** → 確認済み
- **(e) CallKit撤回のリポジトリ反映（コミット`f7388aa`で確認済みとしていた
  点）** → 確認済み
- **(f) コミット`544b853`で修正された「PTTボタンを押すまで音声が聞こえない」
  バグの実機検証** → 確認済み（症状解消を確認）
- **Android側で同種の音声再生遅延バグが起きていないかの確認** → 確認済み
  （同種の問題は発生していないとの報告）

以上により、次アクション item1は全ての小項目が完了したため、「6.1」item 16
へ移動する。なお(c)で判明した「AVRCP系ヘッドセットは物理ボタンでのPTT操作に
対応できない」という制約は、不具合ではなく仕様上の既知の限界として
「2-D. Phase1(警備業)としての完成度に直結する残課題」に記録し、対応する
ハードウェア機種の選定・案内が必要な場合は運用側の課題として次アクションに
残さないこととした（設計判断としてBを選択した二十一訂の帰結であり、
再検討する場合はAVRCP側の別実装(C案の着信偽装等)の再検討が必要になる）。

二十六訂: 2026-07-31（次アクション item3「Phase12の残課題（棚卸しの論点5・6）
の仕様判断」のうち論点5（admin-dashboardの事前権限チェック）について、
ユーザーから具体的な現象の指摘を受けた。それまで本ドキュメントでは
「事前チェックが無く、APIを呼んで403が返ってからエラー表示する作りに
なっている」という設計方針レベルの記述に留まっていたが、これまでに取得
済みのリポジトリ（HEAD=`544b853`）のコードを直接読み、指摘内容を裏付ける
実装を確認した。前回・前々回のような新規ZIP取得ではなく、既存のスナップ
ショットに対する再読み込みであるが、確認手法自体は六訂・八訂・十六訂・
十九訂・二十三訂と同じ「コード本体の直接検証」に分類する。

**確認できた3点：**

1. **未ログイン時にトークンサーバーURLが見えている**：`AuthView.vue`（未
   ログイン時に表示される唯一の画面）に、`settings.tokenServerUrl`を
   直接バインドした入力欄がラベル付きで常時表示されている。ログイン画面の
   構成要素として通常必要な情報ではなく、接続先バックエンドのURLという
   インフラ情報が未認証の閲覧者にもそのまま見える状態になっている
2. **権限がなくてもGoogleアカウントでログインでき、メニューが見える**：
   `stores/auth.ts`の`signInWithGoogle()`はFirebaseの`signInWithPopup`を
   呼ぶのみで、`adminUsers/{uid}.permissions`の有無・内容を一切確認して
   いない。`App.vue`側も`v-if="!auth.currentUser"`でログイン画面と本体を
   出し分けているだけで、`currentUser`が存在しさえすれば（＝Googleで
   サインインさえできれば）権限の有無に関わらず`NavTabs`（Rooms/監査ログ/
   管理者/組織/バッジ/ユーザーの全タブ）が表示される。`router/index.ts`の
   `meta: { requiresAuth: true }`もFirebase Authのセッション復元待ちを
   行うだけで、権限チェックには使われていない。つまり、招待コード等を
   知らずとも、任意のGoogleアカウントを持つ第三者がサインインボタンを
   押すだけで、管理画面のメニュー構成自体は誰でも閲覧できる状態にある
3. **必要な権限がそのまま表示されてしまう**：メニューをクリックした先の
   各画面が403相当のエラーを受け取った際、`AdminsView.vue`
   （`adminUsers/{uid}.permissions に admins:manage が必要です`）・
   `AuditLogsView.vue`（`audit:read`）・`BadgesView.vue`（`badges:monitor`）・
   `OrganizationsView.vue`・`RoomsListView.vue`（`rooms:monitor`・
   `rooms:create`）・`UsersView.vue`（`users:monitor`）のいずれも、
   Firestoreのフィールドパスと必要な権限文字列をそのままエラーメッセージに
   埋め込んで表示している。開発者向けのデバッグ情報としては親切だが、
   権限を持たない任意のログイン者に対しても同じ文言が出るため、
   内部の権限体系（権限名の一覧・Firestoreスキーマ）が事実上外部から
   探索可能になっている（`RoomDetailView.vue`・`UserDetailView.vue`のみ
   「管理者権限がありません。」という汎用メッセージで、この2画面は
   該当しない）

**性質の整理**：これは論点5が当初想定していた「UXとしての一貫性（他クライアント
はRoom内roleで表示を絞っているのに対しadmin-dashboardは絞っていない）」の
問題に加えて、**未認証者への接続先情報の開示**と**権限を持たない認証済み
ユーザーへの内部権限体系の開示**という、情報の露出範囲に関わる論点が新たに
明確化したものとして扱う。実害の大きさ（例えば`rooms:monitor`権限を持たない
一般のGoogleアカウント保持者が実際にRoomデータ等へアクセスできるわけでは
なく、各APIエンドポイント自体は`requireAdmin`ミドルウェアで別途保護されて
いる）と、露出している情報の性質（インフラURL・権限体系という偵察向けの
情報）は区別して記録する。次アクション item3側にこの3点を反映し、単なる
「仕様判断待ち」から、具体的な改善候補（未ログイン時のURL非表示・
ログイン後の権限チェック追加・エラーメッセージの権限名/Firestoreパス
除去）を伴う項目へ更新する。

二十七訂: 2026-07-31（二十六訂で確認した3点のうち1点目「未ログイン時の
トークンサーバーURL表示」と同じ`AuthView.vue`内に、もう1つ同種の露出箇所が
あるとユーザーから指摘を受けた。実コードを直接確認したところ、指摘通り、
ログイン前の説明文に以下がそのまま記載されていることを確認した。

```
閲覧には Firestore の adminUsers/{uid}.permissions に
rooms:monitor が付与されたアカウントでのサインインが必要です
(dev-tools/grant-admin-permission.js で付与)。
```

これは二十六訂の3点目（権限を持たない**ログイン後**のユーザーに対する
エラーメッセージでの権限名・Firestoreパスの開示）と似た性質だが、
**認証すら不要**という点でより露出範囲が広い。加えて、必要な権限名
（`rooms:monitor`）・Firestoreスキーマだけでなく、**サイト管理者権限を
付与するための内部スクリプト名（`dev-tools/grant-admin-permission.js`）**
まで、サインインボタンを押す前の誰でも閲覧できる画面に記載されている。
このスクリプト名自体が外部から実行できるわけではないが、システムの内部
運用手順（権限付与の実施経路）を推測する材料になる点で、二十六訂の1点目・
3点目と合わせて「未ログイン時の画面が最も情報量が多い」状態になっている
ことが分かった。次アクション item3の対応候補(i)「未ログイン時のURL非表示」
に、この説明文の扱い（開発者向けオンボーディング文言として残すか、
削除するか、権限名・スクリプト名を伏せた一般的な文言に置き換えるか）も
含めて検討することとし、item3の記述を更新する。

二十八訂: 2026-07-31（item3の対応候補(iii)「ログイン後・各画面表示前の
権限チェック追加」を実施した場合、最初のサイト管理者に権限を付与する動線が
無くなるのではないかとユーザーから懸念が示され、「`dev-tools`で対応できる
はず」との見立てについて確認を求められた。`dev-tools/grant-admin-
permission.js`の実コードを読み、見立て通りであることを確認した。

**確認できた内容：**

- このスクリプトはNode.jsのローカルCLIとして動作し、`firebase-admin`
  （Admin SDK）を`GOOGLE_APPLICATION_CREDENTIALS`（Firestoreへの書き込み
  権限を持つサービスアカウントJSON）で初期化して`adminUsers/{uid}`
  ドキュメントへ直接`grant`/`revoke`/`list`する。**admin-dashboard(Webアプリ)
  のGoogleサインインフローや`adminUsers/{uid}.permissions`のチェックを
  一切経由しない**、完全に独立した経路であることをコード冒頭のコメント・
  実装の両方で確認した
- コメントには「誰が新しい管理者を任命できるかを安全に(再帰的に)守る仕組みを
  きちんと作るまでの間、Firestoreへの書き込み権限を持つ運用者がローカルから
  Admin SDKで直接操作する運用にする」と明記されており、まさに「最初の
  管理者をどう任命するか」という鶏卵問題に対する、意図的な回避策として
  設計されていることが分かる。十三訂の「Room作成と組織階層の紐付け」・
  二十四訂の「最初の団体管理者の代理登録」でも同種の鶏卵問題が繰り返し
  出てきているが、サイト管理者権限については、この`dev-tools`スクリプトが
  最初から解決策として用意されていた
- したがって、item3の対応候補(iii)（ログイン後・各画面表示前の権限チェック
  追加）を実施しても、最初のサイト管理者への権限付与手段は失われない。
  admin-dashboard側のUI・APIを経由しない、サービスアカウント権限を持つ
  運用者による直接操作が引き続き機能するため、(iii)の実施を妨げる要因には
  ならないと判断する
- **運用上の注意点（1点）**：このスクリプトは対象`uid`を引数で指定する必要が
  あり、`uid`はFirebase Authにユーザーとして存在している（＝一度はGoogleで
  サインインしたことがある）ことが前提になる。そのため実際の付与手順は
  「(1) 最初のサイト管理者候補がGoogleでサインインする（この時点では権限が
  無くメニューは見えない状態でよい） → (2) サービスアカウントへのアクセス
  権を持つ運用者が、Firebase Authコンソール等で対象者のuidを確認し、
  `grant-admin-permission.js grant <uid> rooms:monitor`等を実行する」という
  2段階になる。これは(iii)の実施可否とは無関係の、既存の運用手順の確認に
  過ぎない

以上により、item3の対応候補(iii)は当初の懸念だった「最初の管理者を誰も
任命できなくなる」というブロッカーには当たらないことが確定した。item3の
記述を更新し、この確認結果を反映する。

二十九訂: 2026-07-31（二十八訂の「①候補者が一度サインインする」という
手順について、これを残す限り任意のGoogleアカウントでサインイン自体はできて
しまうのではないか、との指摘を受けた。**その通りであることを確認した。**
`stores/auth.ts`の`signInWithGoogle()`は素の`new GoogleAuthProvider()`を
使っており、Google Workspaceドメイン制限(`setCustomParameters({ hd: ... })`)
等は設定されていない。またリポジトリ全体を確認したが、Firebase Authの
blocking function(`beforeSignIn`等、Identity Platform機能)を実装する
`functions/`ディレクトリ自体が存在しない。つまり候補(iii)を実施しても、
「サインインという行為自体」は依然として任意のGoogleアカウント保持者に
対して開いたままになる。

**論点を2層に分けて整理する：**

1. **サインイン後に何が見える/できるか**（＝二十六訂・二十七訂で洗い出した
   問題そのもの）：候補(iii)＋(iv)（権限チェック追加＋エラーメッセージから
   権限名/Firestoreパス除去）を実施すれば、権限を持たない状態でサインイン
   した場合に見えるのは汎用的な「権限がありません」メッセージのみになり、
   実質的な情報漏洩・機能アクセスは無くなる。これは一般的な「認証
   (Authentication)と認可(Authorization)は別レイヤー」という設計であり、
   サインインの成立自体がRoom データ等への到達可能性を意味しない
   （各APIは`requireAdmin`ミドルウェアで別途保護されている点は二十六訂で
   確認済み）
2. **サインインという行為自体を、権限を持たない相手に対して閉じるか**：
   これは(iii)(iv)の範囲を超える、別の設計判断になる。実現するには
   以下のいずれかが必要で、いずれも今回の候補(i)〜(iv)より大きな変更を伴う。
   - **Google Workspaceドメイン制限**：`GoogleAuthProvider`に
     `setCustomParameters({ hd: '対象ドメイン' })`を設定する。実装は小さいが、
     サイト管理者全員が単一のWorkspaceドメインのアカウントを持つ運用である
     ことが前提になる（個人のGmailアドレスを使う管理者がいる場合は使えない）
   - **Firebase Authのblocking function**：サインイン試行時にサーバー側で
     許可判定するCloud Functionを追加し、`adminUsers`や別途用意する
     許可リストに無いアカウントのサインイン自体を拒否する。任意のメール
     ドメインに対応できる一方、**このプロジェクトには現状Cloud Functions
     の運用実績が無く**（`functions/`ディレクトリ自体が存在せず、
     token-serverは通常のNode/Expressサーバーとして別ホスティングされている
     ことを`firebase.json`で確認済み）、新しいデプロイ・監視対象を追加する
     ことになる。加えて、blocking functionの許可判定に`adminUsers`
     コレクションをそのまま使うと、二十八訂で確認した「最初の管理者は
     `adminUsers`に entryが無い状態からdev-toolsで付与される」という
     ブートストラップ手順と再び鶏卵問題を起こすため、判定用の許可リストを
     `adminUsers`とは別に用意する（例: 環境変数の許可メールアドレス一覧）
     等の追加設計が必要になる

**結論として記録する：** 候補(iii)(iv)は「二十六訂・二十七訂で確認した
情報漏洩・機能アクセスの問題」を解消するには十分だが、「無関係な
Googleアカウント保持者がそもそもサインインできてしまうこと」自体は
別の、より大きな論点として残る。後者への対応要否（ドメイン制限で足りるか、
blocking functionまで必要か）は、次アクションitem3の対応方針決定時に
あわせて判断することとし、item3の記述に追記する。

三十訂: 2026-07-31（二十九訂で候補(vi)の課題とした「blocking functionの
許可判定用リストを`adminUsers`とは別に用意する必要があり、そのリスト自体の
ブートストラップ(誰が最初のエントリを作るか)がまた鶏卵問題になる」という
点について、「最初の1回だけなら`dev-tools`で手動対応すればよいのでは」との
提案を受けた。**この提案は成立する**、と判断した理由を記録する。

- Firebase Authのblocking function（`beforeCreate`。初回サインイン時に
  Authアカウントの作成自体を許可/拒否する）は、判定時点で`uid`だけでなく
  `email`もイベントのコンテキストから参照できる。つまり許可リストは
  `uid`ではなく**`email`をキーにした小さなコレクション**（例:
  `adminInvites/{email}`）として持てば、対象者がまだ一度もサインイン
  していない段階でも事前に登録できる
- このコレクションへの書き込みは、既存の`dev-tools/grant-admin-permission.js`
  と同じ立て付け（Admin SDK・サービスアカウント認証によるローカルCLI）で
  行えるため、**新しい仕組みを作るというより、既存スクリプトに小さな
  サブコマンドを1つ足す程度の変更で済む**。「最初の管理者」に限らず、
  以後新しい管理者を追加するたび（＝そもそも稀にしか起きない、高信頼な
  操作）に同じ手順（許可リストへメール追加 → 本人がサインイン →
  `adminUsers`へ権限付与）を踏む運用で一貫する。「最初の1回だけ特別対応」
  ではなく「毎回同じ手順」になる点はむしろ運用としての一貫性が保てて良い
- なお、この`adminInvites/{email}`的な「メールアドレスで事前招待し、本人の
  初回サインインを起点に本登録が完結する」というパターン自体は、
  `phase11-org-roster-design.md`「6.2」が説明する一般警備士の名簿登録動線
  （団体管理者が警備士のメールアドレス宛に名簿エントリを作成し、本人が
  Memberとしてサインアップした時点で紐づく）と同型である。ロースター層の
  設計時に一度検討したパターンを、サイト管理者のサインインゲートにも
  転用できる形になっている
- 以上により、候補(vi)（blocking function）の実施可否を検討する際の
  「許可リストのブートストラップ」という懸念点は解消し、候補(vi)自体の
  評価は「Cloud Functionsという新しい運用対象を追加するコストに見合うか」
  という、より単純な論点に絞り込まれた。item3の記述を更新する。

三十一訂: 2026-07-31（「核となるユーザー（最初の管理者）の登録さえ済めば、
あとはadmin-dashboardで対応できるはず」という見立てについて確認を求められた。
実コードを確認したところ、**おおむねその通りだが、1点だけ恒久的な例外が
ある**ことが分かった。

- `token-server/routes/admin.js`の`POST /admin/admins/:uid/permissions`
  （`admins:manage`権限で保護）は、`rooms:monitor`・`rooms:create`・
  `badges:manage`・`users:monitor`・`organizations:manage`・`audit:read`等、
  ほぼ全ての権限の付与/剥奪をadmin-dashboard（`AdminsView.vue`）経由で
  行えるようにしている。つまり`admins:manage`を持つ最初の1人さえ存在すれば、
  それ以降の一般的な権限管理（新しい担当者へのRoom閲覧権限付与、団体管理者
  権限の付与など）は、この1人がadmin-dashboardから他の担当者へ委譲していく
  形で完結し、`dev-tools`を都度使う必要はない
- **ただし例外が1つある**：`permission === 'admins:manage'`の場合だけは
  このAPIが明示的に403を返し、「`admins:manage`の付与/剥奪はこのAPIでは
  行えません(`dev-tools/grant-admin-permission.js`を使用してください)」と
  拒否する実装になっている。`AdminsView.vue`側にも同じ制約が注記されている。
  つまり**「他の担当者に`admins:manage`そのものを新たに与える」操作だけは、
  最初の1回に限らず、恒久的に`dev-tools`（サービスアカウント経由の
  オフライン操作）でしか行えない**設計になっている
- コード上、この制約の理由は「自己昇格・権限エスカレーションを防ぐため」と
  明記されている。`admins:manage`保有者が増えるほど「誰が誰に何を許可したか」
  の管理責任が拡散するため、この一番上位の権限だけは意図的にWeb API・
  admin-dashboardの外に置き、サービスアカウントという別の認証境界を経由
  しないと変更できないようにしている、という設計判断だと解釈できる

**まとめると：** 「核となるユーザーの登録が済めば、あとはadmin-dashboardで
対応できる」という見立ては、`admins:manage`以外の権限管理については
正確である。一方、`admins:manage`自体の付与/剥奪だけは、最初の1回限りの
ブートストラップ作業ではなく、**この先ずっと`dev-tools`が必要であり続ける**
という点を区別して記録する。これは二十九訂・三十訂で検討したサインイン
ゲート自体の設計（候補(v)(vi)）とは独立した、既存の権限管理APIの仕様である。

三十二訂: 2026-07-31（item3（論点5）の候補(i)〜(iv)を実装した。アップロード
された`FirebaseRTC.zip`（HEAD=`544b853`）に対して行い、更新版ZIPとして
返却した。`tad-iizuka/FirebaseRTC`リポジトリへの実際のコミット・反映は
本ドキュメント作成時点では未確認のため、六訂・八訂等で踏んだのと同じ
確認プロセス（`git show`等によるリポジトリ反映の直接検証）を次アクション
として残す。候補(v)(vi)（サインインという行為自体を閉じるか）は今回の
スコープ外のまま。

**実装内容：**

- **(iii) `GET /admin/me`の新設**（`token-server/routes/admin.js`）：
  特定の管理者権限を要求せず、サインインしてさえいれば誰でも呼べる。
  `adminUsers/{uid}.permissions`（未作成の場合は空配列）をそのまま返す
  だけで、他人の権限体系は開示しない
- **(iii) admin-dashboard側のゲート追加**（`stores/auth.ts`・`App.vue`）：
  サインイン成功直後に`GET /admin/me`を呼び、`permissions`を
  `auth`ストアに保持する。`App.vue`は`auth.currentUser`の有無だけでなく
  `permissions.length === 0`もチェックし、権限が1つも無ければNavTabsを
  出さず「この管理画面を利用する権限がありません」という汎用画面を表示する
  ようにした。サインアウト時・別アカウントでの再サインイン時に古い権限が
  一瞬でも見えないよう、`onAuthStateChanged`側で`permissions`も明示的に
  クリアする
- **(ii) `AuthView.vue`の説明文を置き換え**：Firestoreパス・権限名
  (`rooms:monitor`)・内部スクリプト名(`dev-tools/grant-admin-permission.js`)
  を含む説明文を、「この管理画面の利用には、運営担当者からの権限付与が
  必要です。」という一般的な文言に置き換えた
- **(i) トークンサーバーURL欄を既定で折りたたみ**：`AuthView.vue`に
  `<details>`要素を追加し、「接続設定」を開かないと入力欄が見えないように
  した。機能自体（接続先切り替え）は維持しつつ、未サインインの訪問者が
  最初に目にする画面からは見えなくした
- **(iv) 6画面のエラーメッセージを汎用化**：`AdminsView.vue`・
  `AuditLogsView.vue`・`BadgesView.vue`・`OrganizationsView.vue`・
  `RoomsListView.vue`・`UsersView.vue`の「管理者権限がありません
  (adminUsers/{uid}.permissions に ○○ が必要です)」を、既に
  `RoomDetailView.vue`・`UserDetailView.vue`が使っていた「管理者権限が
  ありません。」に統一した。あわせて`RoomsListView.vue`のルーム作成フォーム
  近くにあった、Firestoreパスを含む補足説明文からもパス部分だけを除去した
  （こちらはrooms:monitor保有者向けの案内文であり完全な非公開対象ではない
  ため、権限名(`rooms:create`)自体は実用性のため残した）

**動作確認：** `vue-tsc -b`（型チェック）・`eslint .`・`vite build`
（本番ビルド）のいずれもエラーなく完走することを確認した。実際の画面
表示・サインインフローのブラウザ上での目視確認は行っていない（次アクション
として残す）。

**意図的にスコープ外としたもの：**

- 候補(v)(vi)（サインインという行為自体を閉じる）：二十九訂・三十訂で
  検討した通り、対応するかどうか自体が別の意思決定であるため、今回は
  実装対象に含めていない
- `dev-tools/grant-admin-permission.js`・`admins:manage`の運用（三十一訂
  で確認した恒久的な例外）は変更していない

---

三十三訂: 2026-08-01（「6. 次アクションの提案」item 5「組織ロースター層の
実装着手」に着手した。二十四訂で確定した設計（`phase11-org-roster-design.md`
案C、再帰的スコープモデル）をそのままバックエンド・フロントエンド双方に
実装した。ユーザーからアップロードされた`FirebaseRTC.zip`に対して行い、
更新版ZIPとして返却した。リポジトリへの実際のコミット・反映は本ドキュメント
作成時点では未確認のため、他の訂と同様に次アクションとして残す。）

**実装内容（バックエンド）：**

- **`token-server/lib/orgRoster.js`（新規）**：権限判定を一元化する
  `resolveRosterAccess(uid, orgId, targetScopeNodeIds)`。root
  （`adminUsers/{uid}.permissions`に`organizations:manage`）・団体全体admin
  （`scopeNodeIds`未指定/空）・scope限定admin（既存の`ancestorIds`を流用した
  祖先判定）の3種を判定し、`{ allowed, actorType, actorScopeNodeId,
  isOverride }`を返す。`isOverride`は「actorが当該orgのadmin名簿に
  登録されているか」だけで機械的に決まる、という二十四訂の定義通りに実装した
- **`token-server/routes/organizations.js`**：
  `GET/POST/PATCH/DELETE /admin/organizations/:orgId/members(/:targetUid)`
  を追加。POST（新規登録）とPATCH（役割/scope変更）を分離し、
  PATCHは変更前・変更後の両方のscopeをactorがカバーしていることを要求する
  （自分の権限が及ばないscopeへの書き換えを防止）。POSTは対象uidが
  Firebase Authに存在する（先にMember登録済みの）ことを確認してから
  書き込む。scopeNodeIdsは対象orgId配下に実在するnodeであることも検証する
- **最初の団体管理者の代理登録（鶏卵問題）**：専用の代理登録APIは作らず、
  `resolveRosterAccess`が「root OR 対象orgの既存admin」という判定式である
  ことをそのまま利用した。まだ誰も管理者登録されていない団体でも、
  rootであれば`POST .../members/:targetUid`をそのまま呼べる
- **`GET /admin/me`の拡張**：レスポンスに`managedOrgIds`（自分が
  `orgRole: 'admin'`として登録されている団体のorgId一覧）を追加。
  `organizations/{orgId}/members/{uid}`に非正規化した`uid`フィールドを
  持たせ、`collectionGroup('members')`クエリで絞り込む
  （`rooms/{roomId}/members`と同名コレクションだが、`orgRole`フィールドの
  有無で自然に区別される）
- **`firestore.rules`・`firestore.indexes.json`**：`members`
  サブコレクションのクライアント直接アクセス拒否、上記collectionGroup
  クエリ用の複合インデックスを追加
- **監査ログ**：`org:member_grant`/`org:member_revoke`/`org:member_view`/
  `org:member_edit`を追加。`detail`に`orgId`・`targetNodeId`・
  `actorType`・`actorScopeNodeId`・`isOverride`を格納する
- 通知要否設定フィールド（organizations/{orgId}側）は、二十四訂で
  「当面はログのみ・即時通知はPhase14待ち」と合意済みのため、今回は
  何も実装していない（フィールド自体を追加していない）

**実装内容（フロントエンド、admin-dashboard）：**

- **`stores/adminOrganizations.ts`**：`membersByOrgId`・
  `fetchMembers`/`grantMember`/`editMember`/`revokeMember`を追加
- **`stores/auth.ts`・`App.vue`**：`GET /admin/me`の`managedOrgIds`を
  保持するようにし、`App.vue`のNavTabs表示ゲート条件に
  `managedOrgIds.length === 0`も追加した（サイト全体の`adminUsers`権限を
  1つも持たない、団体スコープのみのadminが締め出されないようにするため）
- **`views/OrganizationsView.vue`**：選択中の団体の詳細ペインに「名簿
  （所属）」セクションを追加。一覧表示・新規登録フォーム（uid/role/
  scopeNodeIds、複数node選択のmultiple select）・行ごとのインライン編集
  （role/scope変更）・除名ボタンを実装した
- **動作確認：** `vue-tsc -b`（型チェック）・`eslint .`・`vite build`
  （本番ビルド）のいずれもエラーなく完走することを確認した。
  権限判定ロジック（`resolveRosterAccess`）はFirestoreをモックした
  簡易テストで、root/団体全体admin/scope限定adminの許可・祖先nodeへの
  操作拒否・兄弟nodeへの操作拒否・団体全体scopeの付与拒否（scope限定admin
  からの）が設計通りに判定されることを確認した。実際の画面表示・
  エミュレータ/本番Firestoreに対する実機動作確認は行っていない
  （次アクションとして残す）

**意図的にスコープ外・未完了として残したもの：**

- **scope限定admin自身によるadmin-dashboardでの団体選択**：
  `OrganizationsView.vue`の左ペイン（団体一覧）は`GET /admin/organizations`
  （`organizations:monitor`権限が必要）に依存しており、サイト全体権限を
  持たない団体スコープのみのadminは、自分が管理する団体をこの一覧から
  選べない。`managedOrgIds`をもとに個別の団体を取得する手段（例:
  `GET /admin/organizations/:orgId`単体取得エンドポイント）が未整備なため、
  現状ではroot・`organizations:monitor`保有者のみがこの名簿UIを実際に使える。
  次アクションとして残す
- `brushup-plan.md`本体・`DATA_MODEL.md`・`API.md`への反映は今回のドキュメント
  更新に含めた（`phase11-org-roster-design.md`自体の更新は不要、二十四訂で
  既に確定済みのため）
- staffの「今どのSiteに配置されているか」といった、名簿を使った横断的な
  ビュー機能（phase11-org-roster-design.md 6.2で触れられている将来機能）は
  未着手。今回はデータモデルとCRUD APIの土台のみ

三十四訂: 2026-08-02（三十三訂で実装した組織ロースター層バックエンドについて、
ユーザーがtoken-serverをローカルで起動し、新規スクリプト`dev-tools/
test-roster.sh`（実Firebase ID Token・実行中サーバーに対するcurl+jqの
統合テスト、コミット`39d2906`）を用いてHTTPレベルの動作確認を行い、
全14ステップPASS（FAIL=0）という結果を得た。

**確認内容（テスト結果を、リポジトリ本体のソースコードと直接突き合わせて検証）：**

- ステップ1-2（団体・node階層作成／鶏卵問題）: root（`organizations:manage`
  保持者）による最初の団体管理者(UID_A)の代理登録と、`GET /admin/me`の
  `managedOrgIds`への反映 → `lib/orgRoster.js`の`resolveRosterAccess()`
  （「root OR 対象orgの既存admin」の判定式）通りであることをコードで確認
- ステップ3-4（override規約）: 団体全体admin(UID_A)によるscope限定
  admin(UID_B)の付与、UID_Bによる子node(△△現場)へのstaff付与（成功）・
  自スコープを団体全体へ拡大しようとする操作(403)・兄弟node(大阪支社)への
  付与(403)、UID_Aによるスコープ縮小(200) → `actorScopeCovers()`の
  override規約（広いscopeのadminが狭いscopeをoverride可能、逆は不可）通り
  であることをコードで確認
- ステップ5（名簿閲覧・単体取得APIの権限）: UID_Bが名簿一覧を閲覧できる
  一方、`organizations:monitor`を持たないため全団体一覧
  `GET /admin/organizations`は403、しかし単体取得
  `GET /admin/organizations/:orgId`・node一覧
  `GET /admin/organizations/:orgId/nodes`はいずれも成功（テストのコメントに
  「2026-08-02対応」と明記）。**これは三十三訂で「意図的にスコープ外・
  未完了」としていた「scope限定admin自身によるadmin-dashboardでの団体選択」
  に対応するものであり、`git log`で確認したところ、テスト実施と同日の
  コミット群（`c6c173e`〜`2713a6c`、いずれも`git status`で
  `origin/main`と一致していることを確認済み）で追加実装されていた**:
  `routes/organizations.js`に新設した`canReadOrg()`（サイト全体の
  閲覧権限 OR `resolveRosterAccess`の許可、のOR条件）へ単体取得・node一覧
  エンドポイントの権限チェックを`organizations:monitor`固定から差し替え、
  `admin-dashboard`側も`stores/adminOrganizations.ts`に
  `fetchOrganizationById`/`fetchManagedOrganizations`を新設し、
  `OrganizationsView.vue`が一覧403時に`managedOrgIds`経由の個別取得で
  フォールバック表示するよう変更されていた。三十三訂時点の残課題のうち
  この項目は解消済みと判断する
- ステップ6-7（無関係uidの拒否／除名）: 権限を持たないTOKEN_Cによる編集が
  403になること、UID_Aによる除名(revoke)が成功し、除名後の再除名が404に
  なること

**（重要な留保）** 今回のテスト実行そのもの（14 PASSという結果）は
ユーザーの手元での実行報告であり、本ドキュメント側でターミナルを直接実行して
確認したものではない（十一訂・十七訂と同種の限界）。ただし今回はそれに加え、
テストが検証しようとしている権限判定ロジック
（`resolveRosterAccess`・`actorScopeCovers`・`canReadOrg`）をリポジトリ
本体から直接読み、テストの各アサーションと実装が一致していることを
確認している。これは六訂・八訂で行った`git show`によるコミット内容の
直接検証と同種の確認であり、三十三訂で「Firestoreをモックした簡易テストの
みで確認」としていたバックエンドの権限判定ロジックについて、実際の
HTTPエンドポイント・Firestore・Firebase Authに対する統合テストで裏付けが
取れたことになる。一方、admin-dashboardの画面をブラウザで実際に操作しての
確認（三十三訂で「実機動作確認は行っていない」としていたうちUI側）は
今回のテスト範囲外であり、引き続き未確認のまま残る。

以上を踏まえ、「6. 次アクションの提案」item5「組織ロースター層の実装着手」の
残課題のうち、①「scope限定adminによるadmin-dashboardでの団体選択」と
②「リポジトリへの実際のコミット・反映の確認」は完了扱いとし、
「実機動作確認」は**バックエンドAPI(HTTPレベルの統合テスト)分のみ完了**と
更新する。admin-dashboardのブラウザでの実機確認は完了しておらず、
次アクションとして残す）

三十五訂: 2026-08-02（三十四訂で残っていた「admin-dashboardのブラウザでの
実機動作確認」に着手し、`GET /admin/me`のcollectionGroupクエリ・
`managedOrgIds`ゲート自体は設計通り機能していることを確認した一方、
別のUI課題を1件発見・修正した。

**発見の経緯：** scope限定admin（`organizations/{orgId}/members/{uid}`に
`orgRole: 'admin'`、`scopeNodeIds`指定あり）のuidでサインインして権限
ゲートを確認する過程で、無関係アカウントでの「権限がありません」表示と、
scope限定adminとしての正常なアクセスの両方を実際のブラウザ操作
（DevTools Networkタブでの`GET /admin/me`レスポンス確認込み）で再現した。
その過程で、`GET /admin/me`が正しく機能していることとは別に、
「組織」タブ以外の個別画面（`ルーム`・`バッジ`・`ユーザー`・`監査ログ`・
`管理者権限`）でAPIが403を返すケースで、エラーメッセージの下に
検索フォーム・新規作成フォーム・フィルタ入力欄が表示されたまま残る
UI上の違和感をユーザーから指摘された。

**原因：** `AdminsView.vue`・`AuditLogsView.vue`・`BadgesView.vue`・
`RoomsListView.vue`・`UsersView.vue`の5画面はいずれも、対応する
Piniaストア（`adminUsers`/`adminAuditLogs`/`adminBadges`/`adminRooms`/
`userDirectory`）が持つ`isForbidden`フラグを、表示するエラー文言の出し
分けにしか使っておらず、その下のフォーム・テーブルは`isForbidden`の値に
関わらず常時レンダリングされていた。一方`RoomDetailView.vue`・
`UserDetailView.vue`は元々`v-if="rooms.detail"`/`v-if="store.profile"`で
画面全体を囲う実装になっており、403時はデータが存在しないためフォームも
自然に非表示になる設計だった。5画面はこのパターンに揃っていなかった。

**対応：** 上記5画面それぞれで、`isForbidden`がtrueの場合は
「管理者権限がありません。」の1行のみを表示し、それ以外の説明文・
フィルタ/検索フォーム・テーブル・新規作成フォームは`<template v-else>`で
まとめて非表示にするよう変更した。`OrganizationsView.vue`は
`orgs.isForbidden && orgs.organizations.length === 0`という、scope限定
adminの部分アクセスを意図的に残す既存の分岐であり、対象外とした。

**（重要な留保）** 今回の修正はアップロードされたZIPアーカイブ内の
ソースファイルに対して直接行ったものであり、この環境では`npm run build`
（`vue-tsc`）やブラウザでの目視確認を実行できないため、型エラーや
レンダリング崩れがないことの機械的な検証はできていない。div/templateタグの
対応関係を簡易スクリプトで確認したのみ。ユーザー側での`npm run build`と
ブラウザでの目視確認、およびリポジトリへの反映を次アクションとして残す。

これにより、admin-dashboardのブラウザでの実機動作確認（三十四訂で残って
いた項目）は、権限ゲート自体の動作確認に加えて、UI上の1件の改善指摘・
修正まで進んだ。ただし「6. 次アクションの提案」item5の
「admin-dashboardのブラウザでの実機動作確認」自体は、名簿の付与/編集/
剥奪操作や`firestore.rules`/インデックスの本番デプロイ確認が残っている
ため、引き続き未完了として扱う）
三十六訂: 2026-08-02（ユーザーから、admin-dashboardのRoom詳細画面で
「権限がない場合、一瞬表示されてから入力フィールドが消える」という
新たなちらつき不具合の報告を受けた。三十五訂で5画面（ルーム一覧・バッジ・
ユーザー・監査ログ・管理者権限）の同種の不具合を修正した際、
`RoomDetailView.vue`自体は`v-if="rooms.detail"`で画面全体を囲っているため
対象外と判断していたが、その内側で入れ子になっている「組織」セクション
（Roomの組織階層への割り当てフォーム）に、三十五訂では見落としていた
同種のちらつきが1件残っていたことが判明した。

**原因：** `RoomDetailView.vue`の組織割り当てフォームは
`v-if="orgs.isForbidden" ... v-else ..."`という2値の出し分けのみで実装
されていた。`orgs.isForbidden`（`stores/adminOrganizations.ts`、初期値
`false`）は`GET /admin/organizations`の応答が返るまでfalseのままのため、
権限の有無に関わらず`v-else`側（団体/nodeの選択セレクトボックス・
「割り当てを保存」ボタン）が実際のフェッチ完了前に一度描画され、403応答が
返った時点で初めて非表示に切り替わっていた。三十五訂で確認した
`OrganizationsView.vue`・`AdminsView.vue`等、他の一覧系画面がいずれも
「`isLoading && list.length === 0`を最初の分岐に置き、ローディング中は
本体を出さない」という定番パターンを踏襲しているのに対し、この
組織セクションだけが同じ`orgs`ストアを使いながらこのパターンに揃って
いなかった。三十五訂の調査対象が「画面トップレベルのisForbidden」
だったため、画面内に入れ子になったセクション単位のisForbidden分岐までは
洗い出しの対象に入っていなかったことが、見落としの直接の原因と判断した。

**対応：** `orgs.isLoadingOrganizations && orgs.organizations.length === 0`
を判定する分岐を先頭に追加し、フェッチが完了するまでは「確認中...」を表示
してフォーム自体を描画しないよう修正した（他画面と同じパターンに揃えた）。
招待コード表示・メンバー台帳のバッジ列など、同画面内の他セクションは
同種の問題がないことをあわせて確認した。

- 変更ファイル: `admin-dashboard/src/views/RoomDetailView.vue`
  （組織セクションの条件分岐のみ。ストア側の変更は無し）
- **（重要な留保）** 三十五訂と同様、今回の修正もアップロードされた
  ZIPアーカイブ内のソースファイルに対して直接行ったものであり、この環境
  では`npm run build`（`vue-tsc`）やブラウザでの目視確認を実行できない。
  ユーザー側での`npm run build`とブラウザでの目視確認、および
  リポジトリへの反映を次アクションとして残す
- **（次アクションへの追加提案）** 今回・三十五訂とも「個別画面を1つずつ
  目視で洗い出す」形で発見されており、同種の入れ子セクションが他画面にも
  残っていないとは言い切れない。`grep -n "isForbidden" admin-dashboard/src`
  等による機械的な棚卸しを一度行っておくと、同種の見落としの再発を防げる
  可能性がある（優先度は低・次アクションに追加）)
三十七訂: 2026-08-02（ドキュメントの可読性改善と、三十六訂の追加検証を実施。
(1) 冒頭の改定履歴（初訂〜三十六訂）が文書全体の半分以上を占め読みにくく
なっていたため、`<details>`タグで折りたたみ、本文（「0. README.mdが定義する
ビジョンの要点」以降）と「6. 次アクションの提案」がすぐ読める構成に整理した
（内容自体の削除・書き換えは行っていない。過去の訂の記述はそのまま保持）。
併せて「6. 次アクションの提案」冒頭の、item番号の変遷を訂ごとに説明する長い
経緯段落も同様に折りたたみ、現在有効なアクション一覧だけが目に入るようにした。
(2) 三十六訂で「ビルド確認・目視確認・リポジトリへの反映のいずれも未実施」と
していた`RoomDetailView.vue`組織セクションのちらつき修正について、アップロード
されたリポジトリ一式の`.git`履歴を取得し検証した。`git show a8b05c6`により、
コミット`a8b05c6`（2026-08-02 16:53:35 +0900, "update"）として実際にリポジトリへ
反映済みであることを確認した。diffの内容（`orgs.isLoadingOrganizations`を
判定に加える変更）も三十六訂の記述と一致しており、六訂・八訂・十六訂・十九訂と
同じ`git show`による直接検証として扱う。ただしこの環境では`npm run build`
（`vue-tsc`）やブラウザでの目視確認までは実行できないため、その2点は
ユーザー側の確認事項として次アクションに残す。
(3) 「6.」item 6として残っていた「`isForbidden`系フラグの機械的な棚卸し」に
着手した。`grep -rn "isForbidden" admin-dashboard/src`で全箇所（ストア6件・
画面7件）を洗い出し、三十五訂・三十六訂で「修正済み」とした5画面
（RoomsListView・BadgesView・UsersView・AuditLogsView・AdminsView）＋
RoomDetailView組織セクションの計6箇所を実コードで再確認した。
`UserDetailView.vue`の`badgesStore.isForbidden`は編集フォーム自体の出し分けに
関与しない警告文のみであり、対象外と判断した。
**新たな発見（重要）**: 上記6箇所は、いずれも「`isForbidden`が確定するまでの
間コンテンツ本体を出さない」という三十五訂・三十六訂の修正自体は正しく効いて
いる。しかし`v-else`ブロックの先頭に置かれているページ見出し・入力フォーム
（RoomsListViewの「ルームを新規作成」欄、BadgesViewの「表示設定」欄、
AuditLogsView/UsersViewの絞込・検索欄など）は`isLoading`系フラグでガード
されておらず、`isForbidden`の初期値`false`のままフェッチが完了するまでの間、
これらのフォーム自体は描画されてしまう。三十五訂・三十六訂は「セクション全体が
`isForbidden`単独で出し分けられている」パターンを修正対象としており、
「`v-else`直下の一部要素だけが`isLoading`未ガードのまま残っている」という、
より細かい粒度の同種問題までは棚卸しの対象に含まれていなかったと判断する。
対象範囲が6画面のUI変更にまたがるため、今回は原因の特定までに留め、実装は
次アクション（下記item 6）へまわす）
三十八訂: 2026-08-02（「6. 次アクションの提案」item 6（`v-else`直下のフォーム類
への`isLoading`ガード追加）を実装した。三十七訂の棚卸しで実際に未ガードだった
のは`RoomsListView.vue`（「ルームを新規作成」欄）・`BadgesView.vue`（「表示設定」
欄・「バッジを新規作成」欄）・`AuditLogsView.vue`（絞込フォーム）・
`AdminsView.vue`（付与/剥奪フォーム）の4画面5箇所で、既存の
`isLoading && length === 0`という定番パターンをそれぞれのフォーム・見出し側にも
適用した。`RoomDetailView.vue`組織セクションは三十六訂で既に同じパターンが
適用済みであることをコードで再確認し、対象から除外した（三十七訂の「6箇所」
という書き方は棚卸し対象の数であり、未ガード箇所の数ではなかった点に注意）。

`UsersView.vue`（絞込・検索欄）は、他4画面と異なり`onMounted`での自動フェッチが
無く、`isForbidden`は検索ボタン押下まで`false`のまま変化しないため、現状では
実害のあるフラッシュ（ロード中に一瞬フォームが見えて消える現象）は発生しない
ことをコードで確認した。三十七訂の記述は「絞込・検索欄」の例としてこの画面を
挙げていたが、実装時の再検証で当てはまらないことが分かったため、この点は
訂正として記録する。ただし他5画面とパターンを揃えておく方が将来
（例えば初期表示時に直近の検索結果を自動取得するような変更が入った場合）の
再発を防げるため、同じ`isLoading && length === 0`ガードを予防的に追加した。

**（重要な留保）** 今回の変更はアップロードされたリポジトリ一式（`.git`履歴を
含む）に対して直接行ったものであり、この環境では`npm run build`（`vue-tsc`）・
ブラウザでの目視確認は実行できていない。5画面のdiv/templateタグの対応関係は
簡易スクリプトで機械的に確認済み。ユーザー側での`npm run build`・ブラウザでの
目視確認、およびリポジトリへの反映確認を次アクションとして残す）
三十九訂: 2026-08-03（アップロードされたリポジトリ一式（HEAD=`8b52861`）を
再取得し検証した。`git status`で`origin/main`と一致していることを確認した上で、
三十八訂が「この環境では未実行」としていた`npm run build`・Lintを、今回は
`admin-dashboard`に対して実際に`npm install`（478 packages、脆弱性起因ではない
deprecation警告のみ）→`npm run build`（`vue-tsc -b && vite build`）→`npm run
lint`（`eslint .`）の順で実行し、いずれもエラー0件で完走することを直接確認した。
これは六訂・八訂・十六訂・十九訂・二十三訂・三十七訂で踏んできた`git show`に
よる「コミット内容の直接検証」とは別の種類の確認（コンパイル・静的解析レベルの
実行確認）だが、同じく本ドキュメント側で再現可能な一次検証である点は変わらない。
あわせて`scripts/check-role-sync.js`の再実行（3クライアントとサーバーのrole
定義一致を確認）、および二十訂以降に新設された`token-server/lib/orgRoster.js`・
`lib/roomCreation.js`・`routes/users.js`の`node --check`による構文確認も行った。

**（今回判明した限界）** `vue-tsc`ビルドの成功は「型エラーが無いこと」「JSXの
条件分岐が構文的に破綻していないこと」を保証するが、三十八訂が本来確認したかった
「読み込み中はフォームが実際に非表示になり、ちらつきが解消されているか」という
**実行時の見た目**までは保証しない。この環境にはブラウザ実行環境が無いため、
item 6の「ブラウザでの目視確認」自体は本改定でも未解消のまま次アクションに残す。
同様の理由で、item 5（組織ロースター層）が残す「名簿の付与/編集/剥奪の実際の
画面操作」「Firestoreルール/インデックスの本番デプロイ確認」も、コードの静的
検証では代替できないためそのまま次アクションに残す。
item 6のうち「ビルド確認」の部分のみを解消済みとして「6.1」item 20へ移動する。

**（本改定の位置づけについて）** 本改定作業は、ユーザーから提示された
`brushup-plan.md`が二十訂（2026-07-26時点）相当の古いスナップショットだった
一方、アップロードされたリポジトリ本体には既に三十八訂（2026-08-02時点）まで
進んだ本ドキュメントが存在するという不整合の検出から始まった。二十訂を起点に
独自の改定を重ねることは、リポジトリ側で既に解決済み・方針転換済みの内容
（例: Guest役割バッジのバッジ付与UIをRoom詳細画面ではなくユーザー管理画面に
一本化する設計変更、「ユーザー×団体の所属関係」を非実装とした旧方針の撤回と
組織ロースター層としての実装）を古い前提のまま逆行させてしまうリスクがあるため、
ユーザーに確認の上、リポジトリ内の三十八訂を正としてそこから改定を継続する
方針とした）
四十訂: 2026-08-03（三十九訂で残っていたitem 5「組織ロースター層」の残課題
（名簿の付与/編集/剥奪の実画面操作確認・`firestore.rules`/インデックスの
本番デプロイ確認・admin-dashboardのブラウザ目視確認）、およびitem 6
「`isLoading`ガード」の残課題（ブラウザでの実際の目視確認・リポジトリへの
反映確認）について、ユーザーから「両方ともデプロイ・確認までおわっています」
との報告を受けた。**（重要な留保）** 六訂・八訂・十六訂・十九訂・二十三訂・
三十七訂で踏んできたような、リポジトリ本体を再取得し`git show`等で新規
コミットの内容を直接検証するプロセスは今回実施していない（本改定時点で
アップロードされたリポジトリのHEADは三十九訂時点から変化していないため、
検証対象となる新規コミット自体が本ドキュメント側にまだ存在しない）。
十一訂・十七訂・二十五訂で踏んだのと同じ「ユーザー申告のみに基づく完了」
として扱い、item 5・item 6をいずれも完了扱いとして「6.1」item 21・22へ
移動する。item 5の完了により、item 4（招待コードの可視範囲）が前提として
いた「組織ロースター層の`scopeNodeIds`実装」条件が満たされたため、item 4を
「着手可能」に更新する。次回、リポジトリ本体（`.git`履歴）を再取得できる
機会があれば、六訂・八訂等と同じ`git show`による直接検証を行うことが
望ましい）
四十一訂: 2026-08-03（次アクションitem 3「サインインゲート自体を閉じるか
（候補(v)(vi)）の要否判断」について、ユーザーから「対応しません」との
意思決定を得た。二十六訂〜三十一訂で洗い出した通り、候補(i)〜(iv)（三十二訂
で実装済み）は「サインイン後に何が見える/できるか」を狭める対応で既に
対応済みであり、候補(v)(vi)が対象とする「無関係なGoogleアカウント保持者が
そもそもサインインできてしまうこと」自体は実害（各APIは`requireAdmin`で
別途保護されており、サインインの成立自体はデータへの到達可能性を意味
しない）が小さいと判断されたため、Google Workspaceドメイン制限・Firebase
Authのblocking functionいずれも見送りとする。これにより意思決定待ちだった
item 3は「対応しない」という結論をもって決着したため、次アクションから
外し「6.1」item 23へ移動する。将来、管理者アカウントの運用ポリシーが
変わる（例: 単一ドメインへの統一、Cloud Functions基盤の導入）等の事情変化が
あれば再検討の余地があることを記録しておく）

</details>

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

この物差しに照らすと、現在の実装は **「Phase1（警備業）の土台にGuestロール・
組織階層・バッジ・添付ファイルまで加わったが、実機検証、通知、App Check、
業界ラベリング層は未完了」** という状態にある。なお
2026-07-25の実コード検証により、Communication Modelの`Text` Event
（テキストチャット）は3クライアント・サーバー双方で既に実装済みであることが
判明しており（詳細は「1. 実コード確認済みの現状」参照）、Phase1の要件外の
部分ではあるが着実に前進している。

## 1. 実コード確認済みの現状（README改定前の分析を上書き）

サーバー(token-server)はPhase 1〜13およびPhase16の基盤まで実装済み（認証・招待制ルーム・BAN・
送話ロック・録音Egress・Webhook・moderator任命API・監査ログ・管理者権限API・
GCS/FirestoreのTTL/ライフサイクル管理・**テキストチャットAPI**）。クライアント
3種(Web/iOS/Android)もBAN・送話ロック・オンボーディング・i18n・
デザイントークン統一・**テキストチャットUI**、参加者一覧のバッジ表示まで実装済みで、
管理者サイトもVue 3の本格SPA(`admin-dashboard/`)へ刷新済み。**（2026-07-28
十六訂）** Phase16の添付送受信UIも、Web版に続きiOS/Android双方に実装が
完了した（画像/動画/PDFの選択・送信前プレビュー・署名付きURL経由の直接
アップロード・添付付きメッセージ表示まで3クライアント共通）。**（2026-07-28
十七訂）** 添付用GCSバケット・CORS・サービスアカウント等の本番運用設定も、
本番環境での実アップロード動作確認（ユーザー確認済み）をもって完了とした。
Phase16はクライアント実装・本番運用設定の両面で完了している。

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
が定義する3つの原則のうち、①Permission ModelのGuestロールと③Company/Branch/Site等の
組織階層は実装済みである。②業界ごとに名称だけ差し替えるラベリング層は、Phase2の
具体要件が確定してから設計する方針で未着手のままである。

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
| **テキストチャット(Text Event)** | ✅ | ✅ | ✅ | `token-server/routes/messages.js`(Phase5)＋3クライアント |
| **画像・動画・PDF添付(Image/File Event)** | ✅ | ✅ | ✅ | Phase16。2026-07-28、Web版の設計(署名付きURL経由の直接アップロード・サムネイル表示)をiOS/Androidへ移植し完了（十六訂）。添付用GCSの本番運用設定も本番アップロード動作確認をもって完了（十七訂） |
| バックグラウンド動作(送受信) | - | ✅実機検証済み(2026-07-31、二十五訂) | ✅実機検証済み(2026-07-31、二十五訂) | 2026-07-27、十四訂で実装。iOSは2026-07-30、二十訂で実機確認したが原因調査の結果、未記載だったCallKit統合が前面化の原因と判明し二十一訂で撤回(HFP系headsetボタンは無反応化)。撤回のリポジトリ反映は二十三訂で`git show`確認済み。常駐通知の頻発は二十三訂で確認したコミット`c8d05cf`で解消済み(Now Playingウィジェットへ一本化)。撤回版のビルド確認・iOS/Android双方の実機検証・長時間バックグラウンド接続維持は二十五訂でユーザー申告に基づき完了扱い（AVRCP系ヘッドセットはトグル非対応と判明、既知の制約として記録） |
| **Guestロール** | ✅ | ✅ | ✅ | 2026-07-25 実装完了。`token-server`のrole自動判定(匿名認証)・3クライアントのGuest導線・ニックネーム変更UI・Guestバッジ(自分自身のみ)まで対応。他参加者のGuest判定は別途検討（5.4参照） |
| **業界別ラベリング(UIのみ差し替え)** | ❌ | ❌ | ❌ | 「警備業向け」の文言・概念が全画面にハードコード |
| **組織階層(Company/Branch/Site)** | 参照APIのみ | 参照APIのみ | 参照APIのみ | Phase11。管理画面で団体・再帰node・Room割当を管理。各ユーザー向けUIのパンくず表示は未実装 |
| **参加者一覧のバッジ表示** | ✅ | ✅ | ✅ | Phase13。Room APIを20秒間隔でポーリングし最優先1件を表示 |

管理者サイトは`admin-dashboard/`(Vue 3+TS+Pinia)としてルーム一覧/詳細・
監査ログ・管理者権限・録音履歴DLまで実装済み。閲覧専用だった旧
`dev-tools/admin-dashboard.html`とは別物として本番投入可能な水準にある。

---

## 2. README.mdのビジョンに照らした課題整理

### A. Permission Model：Guestロール → 実装完了、権限の一元化が残課題

README.mdが定義する`Owner → Moderator → Member → Guest`の4段階は、
`token-server/routes/rooms.js`と3クライアントに実装済みである。匿名認証の
参加者はサーバーが`guest`として判定し、ニックネーム変更と送話は許可する一方、
BAN・役割変更・録音などの管理操作は拒否する。

残課題は、各ルート・各クライアントに分散したrole判定を、Phase12の
role×操作対応表に基づき一元化することである。

### B. 業界ごとのUIラベリング層が未着手

README.mdは「実装は業界に依存させない。業界ごとの名称はUIだけ変更する」と
明言しているが、現状の3クライアントは"警備業"を想定した文言・概念
（ルーム、招待コード等）が直接ハードコードされており、Phase2(イベント運営・
展示会・自治体等)向けに名称を差し替える仕組みが存在しない。

- i18n基盤(すでにja/en等で導入済み)を「言語」だけでなく「業種プロファイル」
  の文言差し替えにも転用できるよう、キー設計を拡張するのが現実的な入り口
- 例: `role.owner`を業種設定に応じて「現場責任者」「イベント主催者」等に
  出し分けるレイヤーを追加

### C. Long-Term Architecture：組織階層 → 管理基盤は実装完了

Phase11で、`organizations/{orgId}`と任意深さの`nodes`により、警備業の
`Company → Branch → Site → Room`と一般の`Community → Group → Room`を
同じデータモデルで表現できるようにした。Roomは無所属のままでもよく、必要な
場合だけ管理画面から団体・nodeへ割り当てる。

管理画面には団体/nodeの管理、Roomの割り当て、一覧の階層フィルターがある。
ユーザー向けクライアント側では`GET /rooms/:roomId/org-context`を利用できるが、
パンくず等の表示はまだ実装していない。

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
- ~~バックグラウンド動作: iOSは設定のみで実機未検証、Androidは
  ForegroundService自体が未実装。警備現場で「アプリを閉じたら送受話が
  切れる」のはPhase1の要件と矛盾する~~
  **（2026-07-27 十四訂）** iOS/Androidとも実装済み。Androidは
  `PTTForegroundService`新設によりバックグラウンドでも接続・送受話を
  維持し、常駐通知の送話トグルアクション・MediaSession経由の
  ヘッドセットボタンに対応。iOSは`PTTBackgroundControlManager`新設により
  `MPRemoteCommandCenter`(ロック画面/コントロールセンター/ヘッドセット
  ボタン)・`UNUserNotificationCenter`(バックグラウンド中の常駐通知)経由の
  送話操作に対応。ただしビルド確認・実機検証は未実施（詳細は文書冒頭の
  十四訂・留保事項を参照）。次アクションとして実機検証を残す。
- **（2026-07-31、二十三訂で発見）音質・低遅延に関わる別の未記載バグ修正**：
  `git show`でコミット`544b853`（現HEAD）を確認したところ、「PTTボタンを
  押すまでWeb→iOS方向の音声が一切聞こえず、押した瞬間に溜まっていた音声が
  再生される」という、本ドキュメントのどの改定にも記載のなかった症状の
  修正が`PTTConnectionManager.swift`に加えられていた。原因はLiveKitの
  音声エンジン(ADM)がRoom接続時点では起動しておらず、ローカルのマイク
  入力開始時に初めて起動する実装だったためで、Room接続直後に
  `AudioManager.shared.startLocalRecording()`を呼んで事前起動する
  「ウォームアップ」方式で対応していた。コード内コメントには複数の
  診断ログ追加も含まれており、実機での症状解消自体はリポジトリの情報
  だけでは確認できないため、次アクションとして実機検証を残す
  （詳細は文書冒頭の二十三訂参照）。
  ✅ **実機検証完了（2026-07-31、二十五訂）**: ユーザーから、症状が
  解消していることを確認したとの報告を受けた（申告のみ、一次証跡なし）。
  Android側でも同種の問題は発生していないとの報告を受けた。
- **（2026-07-31、二十五訂で判明）AVRCP系Bluetoothヘッドセットは物理ボタンで
  のPTT操作に対応できない（既知の制約）**：二十一訂でCallKit統合を撤回した
  際、HFP系ヘッドセットのボタンが`MPRemoteCommandCenter`経由では反応しなく
  なることは想定済みだったが、実機検証の結果、AVRCP系ヘッドセットについても
  同様にトグル動作しないことが確認された。不具合ではなく、選択した実装方式
  （B. `MPRemoteCommandCenter`のみ）が対応する入力経路の範囲に関する仕様上
  の制約として扱う。特定のBluetoothヘッドセット機種で物理ボタンからのPTT
  操作が必須要件になる場合は、CallKitの着信偽装方式（二十一訂で検討した
  選択肢C、当時は着信音・着信UIの懸念から未検証のまま見送り）の再検討が
  必要になる。

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
- ~~iOS: バックグラウンド動作の実機検証・本実装~~
  ~~Android: ForegroundServiceの実装~~
  ✅ **実装完了（2026-07-27、十四訂）**: 送受信両方（通知・ロック画面・
  ヘッドセットボタンからの送話操作を含む）に対応する形でiOS/Androidとも
  実装した。Androidは`PTTForegroundService`(新設)がバックグラウンドでの
  接続維持を担い、iOSは`PTTBackgroundControlManager`(新設)が
  `MPRemoteCommandCenter`/`UNUserNotificationCenter`経由の送話操作を
  仲介する。詳細は「2-D」参照。
  ✅ **iOS実機確認（2026-07-30、二十訂）**: ユーザーの実機（iPhone）で
  (a)バックグラウンド遷移・状態変化時の常駐通知表示、(b)ハンドセット
  物理ボタンでの送話開始とフォアグラウンド復帰、(c)フォアグラウンド↔
  バックグラウンドを往復しても通話が継続すること、の3点をスクリーンショット
  付きで確認した。
  🔧 **原因調査・設計変更（2026-07-30、二十一訂）**: (b)の前面化の原因を
  調査した結果、十四訂の記載にはなかった`PTTCallKitManager.swift`
  （CallKit統合、Elecom LBT-HS11等HFP系Bluetoothヘッドセットのボタン対応）が
  実コードに存在し、これがApple仕様上の自動前面化を引き起こしていたと判明。
  「バックグラウンド中に勝手に前面化するのはバッテリー消費の観点で許容できない」
  というユーザー方針により、**CallKit統合を撤回した**（`PTTCallKitManager.swift`
  削除、`ContentView.swift`/`ptt_iosApp.swift`/`PTTConnectionManager.swift`/
  `Info.plist`を連動修正）。この結果、画面のPTTボタン(hold-to-talk)は従来通り、
  Bluetoothヘッドセットのマイクルーティングも維持されるが、**HFP系ヘッドセットの
  物理ボタンでの送話操作はできなくなった**(トレードオフとして許容)。
  ⚠️ **未完了**: 撤回後のビルド確認・実機検証（Android実機検証、長時間
  バックグラウンド接続維持・Doze/App Standby等の電力最適化の影響、
  AVRCP系Bluetoothヘッドセットでのトグル動作確認）はいずれも未実施。また
  `PTTBackgroundControlManager`の常駐通知が状態変化のたび(他参加者の発話時も
  含む)にバナー+サウンドで再アラートする点も今回未修正のまま残っている。
  次アクションとして残す。
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

### Phase 11: 組織階層(Long-Term Architecture)の導入 → **実装完了（2026-07-26）**
業態にかかわらず必要な基盤であり、かつバッジマスタの団体単位管理
（旧Phase11後半）・管理者サイトの階層ナビゲーション等、後続の複数機能が
これに依存するため優先度を上げた。

- `organizations`/任意深さの`nodes`、Roomへの任意割り当て、`org-context`参照APIを実装
- 管理者サイトに団体・nodeの管理と、Room一覧の階層ナビゲーションを実装
- 既存Roomの強制バックフィルは行わず、無所属を正式な状態として扱う

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
  個別に`myRole === 'owner' || myRole === 'moderator'`を書いている）
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
- **（2026-07-30追加、二十二訂）組織ロースター層のスコープ付き権限**：
  `phase11-org-roster-design.md`で設計合意した「団体単位のロースター
  （`organizations/{orgId}/members/{uid}`）」を実装する場合、団体管理者が
  自団体配下だけを管理できる新しい権限スコープがadmin-dashboardの権限
  モデルに必要になる。現状の「サイト管理者」「Room内owner/moderator」の
  二択にこの中間スコープをどう組み込むかは、role×操作の対応表整理と
  合わせてここで検討する（詳細は5.4・6節参照）

### Phase 13: バッジシステムの基本機能 → **実装完了（2026-07-27）**
業種プロファイルに依存しない部分のみ先行実装する。業種プロファイル単位の
自動付与条件・団体単位でのマスタ書き換えはPhase15（業界ラベリング層）側に
分離し、Phase2の具体的な需要が見えてから着手する。

- グローバルな`badges`マスタ、`badgeGrants`の付与履歴、表示設定を実装
- 3クライアントの参加者一覧で最優先1件を表示。Guestは仮想の役割バッジを表示
- 管理画面でマスタを管理し、ユーザー管理画面からユーザー単位で手動付与・剥奪
- Room owner向けの付与/剥奪APIもあるが、現時点の3クライアントにはその操作UIを設けない

自動付与の実行バッチ、団体/業種プロファイル単位の複数マスタはPhase15以降の対象とする。

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
| 管理画面 | Phase11でPoCを実施し、構成・見せ方（ユーザ管理画面への統合を含む）は事後検討 |
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
- **他参加者のGuest判定手段の欠如（2026-07-25 課題化、未着手）**：
  現行の`firestore.rules`はクライアントが自分自身の`members/{uid}`
  ドキュメントしか読めない設計であり、かつroomメンバー向けに他メンバーの
  role等を返すAPIも存在しない（`admin-dashboard`が使う`GET /admin/rooms/:id`
  はサイト管理者専用APIで別軸の権限のため転用不可）。そのため3クライアント
  とも「自分自身がGuestであること」の表示のみに留め、参加者一覧上での
  他人のGuestバッジ表示はPhase10のスコープ外とした。着手する場合、
  「Guestか否かだけを返す」のではなく、他のユーザー情報（表示名以外に
  何を一般メンバーへ公開してよいか）を含めて要件から検討する方針
  （ユーザー確認済み、2026-07-25）。**Phase12（役割と機能の整理）で
  role別に何を一般メンバーへ公開してよいかを棚卸しする際、合わせて
  検討する**
- **ユーザー×団体の所属関係 → 設計方針を合意（2026-07-30、二十二訂）、
  admin-dashboard権限モデルへのスコープ追加方法も確定（2026-07-31、
  二十四訂）**：
  十三訂でPhase11実装時に明示的に着手対象外としていた本論点について、
  MLBの球団・選手の関係（一時的なつながり、トレード・フリーエージェント
  あり）を例えに検討し、別ドキュメント`phase11-org-roster-design.md`
  として設計をまとめた。所属情報は追加するが**Room入室の権限判定には
  使わない**（引き続き`rooms/{roomId}/members/{uid}`のroleのみで判定する）
  「任意のロースター層」（案C）を採用することでユーザーと合意している。
  **（二十四訂で追加確定）** データモデルは当初案の`orgRole: 'admin' |
  'staff'`の2値から、`scopeNodeIds?: string[]`（Branch等の特定node配下
  限定の兼務管理を表現）を追加する形に拡張した。権限判定は
  「root（`adminUsers`の`organizations:manage`権限）→ Company admin
  （`scopeNodeIds`未指定）→ scope限定admin（`scopeNodeIds`指定）→
  staff」という4層構造とし、祖先判定はPhase11で既に実装済みの
  `ancestorIds`（非正規化配列）をそのまま流用する（新規の祖先辿りロジック
  は不要）。監査ログも既存の`auditLogs`/`logAdminAction()`を拡張する形で
  統合することを確定した。詳細は二十四訂本文を参照。**実装（Firestore
  スキーマの反映・API・admin-dashboard UI）はまだ行っていない**。次アクション
  として、最初の団体管理者の代理登録フロー（鶏卵問題）のAPI設計・
  `GET /admin/me`の実装が残っている（詳細はPhase12・
  `phase11-org-roster-design.md`参照）
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
- **バックグラウンド動作の実機検証・ビルド確認 → iOSは原因調査の末CallKit統合を
  撤回（2026-07-27課題化 → 2026-07-30、二十訂で一部確認 → 二十一訂で設計変更）**：
  十四訂で実装したiOS/Androidのバックグラウンド動作(送受信両対応)について、
  iOSはユーザーの実機確認により「ハンドセットボタンを押すとフォアグラウンドに
  勝手に復帰する」問題が判明した。原因調査の結果、これまでの改定に記載のなかった
  CallKit統合(`PTTCallKitManager.swift`)が原因と特定し、バッテリー消費の観点から
  ユーザー方針によりCallKit統合を撤回した。これによりHFP系Bluetoothヘッドセット
  （Elecom LBT-HS11等）の物理ボタンでの送話操作はできなくなった（トレードオフ
  として許容済み）。以下は引き続き未確認・未修正のため次アクションとして残す。
  - CallKit撤回後のiOSビルド確認・実機再検証（画面PTTボタンのhold-to-talk、
    Bluetoothヘッドセットのマイクルーティングが維持されているか含む）
  - Android実機検証（`PTTForegroundService`、未報告）
  - 長時間バックグラウンド接続維持・Doze/App Standby等の電力最適化
    機能(メーカー独自のものを含む)による強制終了の有無
  - AVRCP系Bluetoothヘッドセットでのトグル動作確認
  - `PTTBackgroundControlManager`の常駐通知が状態変化(他参加者の発話時も含む)の
    たびにバナー+サウンドで再アラートする点の修正（今回のCallKit撤回とは
    別問題として指摘されたが未着手）
  - `git show`等によるコミット内容の直接検証（六訂・八訂・十六訂・
    十九訂と同様の確度での確認）

---

## 6. 次アクションの提案（2026-08-03 四十一訂で更新）

<details>
<summary>この一覧のitem番号がどう変遷してきたか（クリックで展開）</summary>

旧item 5「十八訂の変更のリポジトリへの反映確認」は、`git show`によるコミット
`d802de0`の直接検証をもって完了したため「6.1」item 13へ移動した。item 1は
二十一訂でのCallKit統合撤回を受けて範囲を更新した。二十二訂で新たにitem 5
（組織ロースター層の詳細設計・実装着手）を追加した。二十三訂では、item 1の
うち(d)「常駐通知の頻発」と(e)「CallKit撤回のリポジトリ反映確認」を
`git show`での直接検証（コミット`c8d05cf`・`f7388aa`）により解消し、
新たに発見した音声再生遅延バグの修正（コミット`544b853`）の実機検証を
item 1に追加した。二十四訂では、item 5のうち「admin-dashboardの権限モデル
へのスコープ追加方法」の設計（4層構造・データモデル・監査ログスキーマ）が
決着したため、item 5を実装着手前の残課題のみに絞り込んだ。二十五訂では、
item 1の残り全項目についてユーザーから実機検証結果の報告を受け、完了扱いと
して「6.1」item 16へ移動した。二十六訂〜三十一訂では、item3（論点5・6）の
調査を進め、admin-dashboardの4つの情報露出箇所・対応候補(i)〜(vi)・
ブートストラップ時の懸念点を洗い出した（詳細は文書冒頭の各訂参照）。
三十二訂では、候補(i)〜(iv)を実装し「6.1」item 17へ移動した（詳細は文書
冒頭の三十二訂参照）。候補(v)(vi)（サインインという行為自体を閉じるか）は
意思決定が済んでいないため、独立した項目として残す。三十三訂で組織
ロースター層のバックエンド・フロントエンドを実装し、三十四訂で
`dev-tools/test-roster.sh`によるHTTPレベルの統合テスト（全14ステップPASS）と
実コード直接確認により、item5の残課題のうち「scope限定adminによる
admin-dashboardでの団体選択」「リポジトリへの反映確認」を解消し、
「実機動作確認」もバックエンドAPI分は完了扱いとした。三十五訂では、
item5に残っていた「admin-dashboardのブラウザでの実機動作確認」に着手し、
権限ゲート(`GET /admin/me`)自体が設計通り動作することをブラウザ操作で
確認するとともに、「組織」タブ以外の5画面（ルーム・バッジ・ユーザー・
監査ログ・管理者権限）で403時にもフォーム・テーブルが表示されたままに
なるUI課題を発見・修正した（詳細は文書冒頭の三十五訂参照。ただし
`npm run build`・ブラウザでの目視確認・リポジトリへの反映は未実施のまま
次アクションとして残る）。三十六訂では、三十五訂の洗い出しから漏れていた
`RoomDetailView.vue`組織セクションの同種のちらつき不具合をユーザー報告を
受けて修正した（詳細は文書冒頭の三十六訂参照。こちらもビルド確認・目視
確認・リポジトリへの反映は未実施）。三十七訂では、`git show a8b05c6`により
三十六訂の修正のリポジトリ反映を直接検証してitem 5の残課題から外し、
item 6（`isForbidden`系フラグの機械的な棚卸し）に実際に着手して具体的な
発見（`v-else`直下のフォーム類が`isLoading`未ガード）を得たため、item 6を
「調査」から「実装が必要な具体項目」へ書き換えた。三十八訂では、item 6の
実装（4画面5箇所への`isLoading`ガード追加、`UsersView.vue`は実害なしと
判明したが予防的に追加）を行い、「6.1」item 18へ移動した。ビルド確認・
ブラウザでの目視確認・リポジトリへの反映確認が未実施のため、新たなitem
（下記item 6）として残した。三十九訂では、item 6のうち`npm run build`
（`vue-tsc -b && vite build`）・`npm run lint`（`eslint .`）を本ドキュメント
側で実際に実行しエラー0件を確認できたため、その部分を「6.1」item 20へ
移動した。ブラウザでの実際の目視確認（読み込み中のちらつき解消そのものの
確認）はこの環境では引き続き実行できないため、item 6として縮小した範囲で
残す。

</details>

現在有効な次アクションは以下の2件（旧item5・6は四十訂でユーザー申告に基づき
完了扱いとし「6.1」item21・22へ移動、旧item3は四十一訂で「対応しない」との
意思決定を得て「6.1」item23へ移動、旧item4はitem5完了を受けて「着手可能」に
更新した上でitem3として繰り上げた）。

1. **APIドキュメントの継続的な同期**：Phase11・Phase13・ユーザー管理・
   Phase16のエンドポイントは`API.md`に反映した。以後もルート追加時には
   同じ変更でAPI.mdとDATA_MODEL.mdを更新する。**（2026-07-31追加）**
   `GET /admin/me`も三十二訂でAPI.mdへ反映済み
2. **（低優先度・継続）** `UI_UX.md`・`SECURITY.md`・`AI.md`の空テンプレート
   整備：旧6.項目3で洗い出したまま未着手。転記元となる詳細記述が
   `token-server/README.md`側に存在しないため、内容そのものをこのタイミングで
   新規に書き起こす必要がある。優先度は引き続き低いが、Phase11〜13で
   ドキュメント化すべき内容（組織階層のスキーマ・role対応表・バッジ
   スキーマ）が増える見込みのため、それらと合わせて着手すると効率的
3. **招待コードの可視範囲（論点6）→ 着手可能（2026-08-03、四十訂）**：
   `rooms:monitor`権限保有者に「Roomへの参加権を事実上配布できる」権限まで
   広げることになるため、対象権限の絞り込み・監査ログ記録の要否と合わせて
   検討する必要がある（5.4参照）。この論点は組織ロースター層の
   `scopeNodeIds`が前提だったが、四十訂でユーザーから組織ロースター層の
   デプロイ・確認完了の報告を受けたため、着手可能になった。次アクションと
   しては、`scopeNodeIds`を使って「対象Branch配下のstaffに限定した閲覧
   権限」を新設する設計・実装に進む（例: 新設する権限を`rooms:monitor`とは
   別軸の`invite_codes:view`のような細粒度の権限にするか、既存の
   `organizations:manage`スコープに乗せるかを判断した上で、閲覧APIへの
   `inviteCode`追加・監査ログ記録を実装する）

### 6.1 完了済みアクション（アーカイブ）

<details>
<summary>2026-08-03までに完了した旧提案1〜23（クリックで展開。見出しの
日付・項目数は四十一訂で実態に合わせて更新した）</summary>

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
10. ✅ **完了（2026-07-28、十六訂）**: 「6. 次アクションの提案」旧item 3
    「Phase16 添付ファイルの運用・クライアント展開」のうち、iOS/Android版の
    画像・動画・PDF添付UI実装が完了した。アップロードされたリポジトリ一式
    （HEAD=`cc9369b`）の`git show`で直接検証済み。
    - **iOS**: コミット`50a56a5`("update")。`PTTChatStore.swift`に
      `sendAttachment`/`getAttachmentURL`/`getThumbnailURL`を追加し、
      Web版(`ptt-client/src/stores/chat.ts`)と同じ3段階の流れ
      （署名付きアップロードURL発行 → token-serverを経由せず直接PUT →
      `POST /messages`で確定）を実装。`ContentView.swift`に`PhotosPicker`
      （写真/動画）・ファイルアプリ経由のPDF選択・送信前プレビュー
      （pendingAttachment）・送信前クライアント圧縮（画像のみ）・
      添付付きメッセージ表示（画像はサムネイル、動画/PDFはアイコン＋
      ファイル名、タップで署名付きURLを開く）まで配線済み
    - **Android**: コミット`0507c28`("upadte")。`PTTChatStore.kt`に同等の
      `sendAttachment`/`getAttachmentUrl`を追加し、`PTTApp.kt`に
      `ActivityResultContracts.OpenDocument()`による添付ピッカー・送信前
      プレビュー・添付付きメッセージ表示までiOS版と同じ構成で実装
    - 両OSともWeb版の設計（token-server非経由の直接PUT、5分間有効な
      署名付きURLのmessageId単位キャッシュ、画像の送信前クライアント圧縮）
      を踏襲しており、実コード追随漏れ（六訂で問題視した種類の陳腐化）は
      見当たらなかった
    - **完了当時に残っていた部分**: item 3のもう一方の要素だった「添付用
      GCSバケット・CORS・サービスアカウント・保持期限クリーンアップの
      本番設定・検証」は今回の変更に含まれておらず、次アクションとして
      残していた（→ 十七訂で完了、item 11参照）
11. ✅ **完了（2026-07-28、十七訂）**: item 10で残っていた「添付用GCS
    バケット・CORS・サービスアカウント等の本番運用設定」について、ユーザーから
    「終わっている。実際にアップロードした画像が保存されていることを確認済み」
    との報告を受けた。**（留保）** クラウド側のリソース設定（バケット作成・
    CORS・IAM）自体はリポジトリのコミットとして現れないため、六訂・八訂で
    行ったような`git show`による直接検証はそもそも対象にならない。一方、
    本番環境で実際に画像をアップロードし保存されたことをユーザー自身が
    確認したという申告は、署名付きURL発行→GCSへのPUT→GCS実体検証を伴う
    `POST /messages`確定という一連の経路が本番で実際に動作したことを含意する
    エンドツーエンドの機能確認であり、単なる口頭申告よりは確度が高いものと
    位置づけて記録する。これでPhase16添付ファイル機能は、クライアント実装・
    本番運用設定の両面で完了した
12. ✅ **完了（2026-07-28、十八訂）**: Phase12 role×操作の対応表を実装へ
    つなげた。棚卸し（`phase12-role-operation-inventory.md`）で判明していた
    論点のうち実装アクションを伴う論点1・2・4、および実装確認の過程で
    新たに見つかった論点8（対応表定義済みだが未配線の操作群）を解消した。
    - `routes/reports.js`: 通報者のroomIdメンバーシップ検証・BAN済み
      チェックを追加（従来`requireFirebaseAuth`のみで、任意roomId宛てに
      通報できてしまっていた）
    - `routes/talk.js`（3エンドポイント）・`routes/rooms.js`
      （nickname/org-context）・`routes/messages.js`（チャット送信）に
      `requireRoomPermission('...')`を追加し、`lib/permissions.js`の
      `ROOM_OPERATIONS`定義と実際の強制経路を一致させた（挙動は不変）
    - `lib/permissions.js`に`checkRoleAssignmentTarget()`を新設し、
      `routes/rooms.js`（Room内owner専用API）と`routes/admin.js`
      （`rooms:manage`権限による代行API）に重複していたmoderator任命の
      対象role guardを一本化した
    - 論点3（Room作成非表示の判定軸）はコード上のコメントで
      「isAnonymousを正とする意図的な使い分け」と既に明文化されていることを
      確認し、決着済みと判断した。論点5(admin-dashboard事前権限チェック)・
      論点6(招待コードの可視範囲)は実装ではなく仕様判断が先に必要なため、
      次アクションとして残した
    - 変更ファイルは`node --check`で構文確認済み、`scripts/
      check-role-sync.js`も引き続き成功することを確認した。**（留保）**
      今回の変更はアップロードされたリポジトリのソースファイルへ直接行った
      ものであり、`tad-iizuka/FirebaseRTC`への実際のコミット・反映は
      本ドキュメント作成時点では未確認（六訂・八訂・十六訂と同じ確認
      プロセスを次アクションとして残す）
13. ✅ **完了（2026-07-30、十九訂）**: item 12（十八訂）の変更のリポジトリへの
    反映確認。アップロードされたリポジトリ一式（HEAD=`d2b1b27`）を取得し、
    `git show`でコミット`d802de0`("update"、2026-07-28 18:03:02 +0900)を
    直接検証した。
    - `git show --stat d802de0`で、十八訂が挙げた変更ファイル
      （`token-server/lib/permissions.js`・`routes/{reports,talk,rooms,
      messages,admin}.js`）がすべて含まれていることを確認した
    - `routes/reports.js`は差分の本文まで目視で照合し、「通報者が対象roomId
      のメンバーであること・BAN済みでないこと」を検証する追加ロジックが
      実際にコミットされていることを確認した
    - 同一コミットで`brushup-plan.md`自体の十八訂記述、および
      `phase12-role-operation-inventory.md`もあわせてコミットされていた
      （ドキュメントとコード変更が同一コミットにまとまっている）
    - これは六訂・八訂・十六訂で踏んだのと同じ、`git show`によるコミット
      内容そのものの直接検証であり、ユーザー申告のみ（十一訂等）や
      GitHub Actionsのスクリーンショット（旧版の十七訂相当）よりも
      確度の高い分類として記録する
14. ✅ **完了（2026-07-31、二十三訂）**: 旧item1(e)「CallKit統合撤回
    （二十一訂）のリポジトリへの反映確認」。アップロードされたリポジトリ
    一式（HEAD=`544b853`）の`.git`履歴を取得し、`git show --stat f7388aa`で
    `PTTCallKitManager.swift`の削除・`ContentView.swift`/`Info.plist`/
    `PTTAudioDiagnostics.swift`/`PTTConnectionManager.swift`/
    `ptt_iosApp.swift`の変更・`brushup-plan.md`自体の更新が同一コミットに
    含まれていることを確認した。六訂・八訂・十六訂・十九訂と同じ、
    `git show`による直接検証として扱う
15. ✅ **完了（2026-07-31、二十三訂）**: 旧item1(d)「`PTTBackgroundControlManager`
    の常駐通知が状態変化のたびに再アラートする問題」。`git show c8d05cf`で、
    常駐通知(`UNNotification`)機構自体を撤去し、Now Playingウィジェット
    （`MPRemoteCommandCenter`）へ一本化する変更が行われていることを確認した。
    ファイル冒頭コメントに「常駐通知とNow Playingウィジェットの表示が
    完全に重複していたため」という撤去理由が明記されている
16. ✅ **完了（2026-07-31、二十五訂）**: 旧item1「バックグラウンド動作・音声
    再生の実機検証」の残り全項目。ユーザーからの実機検証結果の報告を受けた
    （申告のみ、一次証跡なし）。
    - iOS: CallKit撤回版でのビルド確認・実機再検証（画面PTTボタンの
      hold-to-talk・Bluetoothヘッドセットのマイクルーティング維持を含む）
    - (a) Android実機検証（`PTTForegroundService`）
    - (b) 長時間バックグラウンド接続維持・Doze/App Standby等の電力最適化の
      影響
    - (c) AVRCP系Bluetoothヘッドセットでのトグル動作確認：**「トグルしない」
      ことを確認**。不具合ではなく、`MPRemoteCommandCenter`実装の対応範囲に
      関する既知の制約として「2-D」に記録した
    - (d)(e)（`git show`で確認済みだった点）の実機再確認
    - (f) コミット`544b853`の音声再生遅延バグ修正の実機検証、および
      Android側で同種の問題が起きていないことの確認
17. ✅ **完了（2026-07-31、三十二訂）**: item3（論点5）の候補(i)〜(iv)を
    実装した。`token-server/routes/admin.js`に`GET /admin/me`（権限不問）を
    新設し、admin-dashboard側（`stores/auth.ts`・`App.vue`）でサインイン後
    に権限が1つも無ければNavTabsを出さないゲートを追加した(iii)。
    `AuthView.vue`の説明文を一般的な文言に置き換え(ii)、トークンサーバー
    URL欄を既定で折りたたみにし(i)、6画面のエラーメッセージ・1箇所の
    補足説明文からFirestoreパス・権限名の露出を除去した(iv)。
    `vue-tsc -b`・`eslint .`・`vite build`の完走を確認した（ブラウザでの
    目視確認は未実施）。候補(v)(vi)（サインイン自体を閉じるか）は意思
    決定が済んでいないため対象外とし、次アクションとして独立させた。
    詳細は文書冒頭の三十二訂参照
18. ✅ **完了（2026-08-02、三十四訂）**: item5（組織ロースター層）の残課題
    のうち2点を解消した。①「scope限定adminによるadmin-dashboardでの団体
    選択」: `routes/organizations.js`に`canReadOrg()`を新設し、単体取得
    `GET /admin/organizations/:orgId`・node一覧`GET /admin/organizations/
    :orgId/nodes`の権限チェックを`organizations:monitor`固定から
    差し替え、`stores/adminOrganizations.ts`・`OrganizationsView.vue`側にも
    `managedOrgIds`経由のフォールバック取得・表示を追加した。②「リポジトリ
    への実際のコミット・反映の確認」: `git status`でローカル検証環境が
    `origin/main`と一致していることを確認した。あわせて、`dev-tools/
    test-roster.sh`によるHTTPレベルの統合テスト（root/団体全体admin/
    scope限定admin/staffの4者・override規約を含む全14ステップ、FAIL=0）が
    実施され、その権限判定ロジックをリポジトリ本体のソースコードと直接
    突き合わせて確認した。これにより「実機動作確認」はバックエンドAPI分に
    ついて完了扱いとした（admin-dashboardのブラウザでの確認は未実施のまま
    次アクションとして残る）。詳細は文書冒頭の三十四訂参照
19. ✅ **完了（2026-08-02、三十八訂）**: item 6「`v-else`直下のフォーム類への
    `isLoading`ガード追加」を実装した。`RoomsListView.vue`・`BadgesView.vue`
    （2箇所）・`AuditLogsView.vue`・`AdminsView.vue`の計5箇所に、既存の
    `isLoading && length === 0`パターンをフォーム・見出し側にも適用した。
    `RoomDetailView.vue`組織セクションは三十六訂で対応済みのため対象外、
    `UsersView.vue`は自動フェッチが無く実害はないと判明したが予防的に
    同じガードを追加した。ビルド確認・ブラウザでの目視確認・リポジトリへの
    反映確認は未実施のため、新たな次アクション（item 6）として残した。
    詳細は文書冒頭の三十八訂参照
20. ✅ **完了（2026-08-03、三十九訂）**: item 6の残課題のうち「ビルド確認」を
    解消した。アップロードされたリポジトリ一式（HEAD=`8b52861`、
    `origin/main`と一致を`git status`で確認済み）の`admin-dashboard`に対して
    `npm install`（478 packages）→`npm run build`（`vue-tsc -b && vite
    build`）→`npm run lint`（`eslint .`）を実行し、いずれもエラー0件で
    完走することを直接確認した。あわせて`scripts/check-role-sync.js`の
    再実行（3クライアントとサーバーのrole定義一致）、二十訂以降に新設された
    `token-server/lib/orgRoster.js`・`lib/roomCreation.js`・
    `routes/users.js`の`node --check`構文確認も行った。**（留保）** 型・
    構文レベルの確認であり、「読み込み中はフォームが実際に非表示になり
    ちらつきが解消されているか」というブラウザでの実際の目視確認までは
    代替しないため、item 6の残り（ブラウザ目視確認・リポジトリ反映確認）は
    引き続き次アクションとして残る
21. ✅ **完了（2026-08-03、四十訂、留保付き）**: item 5「組織ロースター層」の
    残課題（admin-dashboardのブラウザでの実機動作確認の続き・名簿の付与/
    編集/剥奪の実際の画面操作・`firestore.rules`/インデックスの本番デプロイ
    確認）について、ユーザーから「デプロイ・確認までおわっています」との
    報告を受けた。**（留保）** 六訂・八訂・十六訂・十九訂・二十三訂・
    三十七訂で踏んできたような、新規コミットを`git show`で直接検証する
    プロセスは今回実施していない（アップロード済みリポジトリのHEADが
    三十九訂検証時点（`8b52861`）から変化していないため、検証対象となる
    新規コミット自体が本ドキュメント側に存在しない）。十一訂・十七訂・
    二十五訂と同じ「ユーザー申告のみに基づく完了」として記録する。これで
    組織ロースター層（Phase11後半の所属管理機能）は設計・実装・バックエンド
    統合テスト・admin-dashboardのブラウザ動作確認・本番デプロイのすべての
    工程が完了扱いとなった。次アクションitem4（招待コードの可視範囲）が
    前提としていた`scopeNodeIds`の実装・デプロイが完了したことを受け、
    item4を「着手可能」に更新した
22. ✅ **完了（2026-08-03、四十訂、留保付き）**: item 6「`isLoading`ガード」の
    残課題（ブラウザでの実際の目視確認・リポジトリへの反映確認）について、
    item 21と同時にユーザーから「デプロイ・確認までおわっています」との
    報告を受けた。item 21と同じ留保（`git show`による新規コミットの直接
    検証は未実施、ユーザー申告のみに基づく完了）が適用される。これで
    三十五訂〜三十七訂で発見・修正してきたadmin-dashboard 6画面の403時
    ちらつき問題は、型・構文チェック（三十九訂・本ドキュメント側で直接
    確認済み）・実際の見た目確認・本番反映のすべてが完了扱いとなった
23. ✅ **完了（2026-08-03、四十一訂、意思決定により対応しないことで決着）**:
    item 3「サインインゲート自体を閉じるか（候補(v)(vi)）の要否判断」に
    ついて、ユーザーから「対応しません」との意思決定を得た。候補(i)〜(iv)
    （三十二訂で実装済み。サインイン後に見える/できる範囲を狭める対応）は
    既に対応済みであり、候補(v)(vi)が対象とする「無関係なGoogleアカウント
    保持者がそもそもサインインできてしまうこと」自体は、各APIが
    `requireAdmin`で別途保護されていて実害が小さいと判断されたため、
    Google Workspaceドメイン制限・Firebase Authのblocking functionいずれも
    見送りとする。管理者アカウントの運用ポリシーが変わる等の事情変化が
    あれば再検討の余地がある旨を記録した上で、これ以上のフォローアップは
    不要な項目として扱う

</details>
