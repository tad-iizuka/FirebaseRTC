# Debug PCM / RTP観測（SDK 2.17.0）

追加処理はすべて #if DEBUG。Releaseの送話処理には含まれない。既存PTTStart traceを再利用し、PTTMedia trace=<UUID>と紐付ける。受信端末はPTTを押さなくてもtrace=room-<generation>で入室中の音声track統計を記録する。

## 項目

- enable_before / enable_after / periodic（約1秒） / mute_before / mute_after（またはmute_failed） / exit。
- 単調uptime_ns、Room SID、local participant SID、remote participant SID、track SID、Room connection状態、track muted、subscription。
- AVAudioSession category/mode/input/output route、AudioManager isEngineRunning/isMicrophoneMuted。
- 共有capture-post PCM：callbacks、frames、samples（frames×channels累計）、last_pcm_ns、最新bufferの第1channel RMS。Float32/Int16対応。RMS/Peakは0〜1に正規化（Floatは範囲外をclip、Int16は32768で正規化）。最大8channel、1024フレーム/channelかつ4096scalar samples/buffer。その他形式、空buffer、非有限値は未計測。音声保存なし。
- 公開SDK Track.statisticsのaudio outbound/inbound：stats_id、ssrc、packets/bytes、stats_timestamp_us。SDKが約1秒周期で更新するキャッシュであり、その瞬間の強制getStatsではない。

## 安全性・限界

PCM callbackではtry-lockのみ。競合時は集計を捨て、待機しない。上限付き計算だけでログ・ファイルI/O・Task起動なし。callbacks/framesは取得できた分の集計であり、欠落なしの厳密カウントではない。

観測開始はfloor取得後、enable直前。送話start/stop経路に新しいawaitなし。stats timer有効化は独立Task。mute/release、retry、再起動、track cleanup、SDK内部変更なし。観測のdetach/cancelのみ追加。古い観測は捕捉Roomだけを読む。Releaseでは追加処理がコンパイルされない。

観測はDebugでも負荷ゼロではない。renderer登録はSDKの共有capture後delegateを有効にするため、観測版と未観測版の再現率差を確認する。PCMを取得できても非無音の実マイク入力、特定sender由来、相手での再生を証明しない。

ADM内部recordingフラグ、AVAudioSession実active値、失敗publicationがない旧senderのstats/CID対応、音声内容、最終RTP送出時刻は公開APIでは未計測。SDKネイティブログを補助にする。statsがnil/未更新、publicationなし、短いpressは未計測。mute直前/直後も古いキャッシュの場合があるので必ずstats_timestamp_usを比較。

stats timerはDebugの入室中に有効化され、SDK自身のRoom切断cleanupで停止される。アプリの観測TaskとPCM rendererはmute後/退出時に停止。statsとログの時刻は異なる時計なのでstats_timestamp_usとuptime_nsを直接減算しない。端末A/Bの単調時刻も直接減算しない。

## 比較手順

1. A/B別UID、同RoomでDebug版起動、PTTBuild sdk=2.17.0確認。Bも同じ観測版を使用。
2. 正常/不達の各pressをPTTStart idとPTTMedia traceで抽出。受信BはAのtrack SID、B自身のRoom世代traceで対応させる。
3. 送話表示後に5秒以上識別語を発声。callbacks/samples増分、last_pcm時刻、発声に応じたRMSを比較。
4. 同じtrack SID/SSRC/stats_idの異なるstats_timestampでpacketsSent/bytesSent増分を比較。nilや同じtimestampは未計測とする。
5. Bのsubscribedとinbound packetsReceived/bytesReceived増分、実音声確認を照合。SSRCはSFUで変わり得るためA/BのSSRC一致を要求しない。
6. 解放時mute_before/after、既存mute_complete→talk_stop_complete順序確認。RTP増加だけで音声内容や音声漏れを断定しない。
7. 自分だけ/既存参加者あり、事前publish成功/timeoutを分ける。観測版でtimeout率が変わった場合も記録する。

