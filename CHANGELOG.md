# Changelog

> **運用上の注記**: このリポジトリのコミット履歴は`update`/`fix`/`add`と
> いった簡潔なメッセージが中心で、セマンティックバージョニング（v1.2.3等）
> によるタグ付けも行っていません（実態は`CONTRIBUTING.md`「Commit Message」
> 参照）。そのため本ファイルは、`brushup-plan.md`の各訂（改定）・Phase完了
> 記録を根拠に、実装単位でのAdded/Changed/Fixedをまとめる形式にしています。
> 厳密なリリースバージョンではなく「まとまった変更のマイルストーン」として
> 読んでください。

## Unreleased

### Added

- **Phase14: Firebase App Check導入**（token-server・ptt-client・
  admin-dashboard・ptt-ios・ptt-android全対応）。詳細な設計判断は
  `DECISIONS.md`2026-08-13参照
  - `token-server`: `middleware/requireAppCheck.js`新設。
    `X-Firebase-AppCheck`ヘッダーを`admin.appCheck().verifyToken()`で検証し、
    `server.js`にグローバルミドルウェアとして追加（`/webhooks`・
    `/internal`・ヘルスチェックは対象外）。環境変数`APP_CHECK_ENFORCE`
    （既定`false`）によるsoft-enforce運用とした
  - `ptt-client`/`admin-dashboard`: `lib/firebase.ts`に
    `initializeAppCheck`（reCAPTCHA v3プロバイダ、開発時はデバッグ
    トークン自動有効化）を追加。`lib/api.ts`の`authedFetch`に
    `X-Firebase-AppCheck`ヘッダー付与を追加。`firebaseConfig`に
    `appId`（`VITE_FIREBASE_APP_ID`、既定値あり）を明示追加。
    admin-dashboardには専用のFirebaseアプリ登録が無いため、ptt-client
    （「FirebaseRTC」アプリ）のreCAPTCHA v3キーを共用する方針とした
    （詳細は`DECISIONS.md`2026-08-13「App Checkプロバイダの割り当て方針」
    参照）。`.github/workflows/web-deploy.yml`・`admin-deploy.yml`の
    ビルドステップに`VITE_APP_CHECK_RECAPTCHA_SITE_KEY`
    （GitHub Actions Variables `APP_CHECK_RECAPTCHA_SITE_KEY`から注入）
    を追加
  - `ptt-ios`: `PTTAppCheckProvider.swift`新設（実機App Attest／
    シミュレータはDebugProviderへフォールバック）。Xcodeプロジェクトに
    `FirebaseAppCheck`（firebase-ios-sdk）のSPM製品参照を追加。8ファイル・
    17箇所の`URLRequest`組み立て箇所にヘッダー付与を追加
  - `ptt-android`: `firebase-appcheck-playintegrity`依存を追加。
    `appcheck/PTTAppCheckProvider.kt`新設（Play Integrityプロバイダ）。
    8ファイル・17箇所の`Request.Builder`組み立て箇所にヘッダー付与を追加

### Changed

- `brushup-plan.md`を整理し、初訂〜七十一訂の全改定履歴と「6.1 完了済み
  アクション」を`brushup-plan-history.md`へ分離（4,400行超→385行）。今後は
  Phase単位の実装内容を本ファイル、設計判断を`DECISIONS.md`に集約し、
  `brushup-plan.md`本体は現状サマリと現在有効な次アクションのみを保持する
  運用に変更（詳細は`DECISIONS.md`2026-08-11参照）

### Fixed

- Room Schedule機能: 保存済みルームへの再入室時、schedule状態の再取得
  (`GET /rooms/:roomId/recording/status`)が失敗した場合に即座に
  `in_session`とみなしてしまい、実際にはbefore_start/after_endだった
  Roomへ誤って接続を試み、token-server側の403エラーがそのままユーザーに
  露出する不具合をiOS/Android双方で修正。最大3回・3秒間隔で再試行する
  ように変更した（詳細は`DECISIONS.md`2026-08-12参照）

---

## Phase 16 — PWA化・チャット添付・Room Schedule拡張（〜2026-08-10）

### Added

- Webクライアント（`ptt-client`）のPWA化：`manifest.json`・`sw.js`（App
  Shellのみキャッシュ）・専用アイコン一式
- チャット添付ファイル（画像・動画・PDF）送受信（Web版のみ）
- 招待リンク／QRコードによるRoom参加（生成: admin-dashboard、読み取り:
  3クライアント共通の`/r?room=...&code=...`ルート）
