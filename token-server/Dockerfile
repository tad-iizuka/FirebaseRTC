FROM node:20-slim

# トークン発行のみでネイティブアドオン(旧@discordjs/opus等)は不要なため
# build-essential 等は一切不要。イメージも軽量。

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

ENV NODE_ENV=production
EXPOSE 8080

CMD ["node", "server.js"]
