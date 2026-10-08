# iOS PTT開始遅延調査（2026-10-08）

## 原因候補（優先順）

1. **App Check取得待機**。開始経路は Firebase ID Token取得 → App Check取得 → talk/start HTTP → setMicrophone。403はApp Check段階で発生し、このawaitはマイクの約40msとは別。取得ヘルパーに強制refreshや独自リトライはなく、SDK内の再取得・バックオフの所要時間は実機ログで確認する。初期化順序（Factory登録 → Firebase.configure）は正しい。App Attest entitlementが欠落していたためproductionを追加。Firebase ConsoleのiOS登録、Team ID、Bundle ID、署名profileの照合は未確認であり、403の解消を保証するものではない。
2. **押下表示の遅延（確定）**。従来の表示はisSendingだけを監視し、ネットワーク完了まで視覚的変化がなかった。同期的にisAcquiringTalkを設定し「発話権を取得中…」と縮小・背景色を表示する。
3. **取得リクエストの重複（確定）**。DragGesture.onChangedの繰り返しに対してpttHeldガードがなかった。1押下1リクエストにし、start/stopを順序化。短い押下・マイク有効化中の解放・連打で古いstopが新しいロックを解放しないようにする。
4. **初回トラック準備漏れ（確定）**。keep-alive関数はstatus=.connectingの間に呼ばれ、.connectedガードで終了していた。さらに固定SDKのsetMicrophone(false)は未作成トラックをpublishしない。入室時にLocalAudioTrackを作成し、muteをawaitしてからpublishをawaitする。SDKのTrack.startはローカルのmuteを解除しない。接続完了表示は準備が終わった後とする。準備失敗時は記録し、初回の安全な通常publishへフォールバックする。
5. **メインスレッドの同期音声処理（確定）**。アプリinitのsetCategory/setActive、割り込み復帰時のsetActive、接続時の同期startLocalRecordingが該当。セッションをLiveKitの自動管理へ戻し、明示的なADM warmup/stopを専用シリアルDispatchQueueへ移す。SDK既定のspeaker/Bluetoothルートを使用するため、従来の固定voiceChatからspeaker時videoChatなどへ変わる点は実機で確認する。
6. **サーバー／Firestore／Cloud Run初回待機（未計測）**。サーバーは認証、参加・権限・時刻確認後にFirestoreトランザクションをawaitする。これは排他制御に必須で維持する。LiveKitメタデータ更新は既に応答を待たないため、今回await除去の対象にはしない。

## 計測

端末はDispatchTime.uptimeNanoseconds、サーバーはperformance.now。時計の原点は異なるので端末とサーバーの絶対時刻は引き算しない。trace IDで関連付け、各側の所要時間を比較する。ログに認証トークンや音声を含めない。

`[PTTStart] id=UUID attempt=1 first=true stage=... total_ms=... delta_ms=... main=true`

- button_event → ui_change_begin → ui_pending_complete
- operation_queue_complete（直前の停止処理待ちを含む）
- lock_acquire_begin
- firebase_auth_begin/complete
- firebase_appcheck_begin/complete（別途[AppCheck]に成功/失敗と所要時間）
- talk_http_begin/complete
- lock_acquire_complete
- microphone_enable_begin/complete
- audio_publish_or_unmute_complete（事前publish済みならunmute完了）
- ui_sending_complete

`delta_ms`は直前の記録からの待機、`total_ms`は押下からの累積。工程のbegin/completeのtotal差が工程全体の時間。初回はattempt=1、2回目以降はattempt>=2。再入室でリセットされる。失敗・解放途中も終了理由のstageを出す。

`[PTTStartServer]`は同じIDでFirestore開始、read開始/完了、transaction commit完了、response準備、失敗を記録。tx_attemptでFirestore内部の再試行を確認する。サーバー計測の起点はルートhandlerであり、前段middlewareの待機は端末HTTP時間に含まれるが、このtransaction時間には含まれない。

`[PTTPrepare]`は権限確認、warmup開始/完了、isEngineRunning、ミュートpublish結果、準備全体を記録する。マイク権限はSDKの非同期ensureDeviceAccessで接続時に確認する。

