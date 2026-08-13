# Design Decisions

> `brushup-plan.md`および各Phase設計メモ（`phase*.md`）から、実装方針に
> 影響した主要な意思決定を時系列で抽出したものです。日々の実装判断の
> 全てを網羅するものではなく、後から「なぜこうなっているか」を追える
> ようにすることを目的としています。新しい重要な決定はこのファイルの
> 末尾に追記してください。

## 2026-07-09

### Decision

Roomを中心モデルとする（Friendモデルを採用しない）

### Reason

個人間の関係ではなく、期間限定のコミュニケーションを重視するため
（README.md Core Principle「Room First」「Temporary Relationships」）。

### Alternatives

- Friendモデル：SNS的な個人間フォロー/フレンド関係を中心に据える案
- Channelモデル：Discordのような恒久的なチャンネル構造を中心に据える案

### Result

採用（Room First）。以後の全機能はRoomを主語として設計する。

---

## 2026-07-25

### Decision

音声のジッターバッファは自前実装しない

### Reason

3クライアントとも LiveKit（内部はWebRTC/libwebrtc）経由で音声の送受信・
再生を行っており、WebRTCの音声エンジン（NetEQ）が適応型ジッターバッファ・
パケットロス隠蔽・タイムストレッチを標準で備えているため。旧`ptt-ios`
READMEにLiveKit移行前（自前WebSocket+AVAudioEngine時代）の記述が残って
おり、これを根拠に「未実装」と誤判断していたことが発覚し訂正した。

### Alternatives

- 自前でジッターバッファを実装する
- WebRTC/NetEQの挙動を信頼し実装しない

### Result

実装しない。誤判断の再発防止のため、根拠となった`ptt-ios`READMEをLiveKit
移行後の実態に合わせて書き直した。

---

## 2026-07-25

### Decision

GuestロールにMember昇格導線を設けない

### Reason

GuestIDと他ID体系（Member）を紐付けると、監査ログ上「継続」として扱う
べきか「別人物」として扱うべきかの整合性判断が複雑化する。Guestは匿名
認証由来で本人確認がないため、昇格を許すとなりすまし・権限昇格の抜け道
になり得る。

### Alternatives

- Guest→Member昇格APIを実装し、GuestIDをMemberIDに引き継ぐ
- 昇格導線を設けず、GuestとMemberを常に別ID・別記録として扱う

### Result

昇格導線は実装しない。GuestIDは生成された状態のまま保持し、`promotedFrom`
等の紐付けフィールドも持たせない。

---

## 2026-07-26

### Decision

Room作成と組織階層（Company/Branch/Site等）への紐付けを分離する

### Reason

Room作成時に組織階層へ自動で紐付ける機能を持たせると、「ユーザーがどの
団体に属するか」というユーザー×団体の所属関係の設計が前提として必要に
なり、Room First原則（作成の身軽さ）と衝突する。

### Alternatives

- Room作成時に作成者の所属団体を自動判定し紐付ける
- Room作成と組織階層への紐付けを分離し、必要なRoomのみ運用者が事後に
  手動で紐付ける

### Result

分離する方針を採用。Room作成は従来通りPTTクライアントから行い、紐付けが
必要なRoomのみadmin-dashboardのRoom詳細画面から管理者が事後に手動で行う。
ユーザー×団体の所属関係の設計は当面行わない（後に`phase11-org-roster-design.md`
で必要性が再浮上し、後追いで設計検討を実施）。

---

## 2026-07-26

### Decision

業界ラベリング層（i18nの「言語×業種プロファイル」拡張）をロードマップ
後方（Phase15）へ移動し、着手条件を「Phase2の具体的要件確定後」とする

### Reason

README.mdが定義する原則（実装は業界に依存させず、業界ごとの名称はUIだけ
変更する）としては正しいが、2つ目の業種（Phase2: イベント運営等）の実
要件が無いまま抽象化の軸を設計すると、後で作り直すリスクの方が高い。

### Alternatives

- Phase11直後に業界ラベリング層に着手する（ロードマップ原案通り）
- Phase2の要件確定を待ってから着手する

### Result

