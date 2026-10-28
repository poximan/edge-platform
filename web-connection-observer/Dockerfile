FROM python:3.13.5-slim-bookworm
RUN groupadd --gid 1000 appgroup && useradd --uid 1000 --gid 1000 --create-home appuser
WORKDIR /app
COPY --chown=1000:1000 web-navigation/navigation_catalog.py /app/navigation_catalog.py
COPY --chown=1000:1000 web-connection-observer/src /app/src
ENV PYTHONPATH=/app PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
USER 1000:1000
EXPOSE 8092
CMD ["python", "-m", "src.main"]
