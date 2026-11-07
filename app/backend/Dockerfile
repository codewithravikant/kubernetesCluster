FROM node:22.23.3-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
ENV NPM_CONFIG_UPDATE_NOTIFIER=false
RUN npm install -g npm@12.2.0 \
 && npm ci --omit=dev --no-audit --no-fund

FROM node:22.23.3-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
# The process is `node` only. Drop the base image's npm so Trivy does not
# fail the image on HIGH findings inside /usr/local/lib/node_modules/npm.
USER root
RUN rm -rf /usr/local/lib/node_modules/npm \
           /usr/local/bin/npm \
           /usr/local/bin/npx \
           /usr/local/bin/corepack
EXPOSE 3000
USER node
CMD ["node", "src/index.js"]
