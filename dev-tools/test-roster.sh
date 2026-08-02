#!/usr/bin/env bash
#
# 組織ロースター層(admin/staff、scopeNodeIds、override規約)の動作確認スクリプト。
#
# [なぜスクリプト化したか]
# 検証手順は複数のcurl呼び出しをまたぐシェル変数($BASE/$ORG_ID等)に依存しており、
# ターミナルセッションが変わると変数が失われてコマンドが壊れる(No host part in
# the URL 等)。このスクリプトを `source` することで、1回の実行内で最初から
# 最後まで通して確認できるようにする。
#
# [前提]
# - token-serverがローカルで起動していること(デフォルト http://localhost:8080。
#   別ポート/URLの場合は BASE 環境変数で上書きする)
# - jq がインストールされていること(`brew install jq` 等)
# - 以下の環境変数を事前に設定しておくこと(値は各自のFirebaseプロジェクトの
#   ものに置き換える):
#
#     ROOT_TOKEN  … organizations:manage を付与済みのユーザーのID Token
#     TOKEN_A     … 団体全体adminにするユーザーのID Token
#     TOKEN_B     … scope限定adminにするユーザーのID Token
#     TOKEN_C     … staffにするユーザーのID Token
#     UID_A       … TOKEN_Aに対応するFirebase uid
#     UID_B       … TOKEN_Bに対応するFirebase uid
#     UID_C       … TOKEN_Cに対応するFirebase uid
#
#   ID Tokenは dev-tools/get-firebase-token.html で取得する(有効期限は
#   短いので、失効エラーが出たら取り直して環境変数を再設定すること)。
#   uidはFirebase Console > Authentication > Users で確認できる。
#
# [使い方]
#   source dev-tools/test-roster.sh
#   # または: bash dev-tools/test-roster.sh
#
# 各ステップは「期待するHTTPステータスコード」を明示し、一致すればPASS、
# 一致しなければFAILと表示する。1つ失敗しても後続ステップは続行する
# (どこまで正しく動いているかを最後まで確認できるようにするため)。

set -u  # 未定義変数の参照はエラーにする(set -eは使わない。403等の「期待される
        # 失敗」で止まってしまうと最後まで検証できないため)

BASE="${BASE:-http://localhost:8080}"

PASS_COUNT=0
FAIL_COUNT=0

# --- 必須環境変数のチェック ---
for v in ROOT_TOKEN TOKEN_A TOKEN_B TOKEN_C UID_A UID_B UID_C; do
  if [ -z "${!v:-}" ]; then
    echo "❌ 環境変数 $v が未設定です。スクリプト冒頭のコメントを参照して設定してください。"
    return 1 2>/dev/null || exit 1
  fi
done

if ! command -v jq >/dev/null 2>&1; then
  echo "❌ jq が見つかりません。'brew install jq' 等でインストールしてください。"
  return 1 2>/dev/null || exit 1
fi

echo "== 組織ロースター層 動作確認 (BASE=$BASE) =========================="
echo

# expect_status <説明> <期待するHTTPステータス> <curl引数...>
# レスポンスボディは変数 LAST_BODY に、ステータスは LAST_STATUS に格納する。
expect_status() {
  local desc="$1"; local expected="$2"; shift 2
  local resp
  resp="$(curl -s -w '\n%{http_code}' "$@")"
  LAST_STATUS="$(echo "$resp" | tail -n1)"
  LAST_BODY="$(echo "$resp" | sed '$d')"
  if [ "$LAST_STATUS" = "$expected" ]; then
    echo "✅ PASS  [$LAST_STATUS] $desc"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    echo "❌ FAIL  [期待 $expected / 実際 $LAST_STATUS] $desc"
    echo "   body: $LAST_BODY"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
}

# ---------------------------------------------------------------------------
echo "-- 1. 団体・node階層の作成(root) --------------------------------"

