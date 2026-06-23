FROM node:20-slim

# @discordjs/opus はネイティブバインディングのため
# ビルドツール(gcc/g++/make/python3)が必要
RUN apt-get update && apt-get install -y \
    build-essential \
    python3 \
    --no-install-recommends \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY server.js ./

ENV NODE_ENV=production
EXPOSE 8080

CMD ["node", "server.js"]
