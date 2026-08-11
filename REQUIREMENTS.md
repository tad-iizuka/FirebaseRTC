# Requirements

> 本ドキュメントは、README.md の Vision（「人ではなく場（Room）につながる」）を
> 前提に、`brushup-plan.md`（実コード検証済みの現状整理）の内容を基に
> 2026-08-11 時点の実装状況を反映して記述したものです。テンプレート作成時
> （2026-07-17）は見出しのみの空欄でしたが、実装がPhase16まで進んだ現時点の
> 内容で書き起こしています。チェック状態は `brushup-plan.md`「1. 実コード
> 確認済みの現状」の機能差表と一致させています。

## Overview

サービスの目的は、電話（Person→Person）ではなく「場（Room）」を介したリアル
タイムコミュニケーションを提供すること。個人間の永続的な関係（友達登録・
電話番号交換）を前提とせず、目的を共有する人が一定期間だけ集まり、目的が
終われば自然に解散できる体験を実現する。

対象プラットフォームは Web（`ptt-client`）・iOS（`ptt-ios`）・Android
（`ptt-android`）の3クライアントと、運用者向けの `admin-dashboard`。
バックエンドは `token-server`（Express / Cloud Run）が全ての権限判定・状態
変更を一元的に担い、リアルタイム音声・イベント配信は LiveKit（WebRTC）に
委譲する。

Target Roadmap（README.md）に沿い、現在は Phase 1（警備業）を土台として
Phase 2（イベント運営・展示会・自治体等のビジネスチーム）へ拡張する段階
にある。

---

## Functional Requirements

### Authentication

- [x] Firebase Authentication によるサインイン（Google等のIDプロバイダ）
- [x] Firebase匿名認証によるGuestとしての参加（`sign_in_provider: anonymous`
      をサーバー側で判定し `role: 'guest'` を自動付与。クライアントの自己
      申告には依存しない）
- [x] 招待コードによるルーム参加（`POST /rooms/:roomId/join`）
- [ ] Guest認証自体の招待制化（匿名認証ボタン自体は誰でも押せる。招待コード
      を先に入力させてから認証させる順序への変更は未着手。詳細は
      `brushup-plan.md` 5.4「Guest認証自体の招待制化」参照）

### User

- [x] メンバー（Member）: メールアドレスによる本人確認、削除しない限り永続
- [x] Guest: 匿名認証、1招待コード＝1Room限定、Member昇格は対象外（実装
      しない方針で確定済み）。GuestとMemberは常に別ID・別記録として扱う
- [x] ニックネーム変更（本人のみ、30文字以内、リアルタイム反映）
- [ ] ユーザー×団体の所属関係（「誰がどの団体に属するか」）の設計・実装
      （Phase11で意図的にスコープ外とした。`phase11-org-roster-design.md`
      で後追いの設計検討中。詳細は該当ドキュメント参照）

### Room

- [x] ルーム作成（招待コード自動発行）・招待コードによる参加
- [x] BAN機能（即時LiveKitキック含む）
- [x] 送話ロック（排他制御、PTT本体）
- [x] moderator任命/降格API（owner本人のみ実行可）
- [x] 自動録音トグル（`autoRecording`設定、Web版のみ）
- [x] Room開始/終了時刻（Schedule）機能：開始前は入室のみ可（待機画面）、
      終了後はチャット閲覧専用（Web版・admin-dashboardのみ実装、iOS/Android
      は未対応）
- [x] Room の組織階層（Company/Branch/Site等）への割り当て（Room作成とは
      分離。admin-dashboardから運用者が事後に手動で行う）
- [ ] 組織階層への自動紐付け（意図的に非対応。Room First原則を優先し
      当面実装しない）

### Voice

- [x] Push-to-Talk（送話ロックによる排他制御）
- [x] LiveKit（WebRTC）経由の低遅延音声伝送。ジッターバッファ・パケット
      ロス隠蔽はLiveKit内部のNetEQに委譲し、自前実装は行わない（判断の
      経緯は `brushup-plan.md` 2-D参照）

### Text

- [x] テキストチャット（`token-server`経由での書き込み一本化＋Firestore
      リアルタイム配信、BAN即時反映と同じモデレーション強制パターン）
- [x] チャットUI（アバター表示・URLハイパーリンク化、LINE風バブルUI）

### Images

- [x] 画像・動画・PDF添付（Web版のみ）: 短命なGCS署名付きアップロードURL
      経由でアップロード後、通常のチャットAPIでメッセージ化
