FROM python:3.13.5-slim-bookworm

ARG APP_UID=1000
ARG APP_GID=1000

RUN groupadd --gid "${APP_GID}" appgroup \
    && useradd --uid "${APP_UID}" --gid "${APP_GID}" --create-home --shell /bin/sh appuser \
    && install -d -o "${APP_UID}" -g "${APP_GID}" /app /data

WORKDIR /app
COPY --chown=${APP_UID}:${APP_GID} resource-monitor/src /app/src
COPY --chown=${APP_UID}:${APP_GID} web-navigation/navigation_catalog.py /app/navigation_catalog.py
COPY --chown=${APP_UID}:${APP_GID} web-navigation/catalog.json /app/catalog.json
COPY --chown=${APP_UID}:${APP_GID} resource-monitor/static /app/static
COPY --chown=${APP_UID}:${APP_GID} frontend-foundation/src/styles/tokens.css /app/static/tokens.css
COPY --chown=${APP_UID}:${APP_GID} frontend-foundation/src/styles/base.css /app/static/base.css
COPY --chown=${APP_UID}:${APP_GID} frontend-foundation/src/navigation/visit-tracker.js /app/static/visit-tracker.js

ENV PYTHONPATH=/app \
    PYTHONDONTWRITEBYTECODE=1 \
    RESOURCE_DB_PATH=/data/resources.sqlite3 \
    DOCKER_METRICS_URL=http://docker-metrics-proxy:2375 \
    SAMPLE_INTERVAL_SECONDS=60 \
    RETENTION_DAYS=31
ENV WEB_NAVIGATION_CATALOG_FILE=/app/catalog.json WEB_CLIENTS_FILE=/clients/clients.txt

EXPOSE 8091
EXPOSE 8093/udp

USER 1000:1000
CMD ["python", "-m", "src.main"]
