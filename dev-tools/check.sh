#!/bin/bash
# token-server 動作確認スクリプト
#
# 使い方:
#   1. 下の TOKEN / OTHER_USER_TOKEN に、実際にサインインして取得した
#      Firebase ID Tokenを入れる(get-firebase-token.htmlで取得できる)
#   2. OTHER_USER_TOKEN が無い場合は SKIP_OTHER_USER=1 のまま実行すれば、
#      オーナー単独での作成→トークン取得までは確認できる
#      (join/banのテストにはブラウザで別のGoogleアカウントでサインインした
#       2人目のID Tokenが必要)
#
# 前提: jq は使わず、grep/sedだけでJSONから値を抜き出している
# (雑だが依存を増やさないための割り切り。本格的にAPIテストするなら
#  jq や httpie の導入を推奨)

set -e

BASE_URL="http://localhost:8080"

TOKEN="eyJhbGciOiJSUzI1NiIsImtpZCI6IjE2ZDM5Y2FiYTg2MWY1YzYwMmI3YjY0ODk5YjdhYTdhMWYxZmM4NmUiLCJ0eXAiOiJKV1QifQ.eyJuYW1lIjoiVGFkYXNoaSBJaXp1a2EgKFVCVU5JRlUpIiwicGljdHVyZSI6Imh0dHBzOi8vbGgzLmdvb2dsZXVzZXJjb250ZW50LmNvbS9hL0FDZzhvY0s4M1h1azJ1VGZ1WUF3X3BEeGo0d2ljdEVDMXR6YkZWY3EzWDdLM0VXd3dVLW9ONDlpPXM5Ni1jIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL2Zpci1ydGMtZGUxZjQiLCJhdWQiOiJmaXItcnRjLWRlMWY0IiwiYXV0aF90aW1lIjoxNzgzMzA1MzQyLCJ1c2VyX2lkIjoidWwxWXh4RUw1VGYyV1g1Vm1UUGV4RzJYQlRhMiIsInN1YiI6InVsMVl4eEVMNVRmMldYNVZtVFBleEcyWEJUYTIiLCJpYXQiOjE3ODMzMDUzNDIsImV4cCI6MTc4MzMwODk0MiwiZW1haWwiOiJ1YnVuaWZ1LmNvQGdtYWlsLmNvbSIsImVtYWlsX3ZlcmlmaWVkIjp0cnVlLCJmaXJlYmFzZSI6eyJpZGVudGl0aWVzIjp7Imdvb2dsZS5jb20iOlsiMTAzMjE4NTUyNzU5NTA0MTY0NjI2Il0sImVtYWlsIjpbInVidW5pZnUuY29AZ21haWwuY29tIl19LCJzaWduX2luX3Byb3ZpZGVyIjoiZ29vZ2xlLmNvbSJ9fQ.foeaW5vqSPj2B8qPWKx3pHPUoj_9eR0pUdngxXeKP1x9Q9x7doJoV2RgByC8IxxtStUDjdVyaJ32QI_0AvWhbRP-fh9iso-a5-ejO0sg3X7Ni4YJsqXVQ0rEDe00Pckek51MrgZPBIBWZ4cWi-xzkO0reJF-9ZRBVGTdRwWpPEIDFtsHX5C5pcFXIRigScZrofJEYIK3Pv9ZPSMgpmeYdDU2Lusy7UT8XuhbWojaTLe1oOb-b1zfysuL__QShIU8xp0_c9wTCb0Ei68gvEvMkkBnRZc-fPy85YtUnMpxYcTxMED3t7HJqlgJLzL5_YLarMbGUvDAuvrMSPXCgjncNg"
OTHER_USER_TOKEN=""   # 2人目のID Token。空ならjoin/ban系はスキップされる

extract() {
  # extract '"roomId"' '<json>' のように呼ぶ簡易JSON値抽出
  echo "$2" | grep -o "\"$1\":\"[^\"]*\"" | head -1 | cut -d'"' -f4
}

echo "=== 1. ルーム作成 ==="
ROOM_RESPONSE=$(curl -s -X POST "$BASE_URL/rooms" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"maxMembers": 10}')
echo "$ROOM_RESPONSE"

ROOM_ID=$(extract roomId "$ROOM_RESPONSE")
INVITE_CODE=$(extract inviteCode "$ROOM_RESPONSE")

if [ -z "$ROOM_ID" ]; then
  echo "!! roomId が取得できませんでした。TOKENが正しいか確認してください"
  exit 1
fi
echo "roomId=$ROOM_ID inviteCode=$INVITE_CODE"
echo

echo "=== 2. オーナー自身でトークン取得 (joinなしで成功するはず) ==="
curl -s "$BASE_URL/token?room=$ROOM_ID" -H "Authorization: Bearer $TOKEN"
echo
echo

if [ -z "$OTHER_USER_TOKEN" ]; then
  echo "OTHER_USER_TOKEN が未設定のため、以降のjoin/banテストはスキップします"
  exit 0
fi

echo "=== 3. 別ユーザーが招待コードで参加 ==="
JOIN_RESPONSE=$(curl -s -X POST "$BASE_URL/rooms/$ROOM_ID/join" \
  -H "Authorization: Bearer $OTHER_USER_TOKEN" -H "Content-Type: application/json" \
  -d "{\"inviteCode\": \"$INVITE_CODE\"}")
echo "$JOIN_RESPONSE"
echo

echo "=== 4. 別ユーザーがメンバーになったのでLiveKitトークンを取得できるはず ==="
OTHER_TOKEN_RESPONSE=$(curl -s "$BASE_URL/token?room=$ROOM_ID" -H "Authorization: Bearer $OTHER_USER_TOKEN")
echo "$OTHER_TOKEN_RESPONSE"
OTHER_UID=$(extract identity "$OTHER_TOKEN_RESPONSE")
echo "otherUid=$OTHER_UID"
echo

if [ -z "$OTHER_UID" ]; then
  echo "!! otherUid が取得できませんでした。OTHER_USER_TOKENが正しいか確認してください"
  exit 1
fi

echo "=== 5. ownerが別ユーザーをBAN ==="
curl -s -X POST "$BASE_URL/rooms/$ROOM_ID/members/$OTHER_UID/ban" \
  -H "Authorization: Bearer $TOKEN"
echo
echo

echo "=== 6. BANされた後、別ユーザーがトークン取得しようとすると403になるはず ==="
curl -s -o /dev/null -w "HTTPステータス: %{http_code}\n" \
  "$BASE_URL/token?room=$ROOM_ID" -H "Authorization: Bearer $OTHER_USER_TOKEN"
