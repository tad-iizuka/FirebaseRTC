# PTTClient (Android) — Phase 3: Android対応

`ptt-ios`(iOSクライアント)と同じプロトコル・同じtoken-server/Firebaseプロジェクトで
動くAndroidクライアントです。Googleサインイン・招待制ルームの作成/参加・
LiveKit経由の音声送受信・PTTボタン・送話中リスト・テキストチャットまで、
iOS版と同等の機能をKotlin + Jetpack Composeで実装しています。

## ファイル構成

```
app/src/main/java/co/ubunifu/pttandroid/
  PTTApplication.kt              … Firebase初期化 (ptt_iosApp.swiftのFirebaseApp.configure()に相当)
  MainActivity.kt                … Google Sign-InのIntent起動・マイク権限リクエスト・Compose起点
  model/PTTModels.kt              … 接続状態・参加者・チャットメッセージのデータクラス (PTTModels.swiftに相当)
  auth/PTTAuthManager.kt          … Firebase Auth + Googleサインイン (PTTAuthManager.swiftに相当)
  room/PTTRoomManager.kt          … ルーム作成/招待コード参加のtoken-server呼び出し (PTTRoomManager.swiftに相当)
  room/PTTSavedRoomsStore.kt      … 最近使ったルームのローカル保存 (PTTSavedRoomsStore.swiftに相当)
  connection/PTTConnectionManager.kt … LiveKit接続・トークン取得・PTTのマイクON/OFF (PTTConnectionManager.swiftに相当)
  chat/PTTChatStore.kt            … Firestoreリアルタイムリスナーによるチャット履歴・送信 (PTTChatStore.swiftに相当)
  ui/PTTApp.kt                    … 画面全体のCompose UI (ContentView.swiftに相当)
```

## 依存関係

`app/build.gradle.kts` に以下を追加済み:

- `io.livekit:livekit-android` — LiveKit Android SDK ([client-sdk-android](https://github.com/livekit/client-sdk-android))
- `com.google.firebase:firebase-auth-ktx` / `firebase-firestore-ktx`
- `com.google.android.gms:play-services-auth` — Googleサインイン
- `com.squareup.okhttp3:okhttp` — token-serverへのHTTPリクエスト

**[注意]** LiveKit Android SDKはバージョンによってイベントAPIの细部が変わることがある。
`PTTConnectionManager.kt`は2.x系の `Room.events`(`Flow<RoomEvent>`)を購読するスタイルを
前提にしているため、実際に依存させたバージョンのサンプルアプリ・リリースノートと
突き合わせてから導入すること。

## セットアップ手順

### 1. Firebase Consoleでの設定

1. iOS版と同じFirebaseプロジェクト(`fir-rtc-de1f4`、または後継プロジェクト)に、
   Android アプリを追加する(パッケージ名: `co.ubunifu.pttandroid`)。
2. ダウンロードした `google-services.json` を `app/` 直下に配置する
   (`.gitignore` 済みなのでリポジトリには含まれない。iOS版の `GoogleService-Info.plist` と同じ扱い)。
3. Firebase Console > Authentication > Sign-in method > Google の
   「ウェブSDK構成」からWebクライアントIDを取得し、
   `app/src/main/res/values/strings.xml` の `default_web_client_id` に設定する。
   直書きせず `local.properties` / Secrets Gradle Plugin等での管理を推奨。

### 2. マイク権限

`AndroidManifest.xml` に `RECORD_AUDIO` 権限を宣言済み。実行時権限は
`MainActivity` が起動時にリクエストする(iOS版の `NSMicrophoneUsageDescription` に相当)。

### 3. ビルド

Android Studio で `ptt-android/` をプロジェクトとして開き、Gradle Syncを実行する。
実機推奨(エミュレータではマイクの実機テストに制限があるため、iOS版と同じ注意点)。

### 4. 動作確認方法

1. アプリを起動し、初回はマイク権限ダイアログを許可する。
2. Googleでサインインする。
3. 「トークンサーバーURL」「LiveKit URL」を確認(デフォルトはiOS版と同じ本番Cloud Run/LiveKit Cloud)。
4. 「新しいルームを作成する」または「招待コードで参加する」でルームに入る。
5. 別クライアント(Web版/iOS版)を同じルームに参加させ、PTTボタンを押し合って
   実際に声が届くか確認する。

## 実装上の要点

- LiveKit Android SDKの `Room` オブジェクトがマイク取得・エンコード/デコード・
  送受信・再生を全て代行するため、`PTTConnectionManager` は「トークン取得 →
  Room接続 → マイクのON/OFF」の橋渡し役に留まる(iOS版と同じ設計)。
- 送話中インジケーターは `RoomEvent.TrackMuted` / `TrackUnmuted` をそのまま使う。
  自前の `ptt_start`/`ptt_end` JSONメッセージは使わない。
- チャットの書き込みは必ずtoken-server経由(`POST /rooms/:roomId/messages`)、
  配信・履歴表示はFirestoreのリアルタイムリスナー(`addSnapshotListener`)に任せる。
  LiveKitのData Channelは使わない(モデレーション・履歴配信・BAN時の読み取り遮断が
  できないため。Web版/iOS版と同じ理由)。
- ルームは招待制(`invite_only`)。ルームIDの直接入力による接続は行わず、
  `POST /rooms` または `POST /rooms/:roomId/join` を必ず経由する。
- PTTボタンは `Modifier.pointerInput` + `detectTapGestures(onPress = ...)` で
  押下/解放を検知し、`tryAwaitRelease()` で「離された」タイミングを取得している
  (Web版の `touchstart`/`touchend`、iOS版の `DragGesture(minimumDistance: 0)` に相当)。

## 既知の制約・次の改善ポイント(iOS版と共通)

- 送話ロック(`token-server/routes/talk.js` の `/talk/start` 等)はまだAndroid側から
  呼び出していない。現状は複数人が同時にマイクを有効化できてしまうため、
  Web版と同じ排他制御をUIに組み込む場合は `PTTApp.kt` の `TalkArea` から
  `/rooms/:roomId/talk/{start,heartbeat,stop}` を呼ぶ処理を追加する必要がある。
- BAN・通報機能のUIは未実装(iOS版でも同様に未実装)。追加する場合は
  Web版(`ptt-client/public/index.html`)の `banParticipant`/`reportParticipant` を参考に、
  `myRole` の取得(`rooms/{roomId}/members/{uid}` の読み取り)とBANリアルタイム監視
  (`addSnapshotListener`)を実装する。
- バックグラウンドでの送受話継続には非対応。`AndroidManifest.xml` に
  `FOREGROUND_SERVICE_MICROPHONE` 権限は宣言済みだが、実際のフォアグラウンドサービス化
  (通知の表示・`Service`の実装)はまだ行っていない。
- ネットワーク状況によるジッターバッファ等の音質チューニングはLiveKit SDKの
  デフォルト挙動に任せている。
