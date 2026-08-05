# 招待リンク／QRコード対応 実装まとめ

設計は `deeplink-qr-join-plan.md` 参照。ここでは実装内容と反映手順のみをまとめる。

## 反映方法

各zipは対応するディレクトリの中身をそのまま含んでいます。既存のディレクトリへ
上書き展開してください（`ptt-client-updated.zip` → `ptt-client/`、以下同様）。
`firebase.json`はリポジトリ直下に上書きしてください。

- `ptt-client-updated.zip`
- `admin-dashboard-updated.zip`
- `ptt-ios-updated.zip`
- `ptt-android-updated.zip`
- `firebase.json`

## 生成側: admin-dashboard

`RoomDetailView.vue`（Room詳細）・`RoomsListView.vue`（作成直後）の招待コード表示箇所に、
「招待リンクをコピー」「QRコードを表示」ボタンを追加しました（`InviteLinkQr.vue`）。
リンク先ホストは`VITE_PTT_CLIENT_ORIGIN`環境変数で上書き可能です（未設定時は
`https://fir-rtc-de1f4.web.app`）。新規のtoken-server APIは追加していません
（既存の招待コード取得フロー・権限チェック・監査ログをそのまま使う設計のため）。

`npm install`（`qrcode`追加）→ `npm run build` 済み・成功確認済みです。

## 読み取り側: ptt-client (Web)

- `/r?room=...&code=...` を新規ルートとして追加。開くとRoom ID・招待コードを
  入力欄へ反映するだけで、**自動参加はしません**
- 「QRコードを読み取る」ボタンからアプリ内スキャナー（`jsqr`使用、カメラ映像を
  直接デコード）も利用できます

`npm install`（`jsqr`追加）→ `npm run build` 済み・成功確認済みです。

## Firebase Hosting: Universal Link / App Link用ファイル

- `ptt-client/public/.well-known/apple-app-site-association`
  （iOS Team ID `MTP6LLLBBQ`、Bundle ID `co.ubunifu.ptt-ios`）
- `ptt-client/public/.well-known/assetlinks.json`
  （Android package `co.ubunifu.pttandroid`、**現在はdebugキーストアのSHA-256指紋**。
  本番用キーストアを別途作る場合は、その指紋を配列に追加してください。1つの
  `assetlinks.json`に複数の指紋を並記できます）
- `firebase.json`のignore/headersを修正し、上記2ファイルがdotfile除外ルールに
  巻き込まれず、`Content-Type: application/json`で配信されるようにしました

**デプロイ後の確認方法**:
- iOS: `https://search.developer.apple.com/appsearch-validation-tool/` または
  `https://<ホスト>/.well-known/apple-app-site-association` に直接アクセスして
  JSONが返ることを確認
- Android: `https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://fir-rtc-de1f4.web.app&relation=delegate_permission/common.handle_all_urls`
  で検証、またはAndroid Studioの「App Links Assistant」

## iOS

- `ptt-ios.entitlements`を新規作成し、Associated Domains
  (`applinks:fir-rtc-de1f4.web.app`)を追加。`project.pbxproj`の
  メインターゲットDebug/ReleaseへCODE_SIGN_ENTITLEMENTSを設定済み
- `ptt_iosApp.swift`の`onOpenURL`で、Googleサインインのリダイレクトでなければ
  招待リンクとしてパースを試みる方式に変更（Universal LinkはSwiftUIの
  `onOpenURL`で受信可能なため、`onContinueUserActivity`は不要でした）
- `PTTPendingInviteStore.swift`（シングルトン）で`ContentView`へ橋渡し
- `ContentView.swift`: 入力欄への反映処理、「QRコードを読み取る」ボタン、
  `QRScannerView.swift`（AVFoundationベースのアプリ内スキャナー）を追加
- `INFOPLIST_KEY_NSCameraUsageDescription`をビルド設定に追加（カメラ権限の説明文言）

**確認できていない点**: このサンドボックスにXcodeが無いため、コンパイル確認は
できていません。zipを展開してXcodeで開き、ビルドが通ることの確認をお願いします。
特に`project.pbxproj`は手動編集(Python)で行ったため、Xcode側で問題なく認識されるか
（プロジェクトナビゲータでentitlementsファイルが正しく紐づいているか等）は
実機・シミュレータでの確認が必要です。

## Android

- `AndroidManifest.xml`: `CAMERA`権限追加、`MainActivity`に
  `android:launchMode="singleTask"`と`autoVerify="true"`のApp Link intent-filter
  （`https://fir-rtc-de1f4.web.app/r`）を追加
- `MainActivity.kt`: `handleIntent()`/`onNewIntent()`でリンクを検出し、
  `PTTApp`へ`pendingInvite`として渡す
- `PTTApp.kt`: `pendingInvite`を受け取り`LaunchedEffect`で入力欄へ反映。
  「QRコードを読み取る」ボタンを追加
- `invite/InviteLink.kt`（パース）・`invite/QrScannerDialog.kt`
  （CameraX + ML Kit barcode-scanningによるアプリ内スキャナー）を新規作成
- `build.gradle.kts`にCameraX・ML Kit barcode-scanningの依存を追加

**確認できていない点**: Android StudioでのビルドもこのサンドボックスではGoogleの
Mavenリポジトリへアクセスできず検証できていません。Gradle同期・ビルドの確認を
お願いします。

## 動作確認の観点（お手元での確認をお願いしたい項目）

1. `firebase deploy --only hosting:client`後、`.well-known`の2ファイルが
   正しいContent-Typeで配信されているか
2. admin-dashboardのRoom詳細画面でQRコードを表示し、スマホのカメラで読み取ると
   ptt-client（インストール済みならアプリ、未インストールならブラウザ）が開き、
   Room ID・招待コードが入力欄に入るか（**参加ボタンは押されない**こと）
3. iOS/Androidアプリ内の「QRコードを読み取る」ボタンからのスキャンでも同様に
   入力欄に反映されるか（カメラ権限ダイアログが出ることも含め）
4. Android実機の署名鍵をリリース用に切り替えた際、`assetlinks.json`への
   指紋追加を忘れないこと（現状はdebug鍵のみ登録済み）
