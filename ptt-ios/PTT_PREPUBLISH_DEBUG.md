# 事前publish診断ログ（LiveKit 2.15.1）

2026-10-08。SDK内部・PTT排他・初期化・publish方式・cleanupは変更しない。

## 記録

Debugビルドで公開API LiveKitSDK.setLoggerを使い、選択したSDK debugメッセージを `[PTTSDK]` に単調時刻uptime_ns付きで出す。Frame watcher、Waiting for audio frame、Completers for add track、resolving completer for cid、Fast publish mode、publish success/failed、Transportのnegotiation/状態関連を対象とする。その他は従来相当のinfoレベルへ渡す。ReleaseではSDK loggerは変更しない。SDKメッセージにRoom識別子がない行は、同時処理がある場合、時刻だけでRoomを確定しない。

`[PTTPublish]` は接続世代UUID、Room参照、SDK connectionState、Room/participant SID、current_room、task_cancelled、track参照・SID・isMuted・trackState・publishState、publication一覧を記録する。

stageはroom_connect_begin/complete、track_created_mute_begin、mute_complete_publish_begin、publish_complete_before_result、publish_failed、microphone_enable_begin/complete（開始trace ID付き）、disconnect_requested_no_prepare_task_cancel、disconnect_complete。

SDK公開APIではmediaTrack.trackId（CID）、rtpSender、transceiverは取得できない。cid=SDK_log_only、sender/transceiver=not_publicと明示する。SDK応答のresolving completer for cidでCIDを得る。SDK内部反射や内部アクセスは追加しない。track SID=nil、publication辞書が空でもサーバー・PeerConnectionに残存なしとは断定しない。

診断用track参照はweak。失敗後に解放されればnilになる。状態比較は失敗直後のログを正とする。参照IDは生存中の識別用で、解放後には再利用され得る。SDK CID/SID・世代も併用する。

## 試験

1. Debugビルドで接続前から退出後まで全ログを保存する。10入室程度の通常試験と、事前publish中退出を別に記録する。既存音声初期化やmuteを変えない。
2. mute_complete_publish_beginからpublish_failed/completeまでuptime_nsの差を算出。SDKログのFrame watcher timeoutかadd track timeoutを対応させ、throw元を確定する。Waiting for audio frameの後に約5秒でFrame watcher timeoutならframe待ち。SDK詳細ログがない既存ログではまだ未確定。
3. 失敗直後のtrack state、SID、辞書を保存。初回押下のenable begin/completeと比べ、新track・新SIDの追加か確認する。CIDはSDK応答ログと突き合わせる。
4. publication辞書だけで二重publishなしと判定しない。残存sender/transceiverは公開API制限によりこの追加ログだけでは全数取得できない。必要に応じLLDBで停止してSDK内部を読み取り確認するか、LiveKitサーバーのRoom参加者track一覧を同時取得する。後者は取得権限と接続先設定が必要。新しいcleanupは追加しない。
5. publish中に退出し、旧世代のpublish完了／失敗、current_room=false、SDK connectionState、disconnect_completeを照合。Task.cancelは今回追加しておらずtask_cancelled=falseも想定される。結果反映直前のログから、旧Room結果が成功フラグに反映され得る競合を確認する。異なるRoomの時刻を混同しない。

## 現時点の判定

新ログはまだ実機から未取得。timeoutの正確なthrow元、失敗直後の実track状態、sender残存、サーバー登録残存、二重publish、退出時競合は未確認。前回ログの約5秒とSDKの5秒Frame watcher待ちが整合することは仮説である。

SDKコード上はtimeoutでwaitがthrowし、_publishのcatchがtrack.stopしてrethrowする。終了済みpublishが後から成功へ復帰する構造ではない。一方、サーバー応答やdebounce negotiationを自動撤回する保証はない。

Frame watcher原因が確定すれば、公式SDKでのミュートpublish readiness対応を確認するのが候補（準備検出を弱めると初回に待ちが移る）。残存が確定すれば該当CID/SIDの整合した失敗cleanupが候補（他の正常trackの誤停止に注意）。退出競合が確定すれば世代による結果反映制限が候補（Task.cancelだけで通信撤回を保証しない）。いずれも未実装。

診断ログは同期printを含み、debug時の所要時間に影響し得る。従来性能と直接比較して劣化と断定しない。

## WebRTCネイティブログの追加（2026-10-08）

Debug専用PTTPublishSDKLoggerが、SDK公開APIのOSLogger(minLevel: .info, rtc: true, ffi: false)を1個保持し、WebRTCの既存ネイティブログを転送する。SDK内部・音声設定・rendererは変更しない。

Xcodeコンソール／macOS Consoleのsubsystem `io.livekit.sdk`、category `WebRTC`を含めて保存する。`[PTTSDK]`だけのフィルタではこのログが消える。

優先する照合文字列：`WebRtcVoiceSendChannel::MuteStream: APM:1`、`ADM:1`、初回押下時の`APM:0`／`ADM:0`、`AudioRtpSender::OnChanged`。ネイティブログはUnified Logging時刻を持つがPTTのuptime_nsやRoom世代を自動付与しない。単一Roomの試験を優先し、別スレッドの表示順だけで因果を決めない。APM:1は入力PCMそのものの停止を証明するものではない。

SDK側のミュートフレーム待機を解除する変更、一時unmute、無条件retry、cleanupは追加していない。新しいネイティブログの実機測定はまだ取得していない。

## 接続世代修正後のログ（2026-10-09）

接続・退出の世代管理を追加。旧診断記録の `disconnect_requested_no_prepare_task_cancel` は今後 `disconnect_requested_prepare_task_cancel` となる。`PTTConnection` のprepare_begin/exit_invalidated/prepare_task_complete/cleanup_completeでtoken取得前の退出と終了barrierも記録する。診断ログと寿命管理の詳細は `PTT_CONNECTION_LIFECYCLE.md` を参照。SDK2.15.1・事前mute/publish方式・個別sender cleanupなしは維持する。
