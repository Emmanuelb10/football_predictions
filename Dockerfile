# Stage 1: Build server
FROM node:22-slim AS server-build
WORKDIR /app/server
COPY server/package*.json ./
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

# Server deps (include dev for ts-node migrations)
COPY server/package*.json ./server/
RUN cd server && npm ci

# Copy built server + client
COPY --from=server-build /app/server/dist ./server/dist
COPY --from=client-build /app/client/dist ./client/dist

# Copy migration/seed source files (knex needs these)
COPY server/src/db ./server/src/db
COPY server/knexfile.ts ./server/
COPY server/tsconfig.json ./server/

EXPOSE 3001

CMD ["node", "server/dist/index.js"]
