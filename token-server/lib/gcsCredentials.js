/**
 * lib/gcsCredentials.js
 *
 * [Phase16] routes/recording.js が個別に持っていた「GCSアップロード用サービス
 * アカウントの認証情報(JSON文字列)を環境変数から読み込む」ロジックを共通化する。
 *
 * [経緯] Phase16でチャット添付ファイル用に2つ目の専用GCSバケット・専用
 * サービスアカウントを追加するにあたり、全く同じ読み込みロジック
 * (JSON文字列 or キーファイルパスの2択、優先順位も含めて)をlib/attachments.js
 * 側にもう一度書くと、Phase12で「role×操作」のホワイトリストが
 * routes/rooms.js・routes/recording.jsに分散していた問題(lib/permissions.js
 * への一本化で解消)と同種の重複が、今度はストレージ認証読み込みという別の
 * 箇所で再発してしまう。そのため、先に共通モジュールとして切り出した。
 *
 * [注意] これはFirebase Admin SDKが使うGOOGLE_APPLICATION_CREDENTIALS(ADC)
 * とは別物として扱う。GCPUpload/File#getSignedUrl等が要求するcredentialsは
 * 「サービスアカウントJSONの中身(文字列)そのもの」であり、ADCの仕組みとは
 * 別経路のため、明示的に環境変数から読む必要がある(recording.js冒頭コメント
 * を参照。この事情自体はPhase16で変わっていない)。
 */

const fs = require('fs');

/**
 * @param {object} params
 * @param {string} params.jsonEnvVar 認証情報のJSON文字列をそのまま持つ環境変数名
 *   (例: Cloud Run本番ではSecret Manager経由でこちらを使う想定)
 * @param {string} params.keyFileEnvVar 認証情報JSONファイルのパスを持つ環境変数名
 *   (例: ローカル開発時はこちらを使う想定)
 * @returns {string} サービスアカウント認証情報のJSON文字列
 */
function loadGcsCredentials({ jsonEnvVar, keyFileEnvVar }) {
  if (process.env[jsonEnvVar]) {
    return process.env[jsonEnvVar];
  }
  if (process.env[keyFileEnvVar]) {
    return fs.readFileSync(process.env[keyFileEnvVar], 'utf8');
  }
  throw new Error(`${jsonEnvVar} または ${keyFileEnvVar} が未設定です`);
}

module.exports = { loadGcsCredentials };
