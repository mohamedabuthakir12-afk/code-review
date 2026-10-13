FROM node:24-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:24-slim
WORKDIR /app

# semgrep (static-analysis layer) needs Python; everything else in this
# image is just the compiled app + its runtime deps.
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip git \
  && pip3 install --no-cache-dir --break-system-packages semgrep \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY config ./config

ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "dist/server.js"]
