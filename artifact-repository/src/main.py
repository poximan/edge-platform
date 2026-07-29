import hashlib
import html
import logging
import os
import re
import sys
import threading
from dataclasses import dataclass
from pathlib import Path

from flask import Flask, Response, jsonify, send_file
from loguru import logger as androguard_logger
from src.time_provider import PresentationLogFormatter, time_provider


androguard_logger.remove()
androguard_logger.add(sys.stderr, level="ERROR")

from androguard.core.apk import APK


APP_NAME_PATTERN = re.compile(r"^[a-z0-9][a-z0-9-]{0,62}$")
REPOSITORY_ROOT = Path(os.environ.get("REPOSITORY_ROOT", "/repository")).resolve()

app = Flask(__name__)
log_handler = logging.StreamHandler()
log_handler.setFormatter(PresentationLogFormatter("%(asctime)s %(levelname)s %(message)s"))
logging.basicConfig(level=logging.WARNING, handlers=[log_handler])


@dataclass(frozen=True)
class ReleaseMetadata:
    app_name: str
    app_version: str
    version_code: str
    size_bytes: int
    content_hash: str
    modified_at: str
    signature: tuple[int, int]

    def response(self) -> dict:
        return {
            "appName": self.app_name,
            "appVersion": self.app_version,
            "versionCode": self.version_code,
            "apkPath": f"/repo/{self.app_name}/app.apk",
            "sizeBytes": self.size_bytes,
            "hashAlgorithm": "sha256",
            "contentHash": self.content_hash,
            "modifiedAt": self.modified_at,
        }


class MetadataCache:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._metadata: dict[str, ReleaseMetadata] = {}

    def current(self, app_name: str, apk_path: Path) -> ReleaseMetadata:
        stat = apk_path.stat()
        signature = (stat.st_mtime_ns, stat.st_size)
        with self._lock:
            cached = self._metadata.get(app_name)
            if cached is not None and cached.signature == signature:
                return cached

            apk = APK(str(apk_path))
            app_version = apk.get_androidversion_name()
            version_code = apk.get_androidversion_code()
            if app_version is None or not app_version.strip():
                raise RuntimeError("El APK no declara versionName")
            if version_code is None or not str(version_code).strip():
                raise RuntimeError("El APK no declara versionCode")

            digest = hashlib.sha256()
            with apk_path.open("rb") as apk_file:
                for chunk in iter(lambda: apk_file.read(1024 * 1024), b""):
                    digest.update(chunk)

            metadata = ReleaseMetadata(
                app_name=app_name,
                app_version=app_version.strip(),
                version_code=str(version_code).strip(),
                size_bytes=stat.st_size,
                content_hash=digest.hexdigest(),
                modified_at=time_provider.utc_iso_from_epoch(stat.st_mtime),
                signature=signature,
            )
            self._metadata[app_name] = metadata
            return metadata


metadata_cache = MetadataCache()


def repository_path(app_name: str) -> Path:
    if APP_NAME_PATTERN.fullmatch(app_name) is None:
        raise ValueError("Nombre de aplicacion invalido")
    return REPOSITORY_ROOT / app_name / "app.apk"


def published_apps() -> list[str]:
    if not REPOSITORY_ROOT.is_dir():
        return []
    return sorted(
        entry.name
        for entry in REPOSITORY_ROOT.iterdir()
        if entry.is_dir()
        and APP_NAME_PATTERN.fullmatch(entry.name) is not None
        and (entry / "app.apk").is_file()
    )


@app.get("/health")
def health():
    return jsonify({"status": "UP"})


@app.get("/repo/")
def index():
    links = "\n".join(
        f'<li><a href="/repo/{html.escape(app_name)}/app.apk">{html.escape(app_name)}</a></li>'
        for app_name in published_apps()
    )
    document = f"""<!doctype html>
<html lang="es">
<head><meta charset="utf-8"><title>Repositorio de aplicaciones</title></head>
<body><h1>Aplicaciones publicadas</h1><ul>{links}</ul></body>
</html>
"""
    return Response(document, mimetype="text/html")


@app.get("/repo/<app_name>/release")
def release(app_name: str):
    try:
        apk_path = repository_path(app_name)
    except ValueError as error:
        return jsonify({"code": "INVALID_APP_NAME", "message": str(error)}), 400
    if not apk_path.is_file():
        return jsonify({"code": "APK_NOT_FOUND", "message": "No hay un APK publicado"}), 404
    try:
        response = jsonify(metadata_cache.current(app_name, apk_path).response())
        response.headers["Cache-Control"] = "no-store"
        return response
    except Exception:
        app.logger.exception("No se pudo analizar el APK publicado")
        return jsonify({"code": "INVALID_APK", "message": "El APK publicado no cumple el contrato"}), 500


@app.get("/repo/<app_name>/app.apk")
def download(app_name: str):
    try:
        apk_path = repository_path(app_name)
    except ValueError as error:
        return jsonify({"code": "INVALID_APP_NAME", "message": str(error)}), 400
    if not apk_path.is_file():
        return jsonify({"code": "APK_NOT_FOUND", "message": "No hay un APK publicado"}), 404
    response = send_file(
        apk_path,
        mimetype="application/vnd.android.package-archive",
        as_attachment=True,
        download_name=f"{app_name}.apk",
        conditional=True,
        max_age=0,
    )
    response.headers["Cache-Control"] = "no-store"
    return response
