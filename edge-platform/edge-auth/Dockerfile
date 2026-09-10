FROM python:3.13.5-slim-bookworm AS python-deps
WORKDIR /deps
COPY edge-platform/edge-auth/requirements.txt /deps/requirements.txt
RUN python -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir -r /deps/requirements.txt

FROM python:3.13.5-slim-bookworm

ARG APP_UID=1000
ARG APP_GID=1000

RUN groupadd --gid "${APP_GID}" appgroup \
    && useradd --uid "${APP_UID}" --gid "${APP_GID}" --create-home --shell /bin/sh appuser \
    && install -d -o "${APP_UID}" -g "${APP_GID}" /app /data

WORKDIR /app

COPY --from=python-deps /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

COPY --chown=${APP_UID}:${APP_GID} edge-platform/edge-auth/src /app/src

ENV PYTHONPATH=/app \
    EDGE_SESSION_COOKIE_NAME=servicoop_edge_session \
    EDGE_SESSION_TTL_SECONDS=28800

EXPOSE 8085

USER 1000:1000

CMD ["gunicorn", "--bind", "0.0.0.0:8085", "--workers", "2", "--threads", "2", "--access-logfile", "-", "src.main:app"]
