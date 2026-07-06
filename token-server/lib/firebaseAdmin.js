/**
 * Firebase Admin SDK 初期化
 *
 * Cloud Run上ではメタデータサーバー経由でApplication Default Credentialsが
 * 自動的に使えるため、サービスアカウントキーファイルの配置は不要。
 * ローカル開発時は GOOGLE_APPLICATION_CREDENTIALS 環境変数で
 * サービスアカウントキーのパスを指定すること。
 *
 * server.js / 各routesはこのモジュールをrequireすることで
 * 初期化済みの db / auth インスタンスを共有する。
 */

const admin = require('firebase-admin');

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  projectId: process.env.FIREBASE_PROJECT_ID,
});

const db = admin.firestore();
const auth = admin.auth();

module.exports = { admin, db, auth };
