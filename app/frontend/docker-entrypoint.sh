#!/bin/sh
set -eu
BACKEND_HOST="${BACKEND_HOST:-backend}"
BACKEND_PORT="${BACKEND_PORT:-3000}"
WEB_SERVER="${WEB_SERVER:-$(hostname)}"

sed \
  -e "s/BACKEND_HOST/${BACKEND_HOST}/g" \
  -e "s/BACKEND_PORT/${BACKEND_PORT}/g" \
  /etc/nginx/templates/default.conf.template > /etc/nginx/conf.d/default.conf

# Stamp web server identity into index.html for the UI
if [ -f /usr/share/nginx/html/index.html ]; then
  if grep -q 'name="web-server"' /usr/share/nginx/html/index.html; then
    sed -i.bak "s/content=\"[^\"]*\"/content=\"${WEB_SERVER}\"/" /usr/share/nginx/html/index.html || true
  else
    sed -i.bak "s|</head>|<meta name=\"web-server\" content=\"${WEB_SERVER}\" />\n<script>window.__WEB_SERVER__=\"${WEB_SERVER}\";</script>\n</head>|" \
      /usr/share/nginx/html/index.html
  fi
  rm -f /usr/share/nginx/html/index.html.bak
fi

exec nginx -g 'daemon off;'
