# PTT 管理者ダッシュボード — Firebase Hosting 正式デプロイ

`dev-tools/admin-dashboard.html`(ローカル専用の開発ツール)とは別に、こちらは
**Firebase Hostingの独立したサイト**として正式運用するための配置です。
`ptt-client`(Web版本体)と同じFirebaseプロジェクト内に、Hostingの
**マルチサイト機能**でもう1つサイトを追加し、`firebase.json`のtargetで
既存のhosting設定パターンをそのまま流用しています。

```
admin-dashboard/
  public/index.html   … 本番配信するダッシュボード本体 (dev-tools版から複製・調整)
  README.md           … このファイル
```

## なぜdev-tools版をそのまま公開しないのか

`dev-tools/admin-dashboard.html` はREADME内に明記の通り「ローカル専用の開発ツール」
という位置づけで、`file://` や `python3 -m http.server` での一時的な起動を前提にした
注意書きが入っている。正式にURLを持たせて運用する場合は

- Firebase Authの「承認済みドメイン」に本番ドメインを登録する必要がある
  (`file://`や`localhost`と違い、明示的な登録がないとGoogleサインインの
  ポップアップが `auth/unauthorized-domain` で失敗する)
- 検索エンジンにインデックスされないよう `noindex` を明示する
- 開発専用の注意書き(ローカルサーバーの起動方法等)を本番向けの文言に置き換える

といった違いがあるため、`dev-tools/`側は開発時の手早い動作確認用として残しつつ、
別ディレクトリとして正式版を用意している。

## アクセス制御について

このサイト自体はFirebase Hostingの公開URLとして誰でも開けるが、実際に意味のある
データ(`GET /admin/rooms` 等)を返すかどうかはtoken-server側の
`middleware/requireAdmin.js`(`adminUsers/{uid}.permissions` に `rooms:monitor` が
あるか)で判定される。つまり「ページは公開・APIが権限で守る」設計であり、
`firestore.rules`が `rooms`/`members`/`reports` を守っているのと同じ考え方。
Hosting側のアクセス制御(Firebase Hosting自体へのBasic認証等)は現状導入していない。
社外に一切見せたくない場合は、追加でCloud Armor/IAP相当の仕組みの導入を検討すること。

## 一回限りのセットアップ

### 1. Hostingサイトの追加作成

デフォルトサイト(`ptt-client`用、サイトIDは通常プロジェクトIDと同じ
`fir-rtc-de1f4`)とは別に、管理者ダッシュボード専用のサイトを新規作成する。

```bash
firebase hosting:sites:create fir-rtc-de1f4-admin --project fir-rtc-de1f4
```

サイトIDは他のFirebaseプロジェクトと重複しないグローバルに一意な文字列である
必要がある。上記のIDが既に使われている場合は、`fir-rtc-de1f4-admin` の部分を
別の一意な値に変え、`.firebaserc` の `targets.fir-rtc-de1f4.hosting.admin` の値も
合わせて書き換えること。

### 2. targetの紐付け

`.firebaserc` に既に `targets` を追加済みだが、初回はローカルでも一度
明示的に紐付けておくと事故が少ない。

```bash
firebase target:apply hosting client fir-rtc-de1f4 --project fir-rtc-de1f4
firebase target:apply hosting admin fir-rtc-de1f4-admin --project fir-rtc-de1f4
```

### 3. Firebase Authの承認済みドメインに追加

Firebase Console > Authentication > Settings > 承認済みドメイン に、
サイト作成後に払い出される既定ドメイン
(`fir-rtc-de1f4-admin.web.app` / `fir-rtc-de1f4-admin.firebaseapp.com`)を追加する。
これを行わないとGoogleサインインが `auth/unauthorized-domain` で失敗する。

カスタムドメインを充てる場合は、そのドメインも別途Hosting側の
「カスタムドメインの追加」手順で紐付けた上で、同様に承認済みドメインへ追加すること。

### 4. GitHub Actions用の環境変数・シークレット

`ptt-client`用の `web-deploy.yml` が既に使っている以下を、そのまま
`admin-deploy.yml` でも再利用している(新規追加は不要):

- Secret: `FIREBASE_SERVICE_ACCOUNT`
- Variable: `FIREBASE_PROJECT_ID`

このサービスアカウントに、新規作成した `fir-rtc-de1f4-admin` サイトへの
デプロイ権限(`Firebase Hosting Admin` ロール等、プロジェクト全体に付与済みなら
追加作業は不要)があることを確認する。

### 5. 動作確認

1. `firebase deploy --only hosting:admin --project fir-rtc-de1f4` でローカルから
   一度手動デプロイし、`https://fir-rtc-de1f4-admin.web.app` が開けることを確認する
   (以降はmainブランチへのマージで `admin-deploy.yml` が自動デプロイする)。
2. `rooms:monitor` 権限を付与済みのアカウントでサインインし、ルーム一覧が
   表示されることを確認する(`node dev-tools/grant-admin-permission.js grant <uid> rooms:monitor`)。
3. 権限を持たないアカウントでサインインすると `GET /admin/rooms` が403になり、
   一覧の代わりにエラーメッセージが表示されることを確認する。
4. `firebase deploy --only hosting:client` を実行しても `ptt-client` 側のみが
   更新され、管理者サイトに影響しないことを確認する(targetが分離されているため)。

## 動作確認チェックリスト(追加分)

- [ ] `fir-rtc-de1f4-admin.web.app` にアクセスでき、`ptt-client`本体とは別ドメインである
- [ ] 承認済みドメイン未登録の状態でサインインを試すと `auth/unauthorized-domain` になる(登録後は解消)
- [ ] mainブランチへの `admin-dashboard/**` 変更マージで自動デプロイされる
- [ ] `firebase.json` / `.firebaserc` のみの変更でも `admin-deploy.yml` / `web-deploy.yml` の両方がトリガーされる
- [ ] レスポンスヘッダーに `X-Robots-Tag: noindex, nofollow` が付与されている
