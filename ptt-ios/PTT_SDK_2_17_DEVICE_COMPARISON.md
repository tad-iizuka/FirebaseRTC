# LiveKit 2.17.0 実機比較試験

評価専用: codex/ptt-sdk-2-17-safety、/private/tmp/ptt-sdk-2-17-safety。
本番ブランチへの反映なし。接続世代管理修正と診断ログを現行2.15.1から移植。
SDK API差分はLocalAudioTrack.createTrack()のawait（アプリ・テスト各1箇所）。
SDK以外のアプリソースは現行と同じ。Package.resolvedではLiveKit2.17.0、WebRTC150.7871.2、UniFFI0.1.9へ更新、swift-protobuf直接pinが消える。Firebase12.15.0は維持。
WebRTCも変わるため、変化をrollbackのみの効果と断定しない。

## 操作（評価版のDebugをXcodeから起動、コンソール全体を保存）

端末2.15.1と2.17.0のログを混ぜず、同一端末・同一アカウント・同一ネットワーク・同じRoomで比較する。評価版への置換前に現行ログを保存。接続要求の連打を避け、各入室の間を10秒以上空ける。レート制限応答があれば60秒以上待ち、その試行を別分類する。

1. 通常入室10回以上: 入室→事前publishの成功/失敗表示まで待つ（最低7秒）→PTTを1秒押して解放→退出→cleanup_completeを待つ。
2. 待機中退出: Frame watcher待機ログが出てpublish結果がまだ出ないときに退出。成功が速くて間に合わない回は対象外。タイムアウトしやすい条件を新たに作ったりunmuteしたりしない。対象3回以上を目標とし、再現しない場合は未検証。
3. 即時再入室: 2の退出直後に1回だけ再入室。旧cleanup_complete→新room_connect_begin→接続成功の順序を確認。
4. 音声安全性は別途2台で確認。統計やrollbackだけで音声漏れなしとは判定しない。

通常試行だけでも先に採取可能。タイミングが難しい試行は無理に連打しない。

## ログ判定

- 世代ごとにmute_complete_publish_begin→publish_complete_before_resultまたはpublish_failedのuptime_ns差分をms化。途中退出は通常成功率から除外。
- SDKのCID（add track / resolving completer）を失敗trackと対応付け、WebRTC送信stream/SSRCを追跡。初回押下の新CIDと区別。
- 失敗後、初回押下後、解放後、退出前の旧stream削除を照合。同一PeerConnection/SSRC/CIDの対応が曖昧なログを除去成功に数えない。
- [publish] failedはrollbackに入る直前の証拠。アプリpublish_failedはrollbackとtrack.stopのawaitが戻った後の境界。rollbackが実行されたかはsender/transport一致条件にも依存。
- SDK2.17.0にrollback開始/正常完了の専用ログはない。failed to roll back senderは失敗証拠、警告なしだけでは成功証明にならない。TransportのShouldNegotiateやnative stream削除を補助証拠とする。SDK内部のログ追加は行わない。
- SDKのrollbackはpublisher.remove(sender)→publisherShouldNegotiate。正常戻りだけではSFU反映完了を保証しない。音声transceiver自体の停止を保証する処理でもない。
- exit_invalidated→prepare_task_complete / cleanup_completeを集計。cancel要求とSDK待機終了を区別。
- 旧cleanup中のprepare_beginは許容。旧cleanup前の新room_connect_begin、旧Room delegateによる現状態更新、退出後の接続エラーは要調査。
- App Check成功/失敗、talk HTTP/Firestore transaction、mute→talk/stopの順序を既存traceで確認。モック合格と実機排他制御試験を区別。

## 現行2.15.1の比較基準

23世代の準備Task・cleanup終了。publish中退出4件の退出→準備Task終了24.833/1801.627/4540.483/4419.068ms、cleanup539.046/2212.908/4964.382/4840.077ms。
通常完了17件中成功13、Frame watcher timeout4（23.529%）。成功publish12.611〜37.519ms、失敗5275.719〜5363.077ms。
過去ログでは失敗旧streamが退出まで残る。RTP送信、SFU残存、実音声は未検証。

2.17.0の実機ログは今回未取得。rollback効果、timeout率、実機退出回帰、本番採用は未判定。

## 準備検証（2026-10-09）