後者を採用。Phase1の実ユーザーに直接効く土台整備（組織階層・権限整理・
バッジ基本機能）をPhase11〜13として先に優先する。

---

## 2026-08-03（Phase12実装時）

### Decision

role×操作の対応表を`token-server/lib/permissions.js`に一元化し、
admin-dashboard向けのサイト管理者権限とは別軸として扱う

### Reason

Room内role（owner/moderator/member/guest）の権限チェックが
`routes/rooms.js`・`routes/recording.js`等に個別のホワイトリストとして
分散実装されており、role構成の変更時に全箇所を漏れなく追随させるのが
困難だった。一方、admin-dashboard向けのサイト管理者権限
（`adminUsers/{uid}.permissions`）はRoom内roleと無関係に付与される別軸の
権限であり、同じ対応表に混在させると設計意図が不明瞭になる。

### Alternatives

- 両者を1つの対応表に統合する
- Room内role用とサイト管理者権限用で対応表を分離する

### Result

分離する。`lib/permissions.js`はRoom内role専用とし、サイト管理者権限は
`middleware/requireAdmin.js`側で完結させる。クライアント側の複製定義との
同期はCI（`role-sync-check.yml`・`scripts/check-role-sync.js`）で機械的に
検証する（コード生成は行わず、差分検知のみ）。

---

## 2026-08-08

### Decision

タブレット幅レイアウト（iOS/Android）の実装に新規ライブラリを導入しない

### Reason

iOS版の`NavigationSplitView`、Android版の`material3-window-size-class`は
いずれもタブレット対応の標準的な選択肢だが、既存の画面構成・状態管理
との統合コストが見合わないと判断。

### Alternatives

- 標準ライブラリ（NavigationSplitView / material3-window-size-class）を
  導入する
- 既存の標準API（`horizontalSizeClass` / `LocalConfiguration.screenWidthDp`）
  のみで自前レイアウトを組む

### Result

後者を採用。iOS版は`horizontalSizeClass == .regular`、Android版は
`LocalConfiguration.screenWidthDp >= 600`を判定条件とし、入室中のみ3ペイン
レイアウトへ切り替える自前実装とした。

---

## 2026-08-09

### Decision

iOS版のLiquid Glass系実装（カスタムタブバー・`.glassEffect()`等）を標準
コンポーネントへ回帰させる

### Reason

HIG準拠・今後のiOSアップデートへの追従を優先。標準TabBar/標準マテリアル
に戻すことで、OS側の見た目変更に自動追従できる。

### Alternatives

- Liquid Glass系のカスタム実装を継続し、都度OSの変更に追従する
- 標準コンポーネント（`TabView`・`.regularMaterial`・`.bordered`系ボタン
  スタイル）へ回帰する

### Result

後者を採用。標準TabBarの背景レンダリング問題への追加対応として
`.preferredColorScheme(.dark)`も追加した。実機での見た目の最終確認は
本ドキュメント側では検証できないため引き続き次アクションとして残る。

---

## 2026-08-09

### Decision

Webクライアント（ptt-client）をPWA化する。Web Push通知は対象外とする

### Reason

インストール可能なApp Shell体験を提供する価値があるが、Push通知は
Phase14（通知基盤全体の設計）待ちであり、PWA化単体のスコープに含めると
設計が肥大化する。

### Alternatives

- PWA化と同時にWeb Push通知も実装する
- App Shellのキャッシュ（Service Worker）のみを先行実装し、Push通知は
  Phase14に切り出す

### Result

後者を採用。`public/sw.js`はApp Shellのみをキャッシュ対象とし、
Firestore/LiveKit/token-server（Cloud Run）へのリクエストは同一オリジン
判定により自然に対象外となる設計とした。

## 2026-08-11

### Decision

`brushup-plan.md`の運用方法を変更する。改定のたびに検証経緯を本文冒頭へ
逐語で積み増す運用をやめ、初訂〜七十一訂の全文と「6.1 完了済みアクション」
は`brushup-plan-history.md`へ分離・凍結する。以後、Phase単位の実装内容は
`CHANGELOG.md`、個々の設計判断は`DECISIONS.md`を一次情報とし、
`brushup-plan.md`本体は「現在のビジョンとの差分」「現在有効なロードマップ」
「現在有効な次アクション」のみを常に最新に保つ短い文書として運用する。

