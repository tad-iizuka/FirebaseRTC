# 招待リンク／QRコード対応 設計案

対象: `tad-iizuka/FirebaseRTC`（アップロードZIP、HEAD=`a1dbc89`）
作成日: 2026-08-05

## 0. 要件（確認済み）

- 参加者は現在、Room IDと招待コードを**手入力**でRoom参加している（`ptt-client`/iOS/Android共通）
- これを簡単にするため、以下2機能を追加する
  1. **生成側**: admin-dashboardの招待コード表示箇所（Room作成直後・Room詳細画面）で、
     招待リンク（と、そのQRコード）を生成できるようにする
  2. **読み取り側**: そのリンク（またはQR）を開くと、Room ID・招待コードの入力欄が
     **自動入力される**（自動参加はしない）。3クライアント（Web/iOS/Android）全てで対応する
- リンク方式は **https URL（Universal Link / App Link）を主軸**とする
- QR読み取りは、OS標準カメラでのスキャン（Universal Link任せ）に加え、
  **アプリ内QRスキャナーも実装する**

## 1. 現状コード確認（今回の設計の前提）

- ルーム作成は`admin-dashboard`専用（`rooms:create`権限）。`ptt-client`は参加専用画面
  （`RoomSelectView.vue`）で、Room IDと招待コードの2テキスト欄→`joinRoom`のみ
- 招待コードは`RoomDetailView.vue`で`rooms:manage`権限保有者が「表示」ボタンを押した
  時のみ取得され、都度`token-server`側で監査ログに記録される（`GET .../invite-code`）。
  作成直後は`RoomsListView.vue`の`rooms.lastCreatedRoom.inviteCode`にも一度だけ表示される
- iOS/Androidとも、独自URLスキーム・Universal Link/App Linkの設定は**未導入**
  （iOS側にあるのはGoogleサインイン用のリダイレクトスキームのみ）
- QR生成・QR読み取りライブラリはいずれの3クライアントにも未導入

## 2. リンク形式

```
https://join.<ドメイン>/r?room=<roomId>&code=<inviteCode>
```

- **要決定事項**: このURLをホストするドメイン。`admin-dashboard`・`ptt-client`のどちらかの
  実運用ドメイン配下に`/r`のようなパスを切るか、専用サブドメインを用意するか。
  Universal Link (iOS) / App Link (Android) はドメイン単位で紐付けるため、
  実際にデプロイされているホスティング先（Firebase Hosting等、本リポジトリ外の設定）が
  確定してから最終決定する。本設計では仮に`join.<ドメイン>`と表記する
- クエリパラメータ名は短く`room`/`code`とし、招待コード自体の文字種（現行仕様の
  英数字等）はそのまま使う。roomIdやinviteCodeにURLエンコードが必要な文字は
  想定されないが、エンコード処理は入れる
- 有効期限はURL自体には持たせない。招待コードのライフサイクル（Room解散等）に
  そのまま追従する既存仕様を踏襲するのみで、リンク発行によって新たな失効管理は増やさない

### なぜhttps主軸か（カスタムスキームを主にしない理由）

- カスタムスキーム（`ptt://`）は未インストール時に何も起きず、QRを読んだ相手が
  アプリを持っていない場合に詰む。https URLならブラウザで開けて、後述の
  Web側`/r`ページが「アプリで開く」導線とWeb版フォールバックの両方を提供できる
- Universal Link/App LinkはOS標準カメラでQRを読んだ場合でも、ドメイン所有権を
  検証済み（`apple-app-site-association`/`assetlinks.json`）であればブラウザを経由せず
  直接アプリを開ける。カスタムスキームの二重登録は不要と判断する

## 3. 生成側（admin-dashboardのみ）

### 3.1 変更箇所

- `admin-dashboard/src/views/RoomDetailView.vue`（招待コード表示欄）
- `admin-dashboard/src/views/RoomsListView.vue`（作成直後の`lastCreatedRoom`表示欄）

いずれも**招待コードが既に画面上に存在する（＝権限チェック済み・取得済み）状態**でのみ、
その隣に以下を追加する。新規のtoken-server APIは不要（既存の`inviteCode`値からURLを
組み立てるだけのクライアント側処理のため）。

- 「招待リンクをコピー」ボタン（`https://join.<ドメイン>/r?room=...&code=...`をクリップボードへ）
- 「QRコードを表示」ボタン → クリックでQR画像をモーダル表示（ダウンロード可）

### 3.2 QR生成ライブラリ

- `qrcode`（npm, MIT）を`admin-dashboard`に追加。`<canvas>`または`<img>`へSVG/PNGとして
  描画。サーバー往復不要でクライアント内完結

## 4. 読み取り側（3クライアント共通）

### 4.1 Web (`ptt-client`)

