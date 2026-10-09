# SDK 2.17.0評価：PTT enableと解放の競合検証

2026-10-09。評価ブランチのみ。本番SDK・Firestore・事前publish・音声初期化は変更しない。

## コードから確認した順序

- startTalkingは直列キューを待ち、Room、物理押下、要求tokenを確認してtalk/startを実施する。
- talk/start成功後にも再確認する。取得中に解放した場合はenableを実施しない。
- setMicrophone(true)のawait中に解放/退出しても、SDKの処理終了・キャンセルを仮定しない。
- enable正常完了後に再度Room、押下、tokenを確認する。無効なら同じ捕捉Roomをmuteし、送信中UIとheartbeatを開始しない。
- stopTalkingは直列キューでstartの終了を待ち、再muteしてからtalk/stopを実行する。mute失敗時はRoom切断後にtalk/stopへ進む。
- 退出cleanupも旧startの終了を待ち、旧Roomのmute（失敗時はdisconnect）後に発話権解放を行う。新接続準備はcleanupを待つ。
- 連続押下は古いstart/stopと直列化され、古いstopが新しい取得後に権利を解放しないようにする。

## 今回の変更

PTTConnectionManager.swiftにTalkOperations(request/enable)とwaitForTalkOperationsを追加。未注入時は既存HTTP・SDK呼出しを維持。mute/disconnectは既存ConnectionOperationsの同じライブ既定実装を経由する。テストはSDKの実マイクを有効化せず、locked/enabled状態をモックで記録する。
既存のenable完了後チェック、muteと発話権解放の順序、排他制御は変更しない。

## 追加した5試験

1. releaseBeforeEnableSkipsEnable：取得awaitをゲートで停止し、解放してから取得結果を返す。enableなし、最終mute/解放。
2. releaseDuringEnableRemutesBeforeReleasingLock：enable awaitを停止し解放。遅いenable完了後に直接mute→キューmute→権利解放、最終enabled=false。
3. releaseImmediatelyAfterEnableMutesBeforeReleasingLock：正常enableと送信UI完了直後に解放。mute→解放。
4. nextPressWaitsForPreviousMuteAndRelease：最初のmuteを停止し次を押下。旧mute/解放より前に新取得しない。
5. exitDuringEnableDrainsLateCompletionBeforeReentry：enableを停止、退出・再入室要求、旧enable完了。旧Roomのmute/解放/cleanup後に新Room、古い送信UI反映なし。

全enableでlocked=true、全権利解放でenabled=falseをアサートする。ゲートは任意のsleepで競合窓を狙わず、明示的到達/再開で時系列を固定する。

## 限界

これらは実際のmanager制御を実行するが、SDK/HTTPをモックへ置き換える。SDKが本当にmuteするか、RTP停止、SFU状態、相手側の音声は証明しない。
正常なawait完了時の状態を検証する。SDKが無期限に戻らない場合や、サーバー発話権TTL中の長時間停滞は保証対象外。
解放→遅いenable完了→再muteの短い区間自体は既存方式に残る。最終的にenabled=falseという合格と、解放後の音声が一切届かないという合格を混同しない。
今回の未検証：enable失敗・mute失敗を含む複合競合、強制停止、実SDK完了直後からMainActor再開までの区間、実機RTP/受信音声。

## 実行結果

iOS Simulator iPad (A16) / iOS 26.5でビルド・unit test成功。
Swift Testing: 17 tests / 3 suites成功（既存publish世代試験は2パラメーターケース）。追加5試験すべて成功。UIテストは今回対象外。
ログ: /tmp/ptt217-talk-race-tests.log
xcresult: /tmp/ptt-sdk-2-17-build/Logs/Test/Test-ptt-ios-2026.10.09_10-28-10-+0900.xcresult
初回iOS 26.0指定はテストターゲット最低26.5のため実行前に終了。26.5へ変更して成功。ソースの最低バージョン変更はしていない。
git diff --check成功。