### Reason

`brushup-plan.md`は実装がPhase16まで進んだ時点で4,400行を超え、現在の状態を
把握するために膨大な過去の改定履歴を読み進める必要があった。一方で
`CHANGELOG.md`・`DECISIONS.md`・`API.md`・`DATA_MODEL.md`等、実コードを
根拠に書き起こした専門文書が七十一訂までにすでに整備されており、
`brushup-plan.md`の改定履歴が持っていた情報の多くはこれらと重複していた。

### Alternatives

- 現状維持（改定のたびに全文追記を継続する）
- 古い改定履歴を単純に削除する
- 改定履歴・完了アクションを別ファイルへ退避し、`brushup-plan.md`本体は
  現状サマリのみを保持する

### Result

3番目の案を採用した。監査証跡としての価値（検証の確度の違い、誤判断からの
訂正プロセスそのもの等、`CHANGELOG.md`/`DECISIONS.md`には残らない経緯）を
保存するため、削除ではなく`brushup-plan-history.md`への分離・凍結を選んだ。
`brushup-plan.md`本体の章立て（0〜6、5.1〜5.4等）は他の複数ドキュメントから
番号付きで参照されているため維持し、各章の内容のみを現状ベースに整理した。

## 2026-08-11（続き）

### Decision

ドキュメント巻き戻り事故（正規のコード変更コミットへ`brushup-plan.md`の
誤った巻き戻りが混在した事故）の再発防止策として、コミット分離や機械的
検知の仕組みは導入せず、運用ルールの変更のみで対応する。ルールは
「並行作業を行わない」「作業が並行した場合は必ず最新のドキュメントを
ベースに更新する」の2点。

### Reason

事故原因は並行作業によるドキュメントの巻き戻りだった。原因そのものを
運用ルールで断てば、コミット分離や行数急減の機械的検知といった追加の
仕組みを導入しなくても再発を防げると判断した。

### Alternatives

- ドキュメント更新用のコミットとコード変更用のコミットを分離する
- コミット前に主要ドキュメントの行数やリビジョン番号の急激な減少を
  機械的に検知する仕組みを導入する
- 運用ルールの変更のみで対応する（追加の仕組みは導入しない）

### Result

3番目（運用ルールの変更のみ）を採用。`brushup-plan.md`「6. 次アクション」
item2は完了として扱う。

## 2026-08-12

### Decision

Room Schedule機能で、保存済みルームへの再入室時（`GET /rooms/:roomId/
recording/status`によるschedule状態の再取得）にAPIリクエストが失敗した
場合のフォールバック挙動を、iOS/Android共通で「即座に`in_session`とみなす」
から「最大3回・3秒間隔で再試行し、それでも失敗した場合のみ`in_session`
とみなす」に変更する。

### Reason

実機確認で、Android版がbefore_start（開始時刻前）のRoomへ再入室する際に、
専用の待機画面ではなく通常の入室後画面がそのまま表示され、上に
「エラー: このルームはまだ開始時刻前です」という文言が重なって出る不具合が
見つかった。調査の結果、これはAndroid固有のUI実装漏れではなく、
`fetchRoomName`が何らかの理由（ネットワーク瞬断等）で失敗した場合に
`fetched?.scheduleState ?: ScheduleState.IN_SESSION`という行が
`in_session`にフォールバックし、before_start中のRoomへ誤って
`connect()`を試みてしまうことが原因と判明した。token-server側は成功時
`scheduleState`を必ず返す（`resolveScheduleState`がnullを返すことはない）
ため、`scheduleState`がnullなのは「取得に成功したが未設定」ではなく
「取得失敗」を意味する。この設計上の弱点はiOS版
（`fetchRoomName`が失敗時`(nil, nil, nil)`を返す設計）にも同様に存在し、
今回はAndroidで先に顕在化しただけの共通の不具合と判断した。

### Alternatives

- Android側にiOS相当の専用待機画面を新規実装する（→ 調査の結果、
  両OSともWeb版を含め同じ`WaitingBeforeStartScreen`/
  `waitingBeforeStartView`相当の実装が既に存在しており、的外れな対応と
  判断し不採用）
