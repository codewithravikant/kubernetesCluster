FROM node:22.23.3-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
# npm 12 needs Node >= 22.22.2. The image ships npm 10 and prints an upgrade notice.
ENV NPM_CONFIG_UPDATE_NOTIFIER=false
RUN npm install -g npm@12.2.0 \
 && npm ci --no-audit --no-fund
COPY index.html vite.config.js ./
COPY src ./src
RUN npm run build

FROM nginx:1.29-alpine
RUN apk upgrade --no-cache
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY docker-entrypoint.sh /docker-entrypoint-ii.sh
COPY --from=build /app/dist /usr/share/nginx/html
RUN chmod +x /docker-entrypoint-ii.sh
EXPOSE 80
ENTRYPOINT ["/docker-entrypoint-ii.sh"]