- Room開始/終了時刻（Schedule）機能（Web版・admin-dashboard先行実装、
  その後iOS/Android版へも移植）
- チャットUIのLINE風バブル化・アバター表示・URLハイパーリンク化
- iOS/Androidのタブレット幅3ペインレイアウト

### Changed

- iOS版のLiquid Glass系UI（カスタムタブバー・`.glassEffect()`等）を標準
  コンポーネント（`TabView`・`.regularMaterial`）へ回帰
- iOS CI（`ios-ci.yml`）のシミュレータ選択ロジックを
  `IPHONEOS_DEPLOYMENT_TARGET`ベースの絞り込みに修正

### Fixed

- Web版ヘッダー表示の不具合
- Android版チャットの`withStyle`未import参照エラー
- iOS版`AttributedString`の型推論エラー（`.foregroundColor`/`.underlineStyle`）

---

## Phase 13 — バッジシステム基本機能（2026-07-26〜2026-08-04）

### Added

- バッジマスタ・付与記録のFirestoreスキーマ（団体単位管理は将来拡張、
  当面は単一マスタ構成）
- Owner手動によるバッジ付与・剥奪UI（token-server・Web・admin-dashboard、
  その後Room owner向けUIも追加）
- Guestの役割バッジ（他参加者からも視認可能な形で解消）

---

## Phase 12 — role×操作の対応表整理（2026-07-26〜2026-08-03）

### Added

- `token-server/lib/permissions.js`：Room内role（owner/moderator/member/
  guest）×操作の対応表を一元化
- `scripts/check-role-sync.js`・CI（`role-sync-check.yml`）：サーバー側
  対応表とクライアント側の複製定義との同期を機械的に検証

### Changed

- `routes/rooms.js`・`routes/recording.js`に個別ハードコードされていた
  ホワイトリスト分岐を`lib/permissions.js`参照に統一

---

## Phase 11 — 組織階層（Long-Term Architecture）導入（2026-07-26）

### Added

- `organizations`/`organizations/{orgId}/nodes`：Company/Branch/Site
  （警備業）・Community/Group（一般）を任意の深さの再帰ツリーとして表現
- `token-server/routes/organizations.js`・`lib/orgContext.js`
- admin-dashboard `OrganizationsView.vue`：団体・nodeツリー管理画面
- Room詳細画面での組織階層表示・割り当て変更UI

### Known limitations

- Room作成時の組織階層への自動紐付けは行わない（意図的、`DECISIONS.md`
  2026-07-26参照）
- admin-dashboardのRoom一覧の階層フィルタはサーバー側未実装（読み込み
  済みページ内のみ）

---

## Phase 10 — Guestロール（2026-07-25）

### Added

- Firebase匿名認証によるGuest参加、サーバー側での自動role判定
- `PATCH /rooms/:roomId/nickname`：本人によるニックネーム変更
- 3クライアント共通の「ゲストとして参加」ボタン・Guestバッジ表示

### Out of scope（意図的）

- Guest→Member昇格導線（`DECISIONS.md`2026-07-25参照）

---

## Phase 9 — Phase1（警備業）の完成度向上（2026-07-25）

### Fixed

- `ptt-ios/ptt-ios/README.md`をLiveKit移行後の実装内容に合わせて書き直し
  （ジッターバッファ誤判断の直接原因だった旧記述を訂正）

### Added

- iOS/Android版への通報UI・録音開始/停止UI（Web版の設計を移植）

---

## Phase 5〜8 — 管理者ダッシュボード・運用機能（〜2026-07-24）

### Added

- テキストチャット機能（`routes/messages.js`、3クライアント共通）
- LiveKit Webhookの受信・記録（`routes/webhooks.js`）
- 監査ログ・moderator任命API・録音ファイル一覧/ダウンロードAPI
- Firestore/GCSのデータライフサイクル管理（TTL・アーカイブ）
- `admin-dashboard`のVue 3 SPA化（旧`dev-tools/admin-dashboard.html`から刷新）

---

## Phase 1〜4 — 基盤構築（初期実装）

### Added

- Firebase Authenticationによるサインイン、招待制ルーム作成・参加
- 送話ロック（PTT排他制御）、BAN機能
- LiveKit連携（音声送受信）、録音Egress
- オンボーディング画面、多言語化（i18n ja/en）、デザイントークン統一
