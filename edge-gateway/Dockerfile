FROM python:3.13.5-alpine3.22

ARG APP_UID=1000
ARG APP_GID=1000

RUN apk add --no-cache nginx openssl gettext \
    && addgroup --gid "${APP_GID}" appgroup \
    && adduser --uid "${APP_UID}" --ingroup appgroup --disabled-password --home /home/appuser --shell /bin/sh appuser \
    && install -d -o "${APP_UID}" -g "${APP_GID}" \
        /etc/nginx/generated \
        /etc/nginx/tls \
        /tmp/nginx/client_temp \
        /tmp/nginx/proxy_temp \
        /tmp/nginx/fastcgi_temp \
        /tmp/nginx/uwsgi_temp \
        /tmp/nginx/scgi_temp \
    && openssl req -x509 -nodes -newkey rsa:2048 \
        -keyout /etc/nginx/tls/key.pem \
        -out /etc/nginx/tls/cert.pem \
        -days 365 \
        -subj "/CN=comunicaciones.servicoop.com.ar" \
    && chown "${APP_UID}:${APP_GID}" /etc/nginx/tls/key.pem /etc/nginx/tls/cert.pem \
    && chmod 600 /etc/nginx/tls/key.pem /etc/nginx/tls/cert.pem

WORKDIR /app

COPY --chown=${APP_UID}:${APP_GID} edge-gateway/generate_routes.py /app/generate_routes.py
COPY --chown=${APP_UID}:${APP_GID} edge-gateway/config /etc/nginx/source
COPY --chown=${APP_UID}:${APP_GID} edge-gateway/html /usr/share/nginx/html
COPY --chown=${APP_UID}:${APP_GID} edge-gateway/docker-entrypoint.sh /app/docker-entrypoint.sh

RUN chmod 0555 /app/docker-entrypoint.sh /app/generate_routes.py

ENV PYTHONPATH=/app:/shared

EXPOSE 8080 8081 8443

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=6 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8080/gateway-health', timeout=2)"

USER 1000:1000

ENTRYPOINT ["/app/docker-entrypoint.sh"]
