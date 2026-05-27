FROM nginx:1.25-alpine

RUN apk add --no-cache gettext openssl \
    && mkdir -p /etc/nginx/tls \
    && openssl req -x509 -nodes -newkey rsa:2048 \
        -keyout /etc/nginx/tls/key.pem \
        -out /etc/nginx/tls/cert.pem \
        -days 365 \
        -subj "/CN=comunicaciones.servicoop.com.ar" \
    && chmod 600 /etc/nginx/tls/key.pem /etc/nginx/tls/cert.pem

COPY edge-router/conf/nginx.conf /etc/nginx/nginx.conf
COPY edge-router/conf/protected-users.map /etc/nginx/templates/protected-users.map.template
COPY edge-router/html /usr/share/nginx/html
COPY edge-router/docker-entrypoint.sh /docker-entrypoint.sh

RUN chmod +x /docker-entrypoint.sh

ENTRYPOINT ["/docker-entrypoint.sh"]
