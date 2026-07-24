# PTTClient (iOS) — Step A + Step B: 接続・制御メッセージ・音声(Opus)送受信

ptt-server / ptt-client(Web) と同じプロトコルで動く iOS クライアントです。
WebSocket接続・join/leave・ptt_start/ptt_end・送話中リスト表示に加えて、
**マイク取得 → Opusエンコード → 送信 / 受信 → Opusデコード → 再生** まで実装しています。

## ファイル構成

- `PTTClientApp.swift` — Appエントリポイント
- `ContentView.swift` — Web版 index.html と同等のUI（接続フォーム / PTTボタン / 送話中リスト / ログ）
- `PTTConnectionManager.swift` — WebSocket接続・JSON制御メッセージ・バイナリ(Opus)フレームの送受信を管理する ObservableObject。内部で `AudioPipeline` を保持し、`joined` 受信時に自動でオーディオパイプラインを起動する
- `PTTModels.swift` — サーバーとやり取りするJSONメッセージの型定義 (`join` / `joined` / `member_joined` / `talker_start` など)
- `AudioPipeline.swift` — `AVAudioEngine` によるマイク取得・Opusエンコード/デコード・再生。`alta/swift-opus` に依存

## 依存パッケージの追加 (Opus)

1. Xcode → File → Add Package Dependencies…
2. URL: `https://github.com/alta/swift-opus`
3. Dependency Rule: `Up to Next Major Version` を選び `0.0.2` を起点に指定
   （タグが古い場合はビルドエラーになることがあるため、その場合は `Branch: main` に切り替えてください）
4. Add to Target: `PTTClient` を選択し、ライブラリ名 `Opus` を追加

## Xcodeへの組み込み手順

1. Xcode → File → New → Project → iOS → App
   - Product Name: `PTTClient`
   - Interface: SwiftUI / Language: Swift
   - Minimum Deployments: **iOS 17**
2. プロジェクト作成後、デフォルトで入っている `ContentView.swift` と
   `<ProductName>App.swift` をこのリポジトリのファイルで上書き（または追加）。
3. `PTTConnectionManager.swift` / `PTTModels.swift` / `AudioPipeline.swift` をプロジェクトに追加
   （File → Add Files to "PTTClient"...）。
4. 上記の手順でOpusパッケージを追加。

## Info.plist の設定（マイク権限）

`Info.plist` に以下のキーを追加してください（追加しないとマイク取得時にクラッシュします）。

```xml
<key>NSMicrophoneUsageDescription</key>
<string>音声のプッシュトゥトークのためにマイクを使用します</string>
```

Xcodeの「Info」タブから `Privacy - Microphone Usage Description` を追加するのでも構いません。

ws:// (非TLS) のサーバーで試す場合は、`NSAppTransportSecurity` → `NSAllowsArbitraryLoads: true` も必要です。
Cloud Run の `wss://` を使う場合は不要です。

## 動作確認方法

1. シミュレータ or 実機で起動（**マイクの実機テストはシミュレータでは制限があるため、実機推奨**）
2. サーバURL欄に Cloud Run の `wss://...` URL（Web版で使っているものと同じ）を入力
3. ルームID・クライアントIDを入力して「接続する」
4. 初回接続時にマイク権限のシステムダイアログが出るので許可する
5. 接続が成立すると `joined` を受信し、`AudioPipeline.start()` が自動的に呼ばれてオーディオグラフが起動します
6. 別クライアント（Web版など）を同じルームに参加させ、PTTボタンを押し合って実際に声が届くか確認してください

## 実装上の要点

- サーバー(`server.js`)と同じ音声フォーマット (48kHz / mono / 20msフレーム=960サンプル) に固定しています。
- `AVAudioEngine.inputNode.installTap` でマイクのハードウェアフォーマットから48kHz/mono/Float32への変換を行わせています。
- マイクから来る可変長バッファを960サンプル単位にスライスしてOpusエンコードしてから送信しています（サーバーのフレームサイズに一致させる必要があるため）。
- 受信したOpusバイナリフレームは `Opus.Decoder.decode(_:)` で `AVAudioPCMBuffer` に変換し、`AVAudioPlayerNode` にスケジュールして再生しています。
- PTTボタンの押下/解放は `PTTConnectionManager.startTalking() / stopTalking()` に集約し、JSON制御メッセージ(`ptt_start`/`ptt_end`)の送信とAudioPipelineの送信開始/停止を同時に行います。

## 既知の制約・次の改善ポイント

- 複数人が同時に喋った場合のサーバー側ミキシングには対応していますが、クライアント側の再生はサーバーから来た1本のOpusストリームをそのまま再生するだけなので追加対応は不要です。
- バックグラウンド時の動作（Background Modes → Audio, AirPlay, and Picture in Picture）は未設定です。バックグラウンドでも送受話を継続したい場合は `Info.plist` の `UIBackgroundModes` に `audio` を追加し、`AVAudioSession` の設定を見直してください。