## 検証

iOS26.5 Simulator Debugビルド成功。既存PTT安全性24 tests / 4 suites成功（TEST SUCCEEDED）。ログ /tmp/ptt-media-observation-final2.log。Releaseビルド、実機PCM/RTP取得、実機の再現率比較は未実施。UI全テストは今回再実行していない。

## PCM形式観測の更新

sample_format/sample_rate/channel_count/samples_per_frame（channel数）/bytes_per_frame/interleavedを記録。最新bufferのrms/peakと、前回snapshotから今回までのwindow_rms/window_peakを記録。window_measured_buffers/window_non_silent_buffers（Peak>0.0001）/window_unsupported_buffersで区別する。閾値は音声活動検出ではなく信号の有無の目安。windowはsnapshotごとにリセットし、PCM累計はtrace内で維持。

RTPコードは変更なし。送話中の同じSID/SSRC/stats_idで、stats_timestamp_usが増加した2記録を選ぶ。差分は後値−前値。timestampが同じ/逆転、値欠落、counter減少、SSRC変更、送話中の異なる時刻の2値がない場合は判定不能。古いキャッシュを送信停止の証拠にしない。

更新後の検証：Debug iOS26.5 Simulatorでビルド成功、既存24テストを含む28 tests / 5 suites成功。形式別テストはFloat32の無音/信号、Int16の無音/正負最大値、Float32/Int16 stereoのinterleaved/non-interleaved stride、Float64未対応、空buffer、Float範囲外clip/NaNを検証。ログ /tmp/ptt-pcm-level-tests.log。実機のPCM形式と発声音量は次の採取で確認する。

## AudioEngine lifecycle (Debug only)

`[PTTEngine]` records SDK 2.17.0 public `AudioEngineObserver` events:
`did_create`, `will_enable`, `will_start`, `did_stop`, `did_disable`, `will_release`.
`event_uptime_ns` is callback entry time; `engine_id` is object identity (not retained).
Input/playout flags are callback arguments, not proof of actual capture. Will-events
are intent notifications, not successful completion. `observer_result` preserves the
existing chain return code. Object addresses may be reused after release.

The app has no other `set(engineObservers:)` registration. Debug installation once at
app initialization preserves the actual SDK `audioSession` and `mixer` instances in
that order. All lifecycle calls forward once and return the next observer's result;
Output graph callbacks retain SDK default forwarding. Input callbacks also forward unchanged, then observe only the supplied existing input node. The SDK exposes a setter
but no observer-list getter: if custom observers are added later, this installation
must be reviewed rather than blindly replacing their list.

No engine properties or VP/AudioUnit getters are read in callbacks. Existing input node bus formats are read only in the input-setup lifecycle callback, after the SDK observer chain returns. Logging and AudioSession reads are
scheduled on MainActor; `snapshot_uptime_ns` is the later snapshot time. Category,
mode and route must not be treated as callback-time values. No engine is captured by
the logging task. `context_generation`/`context_trace` are the most recent app context
at event time, not native-engine ownership (which is `未計測`). A bounded history of
128 context changes prevents old events being assigned to newer context. Events
predating retained history are unmeasured. Global engine events during old cleanup
and new preparation cannot by themselves establish which Room caused the event.

Compare event timestamps with `[PTTConnection]`, `[PTTPublish]`, `[PTTMedia]` and
native ADM/VP logs, grouping engine identities between create and release. Compare
successful preparation versus timeout, then the next PTT enable and nonzero/zero PCM.
`voice_processing_actual_mute` and `adm_recording` remain unmeasured: logical SDK
mute flags and observer input arguments do not prove hardware/VP capture state.
No forced unmute, restart, retry or cleanup is added. Device validation remains needed.


## iOS入力経路の追加観測（公式バイナリを維持）

