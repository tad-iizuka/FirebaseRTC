#!/bin/bash
# token-server CI/CD 用: Workload Identity Federation の一回限りのセットアップ
#
# サービスアカウントキーのJSONをGitHub Secretsに長期保存する方式は避け、
# GitHub ActionsのOIDCトークンでGCPサービスアカウントを一時的にimpersonateする
# WIF方式にしている(token-server/README.mdが平文の環境変数直書きを避けているのと
# 同じ「長期有効な秘密情報をなるべく持たない」という方針)。
#
# 実行前に書き換えること:
#   PROJECT_ID … 対象のGCPプロジェクトID (例: fir-rtc-de1f4)
#   REPO       … "owner/repo" 形式のGitHubリポジトリ名
#
# 実行後、GitHub側 (Settings > Secrets and variables > Actions) に登録するもの:
#   Secrets:
#     GCP_WIF_PROVIDER … このスクリプト末尾で出力されるprovider名
#     GCP_DEPLOY_SA    … github-deployer@${PROJECT_ID}.iam.gserviceaccount.com
#   Variables:
#     GCP_PROJECT_ID       … $PROJECT_ID
#     LIVEKIT_HOST         … 例: https://your-project.livekit.cloud
#     FIREBASE_PROJECT_ID  … Firebaseプロジェクトのproject id
#     ALLOWED_ORIGINS      … 例: https://ptt-client.example.com
#     RECORDING_GCS_BUCKET … 録音保存用バケット名
#
# 前提: LIVEKIT_API_KEY等のシークレット自体は token-server/README.md の
# 「1. Secret Manager にシークレットを登録」の手順で作成済みであること。
# このスクリプトはCI/CDから「デプロイする」権限だけを用意する。

set -euo pipefail

PROJECT_ID="fir-rtc-de1f4"
REPO="tad-iizuka/FirebaseRTC"

PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
DEPLOY_SA="github-deployer@${PROJECT_ID}.iam.gserviceaccount.com"

echo "=== 1. Workload Identity Pool の作成 ==="
gcloud iam workload-identity-pools create "github-pool" \
  --project="$PROJECT_ID" --location="global" \
  --display-name="GitHub Actions Pool"

echo "=== 2. Provider の作成 (このリポジトリからのOIDCトークンのみ受け付ける) ==="
gcloud iam workload-identity-pools providers create-oidc "github-provider" \
  --project="$PROJECT_ID" --location="global" \
  --workload-identity-pool="github-pool" \
  --display-name="GitHub provider" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
  --attribute-condition="assertion.repository=='${REPO}'" \
  --issuer-uri="https://token.actions.githubusercontent.com"

echo "=== 3. デプロイ専用サービスアカウントの作成 ==="
gcloud iam service-accounts create github-deployer \
  --project="$PROJECT_ID" --display-name="GitHub Actions Deployer"

echo "=== 4. このリポジトリからのみ github-deployer をimpersonate可能にする ==="
gcloud iam service-accounts add-iam-policy-binding "$DEPLOY_SA" \
  --project="$PROJECT_ID" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github-pool/attribute.repository/${REPO}"

echo "=== 5. デプロイに必要な権限を付与 ==="
# Cloud Run自体の作成・更新
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${DEPLOY_SA}" --role="roles/run.admin"
# --source デプロイはCloud Buildでコンテナをビルドするため必要
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${DEPLOY_SA}" --role="roles/cloudbuild.builds.editor"
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${DEPLOY_SA}" --role="roles/artifactregistry.writer"
# Cloud Buildのステージング用バケットへの書き込み
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${DEPLOY_SA}" --role="roles/storage.admin"

echo "=== 6. Cloud Runランタイムサービスアカウントへのimpersonate権限 ==="
# gcloud run deploy が「このランタイムSAでサービスを実行する」設定を行うために必要
# (Secret Managerへのアクセス権自体はランタイムSA側に既に付与済みのはず。README参照)

# RUNTIME_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
# gcloud iam service-accounts add-iam-policy-binding "$RUNTIME_SA" \
#   --project="$PROJECT_ID" \
#   --member="serviceAccount:${DEPLOY_SA}" \
#   --role="roles/iam.serviceAccountUser"

# echo
# echo "=== 完了。GitHub Secretsに以下を登録してください ==="
# echo "GCP_WIF_PROVIDER = projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github-pool/providers/github-provider"
# echo "GCP_DEPLOY_SA    = ${DEPLOY_SA}"

# PROJECT_ID="fir-rtc-de1f4"
# DEPLOY_SA="github-deployer@${PROJECT_ID}.iam.gserviceaccount.com"
# PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')

# # 少し待ってから実行(反映待ち)
# sleep 30

# gcloud projects add-iam-policy-binding "$PROJECT_ID" \
#   --member="serviceAccount:${DEPLOY_SA}" --role="roles/run.admin"

# gcloud projects add-iam-policy-binding "$PROJECT_ID" \
#   --member="serviceAccount:${DEPLOY_SA}" --role="roles/cloudbuild.builds.editor"

# gcloud projects add-iam-policy-binding "$PROJECT_ID" \
#   --member="serviceAccount:${DEPLOY_SA}" --role="roles/artifactregistry.writer"

# gcloud projects add-iam-policy-binding "$PROJECT_ID" \
#   --member="serviceAccount:${DEPLOY_SA}" --role="roles/storage.admin"

# RUNTIME_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
# gcloud iam service-accounts add-iam-policy-binding "$RUNTIME_SA" \
#   --project="$PROJECT_ID" \
#   --member="serviceAccount:${DEPLOY_SA}" \
#   --role="roles/iam.serviceAccountUser"

# echo "GCP_WIF_PROVIDER = projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github-pool/providers/github-provider"
# echo "GCP_DEPLOY_SA    = ${DEPLOY_SA}"