- [ ] iOS/Android版の添付UI（未実装。テキスト送受信のみ対応）

### File Sharing

- [x] Web版の添付ファイル送受信は画像・動画・PDFに対応（上記Imagesと同一
      機能。汎用ファイル種別の拡大は未検討）

### Presence

- [x] 参加者一覧（Room内メンバー、現在の送話者・録音状態はLiveKit Room
      Metadata経由でリアルタイム反映）
- [x] 自分自身のGuestバッジ表示
- [x] 他参加者のバッジ表示（Phase13バッジ機能の一部として解消済み。Guestの
      役割バッジ含む）

### Notification

- [ ] プッシュ通知（Phase14で着手予定、未着手）
- [x] Web版のPWA化（Service Workerによるアプリシェルのキャッシュ、Web
      Pushはスコープ外）

### AI

- [ ] AI Participant（README.mdのParticipant Model上は「Human/AI/Botを
      同一概念として扱う」設計方針のみ確定しており、実装は未着手）
- [ ] AI通訳・AI議事録・AIサマリー等（Future Featuresとして記録のみ、未着手）

---

## Non Functional Requirements

### Performance

- 音声の低遅延伝送はLiveKit（WebRTC）に委譲。自前でのレイテンシ数値目標
  （msオーダーの具体的なSLO等）は本ドキュメント作成時点では未策定
- Web/admin-dashboardともビルド時に`vue-tsc`による型チェックと`vite build`
  を必須化し、型エラー・ビルドエラーによる実行時パフォーマンス劣化を防止

### Availability

- token-serverはCloud Run上で稼働（`gcloud run deploy`、`asia-northeast1`）。
  具体的な稼働率目標（SLA）は未策定
- Room終了時刻を過ぎたRoomの強制退出はCloud Scheduler等の定期実行に依存
  するが、実際のジョブ設定状況はコードからは確認できておらず要確認事項
  として残っている（`brushup-plan.md`「6. 次アクションの提案」item 7）

### Scalability

- Firestoreのコレクション設計はRoom単位の非正規化を基本とし、Room数の
  増加に対して水平にスケールする設計（詳細は`DATA_MODEL.md`参照）
- 具体的な同時接続数・Room数の目標値は未策定

### Reliability

- LiveKit Webhookの受信はベストエフォート（Firestoreへの書き込み失敗時も
  Webhook自体には200を返し、LiveKit側の再送ループを妨げない設計）
- Room終了時刻経過時の強制退出処理は`expiredAt`フィールドによる冪等性を
  担保（重複実行されても副作用が起きない設計）

### Security

- 全APIエンドポイントで`Authorization: Bearer <Firebase ID Token>`を必須
  とし、Admin SDKでの検証を経ずにクライアント自己申告のuidを信用しない
  （例外は`POST /webhooks/livekit`のみ、LiveKit独自の署名検証に置き換え）
- Firestoreへのクライアント直接書き込みは全面的に禁止（`firestore.rules`）。
  状態変更は必ずtoken-server経由（Admin SDK）
- role×操作の対応表を`token-server/lib/permissions.js`に一元化（Phase12）。
  クライアント側の複製定義との同期はCI（`role-sync-check.yml`）で機械的
  に検証
- 詳細は`SECURITY.md`参照

### Privacy

- README.mdの Core Principle「Privacy First」に基づき、電話番号・LINE
  交換・本名を必須としない設計（Memberはメールアドレスのみ必須、Guestは
  匿名認証でメールアドレスすら不要）
- Room解散後もGuest参加記録・ID情報は削除しない（監査目的）が、Member
  については本人の退会申請または管理者削除によりメールアドレスのみの
  削除も可能

---

## Out of Scope

今回は対象外（意図的に見送り、または優先度の関係で着手条件待ちのもの）

- Guest→Member昇格導線（GuestとMemberは常に別ID・別人物として扱う方針で
  確定済み。将来的な再検討の予定なし）
- 業界ラベリング層（i18nキー構造の「言語×業種プロファイル」拡張）：
  Phase2の具体的な要件が確定するまで着手条件待ち（Phase15）
- バッジマスタの団体単位・業種プロファイル単位での複数マスタ管理：
  Phase13では団体IDを持たないシンプルな1マスタ構成に限定し、Phase15へ
  持ち越し
- Firebase App Check導入・自動テスト/E2Eテストの本格拡充（Phase14、未着手）