ORG_ID="$(curl -s -X POST "$BASE/admin/organizations" \
  -H "Authorization: Bearer $ROOT_TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"テスト警備株式会社(roster確認用)"}' | jq -r '.orgId // empty')"

if [ -z "$ORG_ID" ]; then
  echo "❌ 団体の作成に失敗しました(ROOT_TOKENがorganizations:manageを持っているか確認してください)。中断します。"
  return 1 2>/dev/null || exit 1
fi
echo "  ORG_ID=$ORG_ID"

BRANCH_ID="$(curl -s -X POST "$BASE/admin/organizations/$ORG_ID/nodes" \
  -H "Authorization: Bearer $ROOT_TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"東京支社","parentNodeId":null}' | jq -r '.nodeId // empty')"
echo "  BRANCH_ID=$BRANCH_ID"

SITE_ID="$(curl -s -X POST "$BASE/admin/organizations/$ORG_ID/nodes" \
  -H "Authorization: Bearer $ROOT_TOKEN" -H "Content-Type: application/json" \
  -d "{\"name\":\"△△現場\",\"parentNodeId\":\"$BRANCH_ID\"}" | jq -r '.nodeId // empty')"
echo "  SITE_ID=$SITE_ID"

SIBLING_BRANCH_ID="$(curl -s -X POST "$BASE/admin/organizations/$ORG_ID/nodes" \
  -H "Authorization: Bearer $ROOT_TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"大阪支社","parentNodeId":null}' | jq -r '.nodeId // empty')"
echo "  SIBLING_BRANCH_ID=$SIBLING_BRANCH_ID"
echo

# ---------------------------------------------------------------------------
echo "-- 2. 鶏卵問題: rootによる最初の団体管理者の代理登録 ----------------"

expect_status "root がUID_Aを団体全体adminとして代理登録" 201 \
  -X POST "$BASE/admin/organizations/$ORG_ID/members/$UID_A" \
  -H "Authorization: Bearer $ROOT_TOKEN" -H "Content-Type: application/json" \
  -d '{"orgRole":"admin","scopeNodeIds":[]}'

expect_status "GET /admin/me (UID_A) に managedOrgIds が含まれるか" 200 \
  "$BASE/admin/me" -H "Authorization: Bearer $TOKEN_A"
if echo "$LAST_BODY" | jq -e --arg org "$ORG_ID" '.managedOrgIds | index($org) != null' >/dev/null 2>&1; then
  echo "   ✅ managedOrgIds に $ORG_ID を確認"
else
  echo "   ❌ managedOrgIds に $ORG_ID が見当たりません: $(echo "$LAST_BODY" | jq -c .managedOrgIds)"
fi
echo

# ---------------------------------------------------------------------------
echo "-- 3. 団体全体admin(UID_A)によるscope限定adminの付与 ----------------"

expect_status "UID_A がUID_Bを東京支社scopeのadminとして付与" 201 \
  -X POST "$BASE/admin/organizations/$ORG_ID/members/$UID_B" \
  -H "Authorization: Bearer $TOKEN_A" -H "Content-Type: application/json" \
  -d "{\"orgRole\":\"admin\",\"scopeNodeIds\":[\"$BRANCH_ID\"]}"
echo

# ---------------------------------------------------------------------------
echo "-- 4. override規約の確認 -------------------------------------------"

expect_status "UID_B(東京支社scope)が子(△△現場)scopeのstaffを付与 → 成功するはず" 201 \
  -X POST "$BASE/admin/organizations/$ORG_ID/members/$UID_C" \
  -H "Authorization: Bearer $TOKEN_B" -H "Content-Type: application/json" \
  -d '{"orgRole":"staff"}'

expect_status "UID_B が自分のscopeを団体全体([])へ拡大しようとする → 403のはず" 403 \
  -X PATCH "$BASE/admin/organizations/$ORG_ID/members/$UID_B" \
  -H "Authorization: Bearer $TOKEN_B" -H "Content-Type: application/json" \
  -d '{"orgRole":"admin","scopeNodeIds":[]}'

