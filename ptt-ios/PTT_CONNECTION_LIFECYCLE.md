# 接続世代・退出の所有権（2026-10-09）

LiveKit SDK 2.15.1。Firestore発話権・事前mute/publish・録音初期化方式は変更しない。

## 所有権

接続開始ごとにConnectionSessionを作成し、UUID、valid、Room、準備Task、warmup開始成功を保持する。Room未作成のtoken段階も世代に属する。共有状態を変更する前に現世代ID、valid、Task取消状態、Room参照一致を検証する。Room delegateも現世代が所有するRoomの通知だけを反映する。

退出は世代を先に失効・切り離し、準備Taskへcancelを要求する。共有UIは同期的に退出状態にする。旧Taskのcatchは世代一致しない場合に何も反映せず、意図的な退出のCancelledを接続エラーにしない。現世代の実際の失敗は従来どおり表示する。

準備Taskのdeferが触るのは自分のSession.taskだけ。cleanupは捕捉した旧Room・旧talk request contextだけを使う。mute成功（失敗時Room.disconnect）→talk/stop→Room.disconnectの順序を保持。その後旧準備Task終了をawaitし、遅れて終わったSDK処理も考慮して旧Roomを再度disconnectする。個別sender/track cleanupは追加しない。

warmupのawaitが退出後に成功しても、開始済みの資源は旧Sessionに記録し、旧cleanupだけが停止する。新世代は旧cleanupの完了後にtoken/Room接続を開始するため、旧停止が新engineを停止しない。cancelは通信中断完了と同義に扱わない。SDKが応答しなければ再入室準備が待つ可能性があり、未確認の短いtimeoutで重ねて初期化しない。

## 計測

`[PTTConnection] generation=... uptime_ns=...` のprepare_begin、exit_invalidated、prepare_task_complete、cleanup_completeを追加。token未取得でも退出を記録する。PTTPublishの退出stageはdisconnect_requested_prepare_task_cancelへ変更。cleanup_completeはwarmup停止後で、Task取消要求と処理終了を区別する。

## テスト

ConnectionOperationsは既存SDK呼び出しをそのまま既定値に持つ内部の非同期境界。テストではtoken/connect/permission/warmup/publish/mute/disconnect/talk解放を制御し、ネットワーク・実機PCMなしで所有権を検証する。取消を無視するgateが後から成功/失敗する状況も再現する。

- token中退出：遅い旧成功からRoomを作らず、退出後再入室できる。
- token/Room接続中のCancelled：退出後に接続エラーを表示しない。
- warmup中退出：旧warmupの停止後に新準備を開始。
- publish中退出：遅い成功/失敗を新世代へ反映しない。
- cleanup待ち中再入室：旧Roomだけを切断し、遅いdelegateも無視。
- 現世代の通常失敗は隠さない。
- 既存PTT安全性テストも実行。

実機PCM、旧RTP統計、SFU残存、解放後実音声、SDK内部取消の実機挙動はこのモック試験で保証しない。本修正を音声漏れ対策完了とは扱わない。

## 検証結果

2026-10-09、iOS27.0シミュレーターで追加7テスト＋既存5テスト、計12テスト成功（publish中退出は成功/失敗の2ケース）。取消を無視するモックの遅い結果も検証。テストログ `/tmp/ptt-generation-tests.log`、結果bundle `/tmp/ptt-generation-build/Logs/Test/Test-ptt-ios-2026.10.09_08-47-43-+0900.xcresult`。最初のテストで英語ログを日本語固定文字列で判定した1件が失敗し、実際のローカライズ文字列を使うよう修正して再実行した。

明示退出時の既存talk/stopは維持。接続失敗cleanupやSDK切断通知からは新たにtalk/stopを送らず、Firestoreの操作条件を増やさない。

最終コードのgeneric iOS/arm64 Debugビルド成功（署名なし）。ログ `/tmp/ptt-generation-build.log`。SDK固定2.15.1とpackage revisionは維持。`git diff --check`成功。実機へのインストール・音声安全性試験は未実施。
