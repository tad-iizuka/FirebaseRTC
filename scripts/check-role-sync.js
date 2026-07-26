#!/usr/bin/env node
/**
 * scripts/check-role-sync.js
 *
 * [Phase12・十五訂]
 * token-server/lib/permissions.js (サーバー側のrole×操作 対応表, SSOT) と、
 * 3クライアント(Web/iOS/Android)がそれぞれ手動で複製している
 * 「管理権限あり/なし」の定数(ROOM_MANAGE_ROLES相当)が一致しているかを
 * 機械的に検証する。
 *
 * 経緯: brushup-plan.md Phase12。クライアント側は実行時にサーバーの対応表を
 * APIとして取得する方式を採らず、値をハードコードで手動同期する運用とした。
 * このスクリプトは「同期し忘れ」に気づくためだけの最小限のチェックであり、
 * 生成(codegen)は行わない。差分があればCIを落とす。
 *
 * 検証対象: このクライアントがrole分岐している操作は現状
 * 'members:ban' / 'recording:start' / 'recording:stop' のみで、いずれも
 * サーバー側の許可roleは ['owner', 'moderator'] で揃っている。
 * この3操作の許可role集合が一致しない場合、あるいはクライアント側の
 * 定数と一致しない場合はこのスクリプトが失敗する。
 *
 * 実行方法: node scripts/check-role-sync.js (リポジトリルートから)
 */

'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');

// このクライアントが実際にサーバーへ問い合わせて使い分けている操作。
// 新しい操作をクライアントに追加した場合はここにも追記すること。
const RELEVANT_OPERATIONS = ['members:ban', 'recording:start', 'recording:stop'];

function fail(message) {
  console.error(`\n❌ check-role-sync: ${message}\n`);
  process.exitCode = 1;
}

function sortedUnique(arr) {
  return Array.from(new Set(arr)).sort();
}

function arraysEqual(a, b) {
  const sa = sortedUnique(a);
  const sb = sortedUnique(b);
  return sa.length === sb.length && sa.every((v, i) => v === sb[i]);
}

/** サーバー側SSOTから、このクライアントが必要とする「管理者ロール集合」を導出する。 */
function loadServerExpectedRoles() {
  const permissionsPath = path.join(REPO_ROOT, 'token-server', 'lib', 'permissions.js');
  const { ROOM_OPERATIONS } = require(permissionsPath);

  const perOperationRoles = RELEVANT_OPERATIONS.map((op) => {
    if (!ROOM_OPERATIONS[op]) {
      throw new Error(`token-server/lib/permissions.js に操作 "${op}" が定義されていません`);
    }
    return { op, roles: ROOM_OPERATIONS[op] };
  });

  // 3操作すべてで許可roleが一致していることをまず確認する(クライアント側は
  // 操作ごとに分岐せず「管理権限あり/なし」の1軸しか持たないため、
  // サーバー側で操作ごとに値がズレていたらこのスクリプトの前提が崩れる)。
  const [first, ...rest] = perOperationRoles;
  for (const { op, roles } of rest) {
    if (!arraysEqual(roles, first.roles)) {
      throw new Error(
        `token-server/lib/permissions.js 内で "${first.op}"(${first.roles.join(',')})と ` +
          `"${op}"(${roles.join(',')})の許可roleが一致していません。` +
          'クライアント側は操作ごとの分岐を持たない前提のため、まずサーバー側の設計を見直してください。',
      );
    }
  }

  return first.roles;
}

/** ファイルから正規表現で文字列配列を抜き出す共通ヘルパー。 */
function extractQuotedList(fileContent, pattern, filePath) {
  const match = fileContent.match(pattern);
  if (!match) {
    throw new Error(`${filePath} から対象の定数を抽出できませんでした(パターン不一致)`);
  }
  const body = match[1];
  const roles = Array.from(body.matchAll(/['"]([a-zA-Z_]+)['"]/g)).map((m) => m[1]);
  if (roles.length === 0) {
    throw new Error(`${filePath} の定数からroleを1件も抽出できませんでした`);
  }
  return roles;
}

function loadWebRoles() {
  const filePath = path.join(REPO_ROOT, 'ptt-client', 'src', 'lib', 'roomPermissions.ts');
  const content = fs.readFileSync(filePath, 'utf8');
  return {
    filePath: path.relative(REPO_ROOT, filePath),
    roles: extractQuotedList(content, /ROOM_MANAGE_ROLES\s*=\s*\[([^\]]*)\]/, filePath),
  };
}

function loadIOSRoles() {
  const filePath = path.join(REPO_ROOT, 'ptt-ios', 'ptt-ios', 'PTTRoomPermissions.swift');
  const content = fs.readFileSync(filePath, 'utf8');
  return {
    filePath: path.relative(REPO_ROOT, filePath),
    roles: extractQuotedList(content, /manageRoles:\s*Set<String>\s*=\s*\[([^\]]*)\]/, filePath),
  };
}

function loadAndroidRoles() {
  const filePath = path.join(
    REPO_ROOT,
    'ptt-android',
    'app',
    'src',
    'main',
    'java',
    'co',
    'ubunifu',
    'pttandroid',
    'ban',
    'PTTRoomPermissions.kt',
  );
  const content = fs.readFileSync(filePath, 'utf8');
  return {
    filePath: path.relative(REPO_ROOT, filePath),
    roles: extractQuotedList(content, /MANAGE_ROLES:\s*Set<String>\s*=\s*setOf\(([^)]*)\)/, filePath),
  };
}

function main() {
  let serverRoles;
  try {
    serverRoles = loadServerExpectedRoles();
  } catch (e) {
    fail(e.message);
    return;
  }

  const loaders = [loadWebRoles, loadIOSRoles, loadAndroidRoles];
  const results = [];

  for (const loader of loaders) {
    try {
      results.push(loader());
    } catch (e) {
      fail(e.message);
    }
  }

  if (process.exitCode === 1) return;

  let allOk = true;
  for (const { filePath, roles } of results) {
    if (arraysEqual(roles, serverRoles)) {
      console.log(`✅ ${filePath}: [${roles.join(', ')}] (サーバー側と一致)`);
    } else {
      allOk = false;
      console.error(
        `❌ ${filePath}: [${roles.join(', ')}] が token-server/lib/permissions.js の ` +
          `[${serverRoles.join(', ')}] と一致していません`,
      );
    }
  }

  if (!allOk) {
    fail(
      '3クライアントとサーバーのrole定義が一致していません。' +
        'ptt-client/src/lib/roomPermissions.ts・ptt-ios/ptt-ios/PTTRoomPermissions.swift・' +
        'ptt-android/.../ban/PTTRoomPermissions.kt のいずれかを更新してください。',
    );
    return;
  }

  console.log('\n✅ check-role-sync: サーバーと3クライアントのrole定義は一致しています\n');
}

main();