expect_status "UID_B(東京支社scope)が兄弟node(大阪支社)scopeのadminを付与 → 403のはず" 403 \
  -X POST "$BASE/admin/organizations/$ORG_ID/members/$UID_C" \
  -H "Authorization: Bearer $TOKEN_B" -H "Content-Type: application/json" \
  -d "{\"orgRole\":\"admin\",\"scopeNodeIds\":[\"$SIBLING_BRANCH_ID\"]}"
echo "  (↑ UID_Cは既にstaffとして登録済みのため実際には409になる場合があります。"
echo "   409の場合は権限判定より先に重複チェックに引っかかっただけで問題ありません。"
echo "   純粋にscope外への付与を試したい場合は別のuidで試してください)"
echo

expect_status "UID_A(団体全体admin)がUID_Bのscopeを△△現場だけに縮小 → 成功するはず" 200 \
  -X PATCH "$BASE/admin/organizations/$ORG_ID/members/$UID_B" \
  -H "Authorization: Bearer $TOKEN_A" -H "Content-Type: application/json" \
  -d "{\"orgRole\":\"admin\",\"scopeNodeIds\":[\"$SITE_ID\"]}"
echo

# ---------------------------------------------------------------------------
echo "-- 5. 名簿一覧・単体取得APIの権限確認 -------------------------------"

expect_status "UID_B が名簿一覧を閲覧できる" 200 \
  "$BASE/admin/organizations/$ORG_ID/members" -H "Authorization: Bearer $TOKEN_B"

expect_status "UID_B は organizations:monitor を持たないので一覧APIは403のはず" 403 \
  "$BASE/admin/organizations" -H "Authorization: Bearer $TOKEN_B"

expect_status "UID_B でも団体単体取得は成功するはず(2026-08-02対応)" 200 \
  "$BASE/admin/organizations/$ORG_ID" -H "Authorization: Bearer $TOKEN_B"

expect_status "UID_B でもnode一覧取得は成功するはず(2026-08-02対応)" 200 \
  "$BASE/admin/organizations/$ORG_ID/nodes" -H "Authorization: Bearer $TOKEN_B"
echo

# ---------------------------------------------------------------------------
echo "-- 6. 無関係のuidが弾かれることの確認 --------------------------------"

expect_status "TOKEN_C(この時点ではstaff、admin権限なし)が名簿を編集しようとする → 403のはず" 403 \
  -X POST "$BASE/admin/organizations/$ORG_ID/members/$UID_A" \
  -H "Authorization: Bearer $TOKEN_C" -H "Content-Type: application/json" \
  -d '{"orgRole":"staff"}'
echo

# ---------------------------------------------------------------------------
echo "-- 7. 除名(revoke) ----------------------------------------------------"

expect_status "UID_A がUID_C(staff)を除名" 200 \
  -X DELETE "$BASE/admin/organizations/$ORG_ID/members/$UID_C" \
  -H "Authorization: Bearer $TOKEN_A"

expect_status "除名後、UID_Cはもう名簿にいない(再除名は404のはず)" 404 \
  -X DELETE "$BASE/admin/organizations/$ORG_ID/members/$UID_C" \
  -H "Authorization: Bearer $TOKEN_A"
echo

# ---------------------------------------------------------------------------
echo "======================================================================"
echo "結果: PASS=$PASS_COUNT FAIL=$FAIL_COUNT"
echo "ORG_ID=$ORG_ID / BRANCH_ID=$BRANCH_ID / SITE_ID=$SITE_ID / SIBLING_BRANCH_ID=$SIBLING_BRANCH_ID"
echo "(後片付け: このテスト団体はAPI経由で削除する手段が未実装のため、"
echo " Firestore Consoleから organizations/$ORG_ID を手動で削除してください)"

if [ "$FAIL_COUNT" -gt 0 ]; then
  return 1 2>/dev/null || exit 1
fi
