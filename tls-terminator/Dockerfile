FROM caddy:2.10.2-alpine

ARG APP_UID=1000
ARG APP_GID=1000

RUN addgroup --gid "${APP_GID}" appgroup \
    && adduser --uid "${APP_UID}" --ingroup appgroup --disabled-password --home /home/appuser --shell /sbin/nologin appuser \
    && chown -R "${APP_UID}:${APP_GID}" /data /config \
    && apk add --no-cache --virtual .cap-tools libcap \
    && setcap -r /usr/bin/caddy \
    && apk del .cap-tools

COPY --chown=${APP_UID}:${APP_GID} tls-terminator/Caddyfile /etc/caddy/Caddyfile

EXPOSE 8080 8082 8443

USER ${APP_UID}:${APP_GID}

CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