- generic iOS/arm64 Debug build、署名なし: 成功。/tmp/ptt-sdk-2-17-generation-build-retry.log。
- 初回の別derivedDataビルドはNo space left on deviceで失敗。今回作成した失敗成果物を削除し、既存キャッシュで再実行して成功。
- テスト初回はシミュレーター起動待ちで中断。起動復旧後、コンパイル済みの同じコードで全テストを再実行（test-without-building、parallel-testing-enabled NO）。最終結果は下記へ記録。
- 実機一覧取得: CoreDeviceService起動タイムアウト。実機へのインストール・タッチ操作・評価版実機ログ採取は未実施。
- アプリのConnectionOperations既定値にMainActor初期化警告あり（現行コードにもある）。今回評価で挙動変更して解消はしない。
- 評価ブランチ内のPTT_CONNECTION_LIFECYCLE.mdは現行2.15.1の修正説明・過去試験記録をコピーしたもの。2.17.0の今回結果は本書を参照。

最終結果: TEST EXECUTE SUCCEEDED。既存UIテスト10件（起動8条件含む）、Swift Testing12テスト/2 suites成功。publish中退出のモックは遅い成功・失敗の2引数ケースを含む。
ログ: /tmp/ptt-sdk-2-17-generation-tests-retry.log。
結果: /tmp/ptt-sdk-2-17-build/Logs/Test/Test-ptt-ios-2026.10.09_09-07-12-+0900.xcresult。
全テストは実ネットワークの発話権排他、実機PCM、rollback実動作、旧RTP送信、SFU残存、音声漏れの保証ではない。

|項目|2.15.1実機基準|2.17.0今回|
|---|---|---|
|通常事前publish timeout|4/17|未取得|
|成功publish時間|12.611〜37.519ms|未取得|
|旧stream|過去ログで退出まで残存|未確認|
|rollback|失敗後sender rollbackなし|コードあり、実機効果未確認|
|退出・再入室|実機確認範囲合格|モック合格、実機未検証|
|App Check/Firestore|既存結果を参照|実機未検証、コード変更なし|
|本番採用|現行維持|保留|

## 実行版確認ゲート（2026-10-09追加）

ブランチcodex/ptt-sdk-2-17-safety、基準commit202d14ce7e05464e962a4e01dfcd074bde38e4e2。世代管理等は未コミット差分なのでcommitだけで成果物を識別しない。
Package.resolvedのLiveKit2.17.0/revision f07831a7f06bca9e2fc2e136db591b7b42f16d8d確認。
Debug起動ログ[PTTBuild] evaluation=217-generation-v1にSDK自身のLiveKitSDK.version、expected_sdk、基準commit、dirty、コンパイル元#filePath、bundleを追加。変更は評価側ptt_iosApp.swiftのログのみ。
識別ログ追加後generic iOS Debugビルド成功、署名なし。/tmp/ptt217-identity-build.log。既存全テスト成功はログ追加前の結果で、新しい実機試験結果ではない。

Xcodeの実画面では本番側/Users/Tadashi/Developer_Firebase/FirebaseRTC/ptt-ios/ptt-ios.xcodeprojが開かれ、LiveKit2.15.1、Scheme ptt-ios、Target ptt-ios、Run Destination iPhoneだった。評価プロジェクトへの切替を試したが最終確認前にnative操作接続が閉じた。評価側Xcode表示と実機Runは未確認。比較は開始しない。

手順:
1. Xcodeで本番側のRunを停止し、File > Openから/private/tmp/ptt-sdk-2-17-safety/ptt-ios/ptt-ios.xcodeprojを開く。同名の本番側ウィンドウを閉じる。
2. Package DependenciesのLiveKit2.17.0を確認。Scheme/アプリTarget ptt-ios、Run Debug、接続した物理iPhoneを選択（シミュレーターやAny iOS Deviceを選ばない）。
3. Product > Run。起動コンソールに[PTTBuild] evaluation=217-generation-v1 sdk=2.17.0 expected_sdk=2.17.0とsourceにptt-sdk-2-17-safetyが含まれることを確認。ログなし、sdk不一致なら試験・比較を中止。
4. 版確認行を含むコンソール全体を保存し、通常入室10回以上と上記退出試験を行う。

2.17.0のrollback実機結果・成功率・PTT開始/mute時間・実機退出回帰はすべて未検証。前回添付908cc547は2.17.0の比較母集団から除外。本番2.15.1の設定/発話権/音声挙動は変更なし。