- ルーターに公開ルート`/r`を追加（`requiresAuth`なし）。`RedirectJoinView.vue`（仮称）を新設し、
  クエリの`room`/`code`を読み取って`sessionStorage`等の一時領域に保存後、
  `/`（`RoomSelectView`）へ`replace`遷移する
  - 未サインインの場合はまず`AuthView`が描画される（既存の`App.vue`の分岐に乗る）。
    サインイン完了後に`RoomSelectView`がマウントされた時点で一時領域を読み、
    `joinRoomId`/`joinInviteCode`に反映してから領域をクリアする（**`handleJoinRoom`は呼ばない**）
- Universal Linkとして`https://join.<ドメイン>/r?...`を開いた場合、iOS/Androidに
  アプリがインストールされていればアプリ側が奪って処理するため、Web側の`/r`は
  「アプリ未インストール」または「PCブラウザ」からのアクセス時のフォールバックとして機能する

### 4.2 iOS (`ptt-ios`)

- Xcode: Associated Domains capability に `applinks:join.<ドメイン>` を追加
- サーバー側（Web側ホスティング）に`/.well-known/apple-app-site-association`を配置
  （Team ID + Bundle ID の申告が必要。本リポジトリ外の対応も伴う）
- `ptt_iosApp.swift`の`.onOpenURL`に加えて、Universal Link受信用の
  `.onContinueUserActivity(NSUserActivityTypeBrowsingWeb)`ハンドラを追加し、
  `room`/`code`クエリを抽出。参加画面（Web版`RoomSelectView`相当の画面）に
  Published prop等で受け渡し、テキストフィールドへ反映するのみで**自動参加はしない**

### 4.3 Android (`ptt-android`)

- `AndroidManifest.xml`の`MainActivity`に`android:autoVerify="true"`付きの
  `intent-filter`（`https://join.<ドメイン>/r`）を追加
- サーバー側に`/.well-known/assetlinks.json`を配置（署名証明書のSHA-256指紋が必要）
- `MainActivity`で`intent.data`からクエリを取得し、参加画面のViewModel/Stateへ
  受け渡してテキスト欄に反映。同じく自動参加はしない

### 4.4 アプリ内QRスキャナー（3クライアント追加実装）

要件どおり、OS標準カメラ任せに加えてアプリ内スキャナーも実装する（カメラ権限が
新規に必要になる点は要案内）。読み取った文字列は上記と同じURLパース処理に通し、
**同じ「入力欄への反映のみ」の経路**に合流させることで、二重実装を避ける。

| プラットフォーム | ライブラリ案 |
|---|---|
| Web | `jsQR` または `@zxing/browser`（`getUserMedia`でカメラ映像取得→デコード） |
| iOS | `AVFoundation`の`AVCaptureMetadataOutput`（追加ライブラリ不要、標準API） |
| Android | ML Kit Barcode Scanning（`com.google.mlkit:barcode-scanning`） |

- カメラ権限: iOSは`Info.plist`に`NSCameraUsageDescription`追加、Androidは
  `CAMERA`権限のランタイムリクエストが必要（いずれも現状未導入）
- スキャナーの起動導線: 参加画面（Room ID/招待コード入力欄の近く）に
  「QRコードを読み取る」ボタンを追加し、モーダルでカメラプレビューを表示する形を想定

## 5. セキュリティ・プライバシー面の確認

- 招待コードをURL/QRに載せることによる露出は、既存の「コードを口頭・チャットで
  共有する」運用と本質的に同等（コード自体の強度・失効管理は変更しない）
- **自動参加はしない**という要件により、QRを第三者に見られても「入力欄が埋まるだけ」で
  即参加はされない。誤ってスキャンした場合の被害を抑えられる
- URLをブラウザ履歴・チャットログに残したくない場合の配慮（ワンタイム化等）は
  今回のスコープ外。必要であれば別途「リンクの使い捨て化」を検討課題として記録する

## 6. 実装フェーズ案

1. **Phase A（生成側）**: admin-dashboardにリンク生成・QR表示を追加（サーバー変更なし）
2. **Phase B（Web読み取り側）**: `ptt-client`に`/r`ルート・入力欄への反映ロジックを追加
   （ドメインが未確定でも`window.location`のクエリ受け渡しまでは実装・検証可能）
3. **Phase C（ドメイン確定・Universal/App Link設定）**: ホスティングドメイン確定後、
   `apple-app-site-association`/`assetlinks.json`を配置し、iOS/Androidにcapability追加
4. **Phase D（アプリ内QRスキャナー）**: 3クライアントへカメラベースのスキャナーを追加

Phase A・Bはドメイン確定を待たずに着手可能です。Phase Cはインフラ側の情報
（実際のホスティングドメイン、iOS Team ID、Androidの署名鍵SHA-256）が必要なため、
先に確認させてください。

---

どこから着手しますか？ Phase A（admin-dashboardのリンク/QR生成）から始めるのが
依存関係上もっとも早く着手できます。
