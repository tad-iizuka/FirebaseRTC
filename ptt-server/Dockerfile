FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY server.js ./

ENV NODE_ENV=production
# Cloud Runは環境変数 PORT を自動的に渡す（デフォルト8080）。server.js は process.env.PORT を見ている。
EXPOSE 8080

CMD ["node", "server.js"]
