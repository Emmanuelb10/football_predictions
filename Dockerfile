# Stage 1: Build server
FROM node:22-slim AS server-build
WORKDIR /app/server
COPY server/package*.json ./
ENV PUPPETEER_SKIP_DOWNLOAD=true
RUN npm ci
COPY server/ ./
RUN npx tsc

# Stage 2: Build client
FROM node:22-slim AS client-build
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npx vite build

# Stage 3: Production image
FROM node:22-slim
WORKDIR /app

# Server deps (puppeteer Chrome download skipped — 1xBet scraping is optional,
# prosoccer.gr odds are primary. Set PUPPETEER_EXECUTABLE_PATH to enable.)
COPY server/package*.json ./server/
RUN PUPPETEER_SKIP_DOWNLOAD=true npm ci --prefix server

# Copy built server + client
COPY --from=server-build /app/server/dist ./server/dist
COPY --from=client-build /app/client/dist ./client/dist

# Copy migration/seed source files (knex needs these)
COPY server/src/db ./server/src/db
COPY server/knexfile.ts ./server/
COPY server/tsconfig.json ./server/

EXPOSE 3001

CMD ["node", "server/dist/index.js"]
