FROM node:24-bookworm-slim@sha256:01d566e8d94d8c619591d78652babfccd3c6992a3dffa9ed5ab39e11cf6c70e9 AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
RUN npm ci --no-audit --no-fund

FROM dependencies AS build
COPY tsconfig.base.json ./
COPY packages/contracts ./packages/contracts
COPY apps/api/tsconfig*.json ./apps/api/
COPY apps/api/src ./apps/api/src
COPY apps/web ./apps/web
RUN npm run build

FROM build AS production-dependencies
RUN npm prune --omit=dev --no-audit --no-fund

FROM node:24-bookworm-slim@sha256:01d566e8d94d8c619591d78652babfccd3c6992a3dffa9ed5ab39e11cf6c70e9 AS api
ENV NODE_ENV=production
WORKDIR /app/apps/api
COPY --from=production-dependencies --chown=node:node /app/node_modules /app/node_modules
COPY --from=build --chown=node:node /app/apps/api/dist ./dist
COPY --from=build --chown=node:node /app/apps/api/package.json ./package.json
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]

FROM caddy:2-alpine@sha256:78bd35025c7ba85961dd149ae670315129954e77abe2383ac47c89106b35ade9 AS web
COPY --from=build /app/apps/web/dist /srv
COPY infrastructure/staging/Caddyfile /etc/caddy/Caddyfile
