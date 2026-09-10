FROM python:3.13.5-slim-bookworm

ARG APP_UID=1000
ARG APP_GID=1000

RUN groupadd --gid "${APP_GID}" appgroup \
    && useradd --uid "${APP_UID}" --gid "${APP_GID}" --create-home --shell /bin/sh appuser \
    && install -d -o "${APP_UID}" -g "${APP_GID}" /app

WORKDIR /app
COPY --chown=${APP_UID}:${APP_GID} docker-metrics-proxy/src /app/src

ENV PYTHONPATH=/app \
    PYTHONDONTWRITEBYTECODE=1
EXPOSE 2375

USER 1000:1000
CMD ["python", "-m", "src.main"]
