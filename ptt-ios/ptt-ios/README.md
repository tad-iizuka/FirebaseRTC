# PTTClient (iOS)

ptt-server(token-server) / ptt-client(Web) / ptt-android と同じバックエンドで動く
iOSクライアントです。Firebase認証(Googleサインイン)・招待制ルームの作成/参加・
LiveKit経由のPTT音声・送話ロック・BAN・テキストチャットまで実装しています。

> **2026-07-25改訂について**: 本READMEは長らく「WebSocket直結 +
> AudioPipeline(AVAudioEngine + swift-opus)で音声の送受信を自前実装している」
> という**LiveKit移行前(〜2026-06-21頃)の構成**のまま更新されておらず、実装と
> 乖離していた。この乖離が原因で、ブラッシュアップ計画側で「ジッターバッファ
> 未実装」という誤った判断がなされていた。本改訂で現行のLiveKitベース実装に
> 合わせて全面的に書き直している。

## ファイル構成

- `ptt_iosApp.swift` — Appエントリポイント。Firebase初期化、
  `AVAudioSession`を`.playAndRecord`/`.voiceChat`で設定、Googleサインインの
  リダイレクトURL処理
- `ContentView.swift` — メイン画面(サインイン / ルーム作成・参加フォーム /
  PTTボタン / 参加者一覧・BAN操作 / チャット / ログ)
- `PTTAuthManager.swift` — Firebase Auth経由のGoogleサインインと、
  token-server呼び出し用のID Token供給・自動リフレッシュ
- `PTTRoomManager.swift` — token-serverの`POST /rooms`(ルーム作成)・
  `POST /rooms/:roomId/join`(招待コードでの参加)を呼ぶ招待制ルーム管理
- `PTTConnectionManager.swift` — LiveKit Swift SDKの`Room`オブジェクトを
  生成・接続し、PTTボタンのオン/オフに合わせて
  `localParticipant.setMicrophone(enabled:)`を呼ぶ橋渡し役。送話ロックAPI
  (`/talk/start` `/talk/heartbeat` `/talk/stop`)の呼び出しと、LiveKitの
  Room Metadata(`currentTalker`)の購読もここで行う
- `PTTModels.swift` — UI表示用の接続状態・参加者情報の型定義のみ
  （シグナリングメッセージの型はLiveKit移行により不要になった）
- `PTTBanStore.swift` — 自分のroleの取得とBAN状態のFirestoreリアルタイム監視
- `PTTChatStore.swift` — テキストチャット(Phase5)。送信はtoken-server経由、
  配信・履歴はFirestoreリアルタイムリスナー
- `PTTOnboardingStore.swift` / `PTTOnboardingView.swift` — 初回起動時の
  スワイプ形式チュートリアル(Web版`OnboardingFlow.vue`と同じ構成)
- `PTTSavedRoomsStore.swift` — 直近作成/参加したルームをUserDefaultsに
  ローカル保存(uidごとに分離)
- `Color+Tokens.swift` — `shared/design-tokens.css`・Android版
  `PTTColors.kt`と同期させるカラートークン定義
- `Localizable.xcstrings` — 多言語化(ja/en)

## 依存パッケージ (Swift Package Manager)

Xcodeが`Package.resolved`から自動解決しますが、主要な直接依存は以下の通りです
（間接依存のgRPC/Protobuf/Firebase関連ライブラリ等は省略）。

| パッケージ | リポジトリ | バージョン | 用途 |
|---|---|---|---|
| LiveKit Swift SDK | `livekit/client-sdk-swift` | 2.15.1 | 音声の送受信・エンコード/デコード・ジッターバッファ・再接続を内部で処理 |
| Firebase iOS SDK | `firebase/firebase-ios-sdk` | 12.15.0 | `FirebaseAuth`(Googleサインイン連携)・`FirebaseFirestore`(チャット/BAN状態の監視) |
| GoogleSignIn-iOS | `google/GoogleSignIn-iOS` | 9.2.0 | Googleサインインのネイティブフロー |

