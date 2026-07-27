FROM node:20-slim

# [Phase16] チャット添付ファイルのPDFサムネイル生成に使う `canvas` パッケージは
# prebuilt バイナリを使うため build-essential 等のビルドツールは不要だが、
# 実行時にcairo/pango/jpeg/gif/rsvg等の共有ライブラリを要求する。
# node:20-slim(Debian)にはデフォルトで入っていないため、ランタイム分のみ
# 明示的にインストールする(-dev系のヘッダパッケージは不要、イメージを
# 増やさないため入れない)。
# 動画サムネイル抽出に使う `ffmpeg-static` は静的ビルド済みバイナリを
# npmパッケージ自体に同梱しているため、システムへのffmpegインストールは不要。
RUN apt-get update && apt-get install -y --no-install-recommends \
    libcairo2 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libjpeg62-turbo \
    libgif7 \
    librsvg2-2 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

ENV NODE_ENV=production
EXPOSE 8080

CMD ["node", "server.js"]
