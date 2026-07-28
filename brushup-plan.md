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
| バックグラウンド動作(送受信) | - | ⚠️実装済み・実機未検証 | ⚠️実装済み・実機未検証 | 2026-07-27、十四訂で実装。ビルド確認・実機検証は次アクション |
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
  ⚠️ **未完了**: ビルド確認（作業環境がオフラインのためGradle/Xcode
  いずれも実行不可だった）・実機検証（ロック画面操作、長時間バックグラウンド
  接続維持、Doze/App Standby等の電力最適化の影響、Bluetoothヘッドセットの
  実際の挙動）はいずれも未実施。次アクションとして残す。
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
- **バックグラウンド動作の実機検証・ビルド確認が未実施（2026-07-27
  課題化、未着手）**：十四訂で実装したiOS/Androidのバックグラウンド
  動作(送受信両対応)は、作業環境がオフラインだったためGradle/Xcodeでの
  ビルド確認ができておらず、また実機でのロック画面操作・長時間バック
  グラウンド接続維持・電力最適化機能(Doze/App Standby、メーカー独自の
  ものを含む)による強制終了の有無・Bluetoothヘッドセットとの実際の
  挙動のいずれも確認できていない。ユーザー側の手元環境でのビルド・
  実機検証を次アクションとして残す。

---

## 6. 次アクションの提案（2026-07-28 十八訂で更新）

Phase12 role×操作の対応表実装（旧item 2）が完了したため「6.1」item 12へ
移動し、残項目を1つ繰り上げて番号を振り直した。

1. **バックグラウンド動作(十四訂)のビルド確認・実機検証**：手元のXcode/
   Android Studioでのビルド確認、実機でのロック画面操作・常駐通知の
   送話トグル・Bluetoothヘッドセット操作・長時間バックグラウンド接続
   維持・電力最適化機能の影響確認を行う。問題があれば都度この計画へ
   反映する
2. **APIドキュメントの継続的な同期**：Phase11・Phase13・ユーザー管理・
   Phase16のエンドポイントは`API.md`に反映した。以後もルート追加時には
   同じ変更でAPI.mdとDATA_MODEL.mdを更新する
3. **（低優先度・継続）** `UI_UX.md`・`SECURITY.md`・`AI.md`の空テンプレート
   整備：旧6.項目3で洗い出したまま未着手。転記元となる詳細記述が
   `token-server/README.md`側に存在しないため、内容そのものをこのタイミングで
   新規に書き起こす必要がある。優先度は引き続き低いが、Phase11〜13で
   ドキュメント化すべき内容（組織階層のスキーマ・role対応表・バッジ
   スキーマ）が増える見込みのため、それらと合わせて着手すると効率的
4. **Phase12の残課題（棚卸しの論点5・6）の仕様判断**：十八訂で実装した
   のは棚卸しの論点1・2・4、および新たに見つかった論点8（対応表未配線の
   4操作）のみ。以下の2点は実装ではなく仕様判断が先に必要なため、
   判断が付き次第着手する。
   - admin-dashboardに事前権限チェック（メニュー非表示等）を追加するか
     （論点5）
   - 招待コードの可視範囲。`rooms:monitor`権限保有者に「Roomへの参加権を
     事実上配布できる」権限まで広げることになるため、対象権限の絞り込み・
     監査ログ記録の要否と合わせて検討する（論点6、5.4参照）
5. **十八訂の変更のリポジトリへの反映確認**：今回の実装はアップロードされた
   リポジトリのソースファイルへ直接行ったものであり、
   `tad-iizuka/FirebaseRTC`への実際のコミット・反映は本ドキュメント作成
   時点では未確認。六訂・八訂・十六訂で踏んだのと同じ`git show`等での
   確認プロセスを次アクションとして残す

### 6.1 完了済みアクション（アーカイブ）

<details>
<summary>2026-07-28までに完了した旧提案1〜12（クリックで展開）</summary>

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

</details>