`will_connect_input`ではSDKのworker threadで既存observerへ一度転送し、同じ戻り値を返す。
転送が成功し、srcが既存AVAudioInputNodeである場合だけ、bus数を確認してbus 0の
inputFormat/outputFormatを読む。これらはAVAudioNode公開の非throwing形式取得APIであり、
SDKも同じセットアップ地点で出力形式を取得する。形式取得は設定の読み取りであり、
PCM callbackでは実行しない。engine.inputNodeへのアクセス、新規node生成、tap、接続変更なし。
getterを別スレッドへ持ち出さない。実機での内部遅延・例外を完全に保証するものではない。

`input_format`はハードウェア側、`output_format`は入力nodeからグラフへの形式。
`valid_configuration`は有限かつ正のsample rate/channel countを意味し、実マイク信号の証明ではない。
ゼロ/不正形式、busなし、srcなし、型未対応、observerエラーによる取得スキップを区別する。
APIには通常のthrowによる取得失敗通知がないため、値や前提条件を状態として記録し、
ObjC例外をSwiftのtryで捕捉できるとは扱わない。
`source_id`/`destination_id`はSDKが渡したsource/接続先の識別子。
Mixerが中間nodeを挿入するため、直接接続の証明にはならない。追加の接続グラフgetterは実行しない。

Engine世代はdid_createごとに加算し、will_releaseで識別子との対応を終了する。
アドレス再利用を同一Engineと誤認しない。最大16識別子、イベントbufferは64件。
コンテンションは待たず捨てる。buffer満杯はoverflowを記録。500ms周期で最大8件をMainActorから排出し、
callback内にTask・print・ファイルI/Oを追加しない。欠落した作成イベントの世代は未計測となり得る。
ライフサイクル・session通知のログは有界。既存PCM/RTP timerと単調時刻は維持。

Session interruption(type/options)、routeChange(reason)、mediaServicesWereReset、
application input mute changeを値だけbufferへ渡す。通知threadではgetterを実行しない。
category/mode/currentRoute/isInputAvailableとapplication_input_mutedはMainActor上で後から取得し、
event_uptime_nsとsnapshot_uptime_nsを分ける。通知のpayload時点とsnapshotの状態は異なる場合がある。
通知値欠落・未知値はそのまま未計測/数値とし、推測で補完しない。通知observerはアプリ寿命で一度登録。
Room generation/traceはイベント時刻のcontextであり、グローバルEngine/sessionの所有権は未計測。

AVAudioApplication.isInputMutedはiOS17以上の公開read-only getter。
このアプリ全体の入力muteであり、OS全体/hardware/VPのmuteではない。
公開SDKヘッダーではサンプルをゼロにするアプリ単位muteと説明される。
本アプリにsetInputMuted呼び出しはなく、観測はMainActorに限定。古いOSは未計測。
実VP mute、AudioUnitの実録音稼働、AVAudioSession実active値は取得しない。

### 実機比較
1. 同じ入力ルートで入室→準備完了→一定の言葉を2〜3秒発声→解放→退出。
2. 試行順、PTT trace、事前publish結果、オレンジ表示の有無、受信端末の受聴結果を対応付ける。
3. timeout後のengine_generationとwill_connect_inputの形式を正常時と比較する。
4. input_available、application_input_muted、route/interruption/reset通知を時刻付きで比較する。
5. PCM RMS/PeakとRTPの異なるstats_timestamp値を照合。取得不能・同じcache timestampは判定不能。
6. 正常な形式・route・input_availableだけなら「入力設定確認」。
   APM後PCM非ゼロでも共有Mixer由来であり「物理マイク取得確定」としない。
   ゼロPCM/表示なしとの組み合わせを追加証拠として扱う。

SDK依存・本番動作・talk start/stop・mute/floor順序は変更しない。
測定処理はDebugのみ。観測あり/なしで再現率が変化する可能性は残る。