- 取得失敗時は無限に再試行する（→ 権限エラー等の恒久的な失敗の場合に
  画面が固まったまま何も表示されなくなるため不採用）
- 取得失敗時は一定回数だけ再試行し、それでも失敗したら現状の
  `in_session`フォールバックへ委ねる（既存のconnect()失敗時のエラー
  表示に任せる）

### Result

3番目を採用。iOS(`ContentView.swift`)・Android(`PTTApp.kt`)双方に、
最大3回・3秒間隔の再試行ロジックを追加した。恒久的な失敗（BAN等）は
再試行後に従来通り`connect()`側のエラー表示で顕在化する。

---

## 2026-08-13

### Decision

Phase14のFirebase App Check導入にあたり、以下3点を決定した。

1. **段階的ロールアウト方式**: サーバー側検証は環境変数`APP_CHECK_ENFORCE`
   （既定`false`）によるsoft-enforce運用とし、ヘッダー欠如・検証失敗でも
   即座には拒否せず警告ログのみでリクエストを通す。3クライアントの
   App Check対応版が実機・ストアに行き渡り、CI合格・実機動作確認が
   取れてから`APP_CHECK_ENFORCE=true`へ切り替える
2. **プロバイダ選定**: Web=reCAPTCHA v3、iOS=App Attest（実機）／
   DebugProvider（シミュレータ）、Android=Play Integrity
3. **クライアント側の失敗時の扱い**: App Checkトークンの取得に失敗しても
   例外を投げず、ヘッダーを付けずにリクエストを続行する（soft-enforce運用
   と対称的な設計とし、App Check自体の不具合でアプリの主要機能が止まる
   ことを避ける）

### Reason

1. App Checkは「登録済みの実アプリからのリクエストであること」を検証する
   仕組みだが、有効化した瞬間に旧バージョンのアプリ（トークンを送ってこない）
   を全て弾いてしまうと、ストア審査・ユーザーへの行き渡りに時間がかかる
   モバイルアプリの特性上、即断線につながる。Guestロール導入（十四訂）や
   role×操作整理（Phase12）で踏んできた「サーバー側の挙動を変える際は
   段階を踏む」という方針を踏襲した
2. 各プラットフォームでFirebaseが推奨する標準プロバイダを選定した
   （DeviceCheckは非推奨方向のためApp Attestを優先し、シミュレータの
   Secure Enclave非搭載という制約にのみDebugProviderで対応する）
3. token-server側が既にsoft-enforceである以上、クライアント側だけが
   「取得できなければ致命的エラー」という非対称な設計にする理由がない。
   PTTアプリは警備現場での利用を前提とするため、App Check自体の一時的な
   不調（ネットワーク・OS側の問題等）で送話やBAN等の主要機能が止まる
   リスクの方を重く見た

### Alternatives

- 初回導入時から`APP_CHECK_ENFORCE=true`で拒否運用にする（→ 3クライアント
  全ての行き渡りを待たずに導入すると、旧バージョン利用者が即座に使えなく
  なるため不採用）
- クライアント側でApp Checkトークン取得失敗時にリクエスト自体を中断する
  （→ App Check自体の可用性がPTTアプリ全体の可用性に直結してしまうため
  不採用。soft-enforce運用の意図と矛盾する）
- iOS/Androidともに、サーバーからApp Check要否を動的configとして配信し
  クライアント側の挙動を切り替える（→ Phase12でrole判定の同期方式を
  検討した際と同様、起動時ネットワーク依存を新たに持ち込むリスクの方が
  大きいと判断し不採用。環境変数によるサーバー側切り替えのみで十分と判断）

### Result

上記3点を採用し、`token-server`・`ptt-client`・`admin-dashboard`・
`ptt-ios`・`ptt-android`全てに実装した。詳細は`CHANGELOG.md`
「Phase14: Firebase App Check導入」参照。iOS/Androidのビルド確認は
この環境ではXcode/Android SDKが無く実施できておらず、CI
（`ios-ci.yml`・`android-ci.yml`）での確認を次アクションとして残した
（詳細は`brushup-plan.md`「6. 次アクション」参照）。