`alta/swift-opus`への依存、および自前のOpusエンコード/デコード処理は
LiveKit移行に伴い**廃止済み**です。

## Xcodeへの組み込み手順

1. Firebase Consoleから`GoogleService-Info.plist`をダウンロードし、
   プロジェクトに追加する（リポジトリには含めない）
2. 上記3パッケージをXcode → File → Add Package Dependencies… から追加する
3. マイク権限の説明文はビルド設定の`INFOPLIST_KEY_NSMicrophoneUsageDescription`
   で既に設定済み。追加のInfo.plist編集は基本的に不要
4. Googleサインインのリダイレクトを受けるため、`Info.plist`の
   `CFBundleURLTypes`にFirebase ConsoleのiOSアプリ設定にある
   `REVERSED_CLIENT_ID`を登録する（Firebaseコンソールの手順に従う）

## 動作の仕組み(現行実装)

1. **サインイン**: `PTTAuthManager`がFirebase Auth経由のGoogleサインインを
   行い、以降のtoken-server呼び出しに必要なID Tokenを供給する
2. **ルーム作成/参加**: token-serverは招待制(invite_only)のため、
   `PTTRoomManager`が`POST /rooms`または`POST /rooms/:roomId/join`
   （招待コード検証）を呼び、先にルームのメンバーになってから接続する
3. **接続・PTT**: `PTTConnectionManager`が`Room(delegate: self)`を生成し
   LiveKit Cloudに接続する。接続直後はマイクを無効化しておき、PTTボタン
   押下時に送話ロックAPI(`/talk/start`)取得後にのみ
   `setMicrophone(enabled: true)`する。**音声のエンコード/デコード・
   ジッターバッファ・パケットロス補完・タイムストレッチはすべてLiveKit
   （内部はWebRTC/libwebrtc）に委譲されており、アプリ側で音声フレームを
   直接扱うコードは存在しない**
4. **送話ロック**: サーバー(`token-server/routes/talk.js`)側のFirestore
   トランザクションで排他制御を強制する。ロック状態はLiveKitのRoom
   Metadataにも同期され、`RoomDelegate.didUpdateMetadata`経由で全クライ
   アントにリアルタイム伝播する
5. **BAN**: `PTTBanStore`が`rooms/{roomId}/members/{uid}`をFirestoreで
   リアルタイム監視する。実際の強制力はLiveKit側の即時Kick
   （サーバーの`RoomServiceClient.removeParticipant`）が担い、UI側の
   表示はあくまで補助
6. **チャット**: `PTTChatStore`がFirestoreの`rooms/{roomId}/messages`を
   リアルタイム購読する。送信は必ずtoken-server経由(LiveKitのData
   Channelは使わない。理由: モデレーション・途中参加者への履歴配信・
   BAN時の読み取り遮断ができないため)

## 動作確認方法

1. 実機で起動（マイクの実機テストはシミュレータでは制限があるため実機推奨）
2. 起動後、Googleサインインを行う
3. 「トークンサーバーURL」「LiveKit URL (wss://)」欄はデフォルト値が
   入っているため、通常は変更不要
4. ルームを新規作成するか、招待コードを入力して参加する
5. PTTボタンを押下している間だけ発話でき、別クライアント（Web版など）を
   同じルームに参加させて実際に声が届くか確認する

## 既知の制約・次の改善ポイント

- **バックグラウンド動作**: `Info.plist`の`UIBackgroundModes`に`audio`は
  設定済みだが、実機でのバックグラウンド送受話継続は未検証（詳細は
  `brushup-plan.md` Phase9参照）
- **通報UI・録音操作UI**: 未実装（Web版のみ）。Phase9でWeb版の実装を
  移植予定
- **音質・低遅延**: LiveKit(WebRTC/NetEQ)に委譲済みのため、アプリ側での
  追加実装は基本的に不要。品質チューニングが必要になった場合は、自前の
  バッファ実装ではなくLiveKit SDKの接続オプション(adaptiveStream・
  dynacast等)を見直すこと
