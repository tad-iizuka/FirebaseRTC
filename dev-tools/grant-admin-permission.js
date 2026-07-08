#!/usr/bin/env node
/**
 * 管理者権限(adminUsers/{uid}.permissions)の付与/剥奪/確認を行う
 * ローカル専用スクリプト。
 *
 * [なぜAPIではなくスクリプトなのか]
 * 「誰が新しい管理者を任命できるか」を安全に(再帰的に)守る仕組みを
 * きちんと作るまでの間は、Firestoreへの書き込み権限を持つ運用者が
 * ローカルからAdmin SDKで直接操作する運用にする。これは
 * token-server/routes/rooms.js に owner→moderator の任命APIが
 * 現状無く、README.md の「未実装・今後の検討事項」に挙げられているのと
 * 同じ考え方に倣っている。
 *
 * 使い方:
 *   node dev-tools/grant-admin-permission.js grant  <uid> <permission> ["メモ"]
 *   node dev-tools/grant-admin-permission.js revoke <uid> <permission>
 *   node dev-tools/grant-admin-permission.js list   <uid>
 *
 * 例:
 *   node dev-tools/grant-admin-permission.js grant ul1YxxEL5Tf2WX5VmTPexG2XBTa2 rooms:monitor "運用チームリーダー"
 *
 * 事前準備: GOOGLE_APPLICATION_CREDENTIALS に、Firestoreへの書き込み権限を
 * 持つサービスアカウントJSONのパスを設定しておくこと
 * (token-server/lib/firebaseAdmin.js が使うものと同じ認証情報でよい)。
 * FIREBASE_PROJECT_ID も合わせて設定する。
 */

const admin = require('firebase-admin');

if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error('GOOGLE_APPLICATION_CREDENTIALS が未設定です(サービスアカウントJSONのパスを指定してください)');
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  projectId: process.env.FIREBASE_PROJECT_ID,
});
const db = admin.firestore();

async function main() {
  const [, , command, uid, permission, note] = process.argv;

  if (!command || !uid) {
    console.error('使い方: node grant-admin-permission.js <grant|revoke|list> <uid> [permission] ["メモ"]');
    process.exit(1);
  }

  const ref = db.collection('adminUsers').doc(uid);

  if (command === 'list') {
    const snap = await ref.get();
    console.log(snap.exists ? snap.data() : '(このuidには権限が付与されていません)');
    return;
  }

  if (!permission) {
    console.error('grant/revoke には permission (例: rooms:monitor) の指定が必要です');
    process.exit(1);
  }

  if (command === 'grant') {
    await ref.set(
      {
        permissions: admin.firestore.FieldValue.arrayUnion(permission),
        grantedAt: new Date(),
        ...(note ? { note } : {}),
      },
      { merge: true }
    );
    console.log(`付与しました: uid=${uid} permission=${permission}`);
  } else if (command === 'revoke') {
    await ref.set(
      { permissions: admin.firestore.FieldValue.arrayRemove(permission) },
      { merge: true }
    );
    console.log(`剥奪しました: uid=${uid} permission=${permission}`);
  } else {
    console.error(`不明なコマンド: ${command} (grant/revoke/list のいずれかを指定してください)`);
    process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
