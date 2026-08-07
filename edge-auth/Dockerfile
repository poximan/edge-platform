FROM python:3.13.5-slim-bookworm

ARG APP_UID=1000
ARG APP_GID=1000

RUN groupadd --gid "${APP_GID}" appgroup \
    && useradd --uid "${APP_UID}" --gid "${APP_GID}" --create-home --shell /bin/sh appuser \
    && install -d -o "${APP_UID}" -g "${APP_GID}" /app

WORKDIR /app

COPY --chown=${APP_UID}:${APP_GID} edge-auth/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir --requirement /app/requirements.txt

COPY --chown=${APP_UID}:${APP_GID} edge-auth/src /app/src

ENV PYTHONPATH=/app \
    EDGE_SESSION_COOKIE_NAME=servicoop_edge_session \
    EDGE_SESSION_TTL_SECONDS=28800

EXPOSE 8085

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=6 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8085/health', timeout=2)"

USER 1000:1000

CMD ["gunicorn", "--bind", "0.0.0.0:8085", "--workers", "2", "--threads", "2", "--access-logfile", "-", "src.main:app"]
