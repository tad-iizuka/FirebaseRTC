# 画面PTTのGesture取消・inactive安全停止

2026-10-09。codex/ptt-sdk-2-17-safetyのみ。本番2.15.1、SDK内部、Firestore、音声初期化、ミュート事前publishは変更しない。

## 修正

ContentViewはGestureState/updatingで画面タッチ寿命を監視し、正常終了/システム取消のfalseへのリセットを共通停止入口へ送る。取消で呼ばれないonEndedを停止の唯一の入口にしない（今回onEndedへの依存を除去）。scenePhase active→非activeは保持中の画面pressだけ同じ入口で停止。View消失も停止。再activeの開始処理はない。
managerのScreenPressにはUUIDとconnection generationを保持。現在の画面press一致と世代一致を確認し一度だけ消費する。scene/gesture重複停止、後着旧press停止、旧世代停止を拒否する。背景リモート操作に画面handleがなければscene停止は作用しない。
isStoppingTalk中は画面・remoteを含む新しいstartを受け付けない。画面側も1つのタッチ列で開始を1回だけ試み、停止中の拒否後に指を保持したまま遅れて開始しない。先行start完了→捕捉Roomのmute→発話権解放。mute失敗時は捕捉Room disconnectを待ってから解放。失敗はログで区別。
talk/stopはtry?で成功扱いせず、失敗をtalkStopErrorと画面へ表示し停止ゲートを維持。無条件retryはしない。退出して再入室する回復が必要になり得る。遅い旧stopの完了/失敗で新Roomの状態を変えない。
enable失敗のcleanupも同じ停止キューへ統合し、先にqueued stopがあれば二重のfloor解放を追加しない。

## 計測

PTTBuild evaluation=217-screen-inactive-v2 sdk=2.17.0を修正版実機の識別に使う。base_commitは固定識別ラベルでdirty=trueのため全変更を表すSHAではない。
screen_press_begin/stopはpress ID/generation/sourceを記録。scene_inactive、gesture_end_or_cancel、view_disappearを区別。通常終了/取消のrelease単調時刻、既存enable/mute時刻を維持。
talk_stop_begin/complete/failedを既存traceへ記録。API成功と実RTP停止/受信無音は別。

## テスト

iOS26.5 Simulatorでビルド・unit test成功：24 tests/4 suites（パラメーターケースを含む）。
画面通常終了/inactive、取得中/enable中inactive、後着終了、新activeで自動再開なし（manager制御）、停止中再押下拒否、旧世代停止無効、stop HTTP失敗で停止ゲート維持、mute失敗でdisconnect後解放、画面handleなしのremote送話を検証。
既存の連続押下試験は、停止中の押下を拒否し、終了後の改めての押下を受け付ける期待値に更新。
ログ /tmp/ptt217-inactive-tests.log。最終ソース確認は /tmp/ptt217-inactive-tests-final.log。既存UIテストは /tmp/ptt217-inactive-ui-tests.log。testExampleは成功。繰返し起動のperformance試験中に空き容量不足が再発したため試験を中断。UI全件成功とは扱わない。
今回分の差分 /tmp/ptt217-inactive-fix/change.patch（変更前から既に存在した接続世代修正等を除いた比較）。

## 実機合格手順（未実施）

1. 評価プロジェクトのDebugを実機Run。PTTBuildの217-screen-inactive-v2/2.17.0を確認。
2. A/B別UIDで同じRoomへ接続。A押下で正常送話を確認。
3. Wi-Fiを変えず別の指でControl Centerを開く。保持中の画面pressがscene_inactiveまたはgesture取消から停止し、mute→talk_stop_completeを確認。
4. 閉じてA非送話、Bの取得/送話成功を確認。
5. Aの元の指を離す。追加floor解放がないことをpress/traceで確認。
6. Aで新しく押下し正常送話、解放で正常終了。復帰だけでenableしていないことを確認。
7. 取得中/短押し、回線切替あり、退出再入室、タブ/サイズ変更、remote control操作を別試行にする。

## 限界

自動試験はmanagerの決定的非同期モックであり、Control Centerの実際のscenePhase/GestureState通知を保証しない。実機試験、RTP停止、受信側無音、実Cloud Run/Firestore owner消失は未検証。
View構造はContentViewのGestureStateを両レイアウトのPTT領域で使用。レイアウト切替/タブ消失時に通知が期待通り届くかは実機回帰対象。
SDK awaitが戻らない時は停止ゲートが継続する。通信断後のfloor解放自動再試行は追加しない。
