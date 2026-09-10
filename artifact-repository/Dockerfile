FROM python:3.13.5-slim-bookworm AS python-deps
WORKDIR /deps
COPY artifact-repository/requirements.txt /deps/requirements.txt
RUN python -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir -r /deps/requirements.txt

FROM python:3.13.5-slim-bookworm

ARG APP_UID=1000
ARG APP_GID=1000

RUN groupadd --gid "${APP_GID}" appgroup \
    && useradd --uid "${APP_UID}" --gid "${APP_GID}" --create-home --shell /bin/sh appuser \
    && install -d -o "${APP_UID}" -g "${APP_GID}" /app /shared /repository

WORKDIR /app

COPY --from=python-deps /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

COPY --chown=${APP_UID}:${APP_GID} artifact-repository/src /app/src

ENV PYTHONPATH=/app:/shared \
    REPOSITORY_ROOT=/repository

EXPOSE 8080

USER 1000:1000

CMD ["gunicorn", "--bind", "0.0.0.0:8080", "--workers", "1", "--threads", "4", "--log-level", "warning", "--access-logfile", "-", "src.main:app"]