UI完了ログはPublished状態への代入完了であり画面描画完了を示さない。SDKのマイクAPI戻りはpublish/unmute完了であり、最初のRTP送信・相手側可聴音声の時刻ではない。実際のメインスレッド停止・描画遅れはInstrumentsのTime Profiler/Hangsで併せて測る。

## App Check設定

- DEBUGシミュレータのみDebug Provider（Firebase Consoleでデバッグトークン登録が必要）。
- Development実機／Release実機はApp Attest。Firebaseの要件に合わせApp Attest environmentはproduction。
- ReleaseシミュレータにもDebug Providerは選択しない。
- Factory登録はFirebase.configureより前のまま維持。
- 同時リクエストのApp Check取得をactorで一本化し、SDKの有効期限・キャッシュ・refresh判断を維持。独自の強制refreshや再試行は追加しない。
- 本番のenforcement、サーバーの既存soft/enforce判定、失敗時の既存挙動は変更しない。

公式資料: [Firebase App Attest設定](https://firebase.google.com/docs/app-check/ios/app-attest-provider)、[LiveKit AudioManager](https://docs.livekit.io/reference/client-sdk-swift/documentation/livekit/audiomanager/)。実装APIの挙動はPackage.resolvedで固定されたLiveKit 2.15.1 / Firebase 12.15.0のローカルSDKソースも確認した。

## 安全性と実機検証

発話権取得成功前はマイクをunmuteしない。入室時トラックはpublish前にmuteする。終了時はマイク停止（失敗時はRoom disconnect）後にロック解放。Firestoreの排他トランザクション、heartbeat、最大発話時間、録音のメタデータ処理は維持。開始・終了・heartbeatの接続先を取得時のコンテキストで固定し、退出／再入室をまたぐ古い処理が新ルームのロックを操作しないようにする。

実機で入室後の1回目／2回目／3回目を同じルートで測り、App Check、HTTP、Firestore、microphone、総時間を比較する。Bluetooth／本体、マイク権限許可済み／未許可、409競合、取得待ち中の解放、unmute中の解放、連打、退出、割り込み、録音開始・停止を確認する。相手端末で権限取得前／ボタン解放後に可聴音声がないことも確認する。実機測定・Firebase Consoleの変更・サーバーデプロイは今回未実施。

## 変更ファイル

- ContentView.swift: 押下・取得中の視覚表示。
- PTTConnectionManager.swift: 計測、事前ミュートpublish、重複防止、開始終了順序化。
- PTTAudioDiagnostics.swift: 単調時計trace、音声worker。
- PTTAppCheckProvider.swift: DEBUG限定debug provider、取得の集約・計測。
- ptt-ios.entitlements: App Attest production環境。
- ptt_iosApp.swift / PTTBackgroundControlManager.swift: SDKによるセッション管理。
- ptt_iosTests.swift: main以外での音声worker、publish前mute、未接続時送信禁止の確認。
- token-server/routes/talk.js: Firestore transactionのtrace（排他ロジック変更なし）。

## 実行結果

- Xcode / iPhone 17 Pro (iOS 26.5) Simulator向けDebugビルド成功。
- 最終コードに対するptt-iosTestsの3件すべて成功（`-parallel-testing-enabled NO -only-testing:ptt-iosTests`）。
- `node --check token-server/routes/talk.js`、`git diff --check`、entitlementsの`plutil -lint`成功。
- 実際のtalk/start handlerをVMで実行する一時モック検証で、取得成功・他人のロックの409拒否・自分のacquiredAt維持・失効ロック取得・commit後の応答を確認。実Firestoreの統合試験ではない。
- 初回実行の一時ビルドはディスク容量不足で失敗したため、その一時領域を削除し既存Xcodeキャッシュで再実行。テスト用cloneのサービス警告も出たが、最終の並列無効テストは成功。
- 実機の初回／2回目以降の数値比較、App Check 403の解消確認、録音・Bluetooth・短い押下の統合検証、Instruments測定は未実施。端末とサーバーに変更を反映し、本資料のログで確認する。
