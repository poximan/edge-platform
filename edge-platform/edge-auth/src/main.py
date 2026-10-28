import base64
import hashlib
import hmac
import json
import os
import posixpath
import re
from urllib.parse import unquote

from flask import Flask, Response, jsonify, request

from .time_provider import epoch_seconds
from navigation_catalog import NavigationCatalog
from .client_registry import ClientRegistry
from .portal_access import PortalAccess


def _required(name: str) -> str:
    value = os.getenv(name)
    if value is None or not value.strip():
        raise RuntimeError(f"Falta variable obligatoria: {name}")
    return value.strip()


PROTECTED_USER = _required("EDGE_PROTECTED_USER")
PROTECTED_PASS = _required("EDGE_PROTECTED_PASS")
KITE_CAT_USER = _required("KITE_CAT_USER")
KITE_CAT_PASS = _required("KITE_CAT_PASS")
SESSION_SECRET = _required("EDGE_SESSION_SECRET").encode("utf-8")
COOKIE_NAME = _required("EDGE_SESSION_COOKIE_NAME")
KITE_CAT_COOKIE_NAME = f"{COOKIE_NAME}_kite_cat"
SESSION_TTL_SECONDS = int(_required("EDGE_SESSION_TTL_SECONDS"))
if len(SESSION_SECRET) < 32:
    raise RuntimeError("EDGE_SESSION_SECRET debe contener al menos 32 caracteres")
if SESSION_TTL_SECONDS < 60:
    raise RuntimeError("EDGE_SESSION_TTL_SECONDS debe ser al menos 60")

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 4096
client_registry = ClientRegistry(_required('WEB_CLIENTS_URL'), _required('WEB_CLIENTS_KEY'))
portal_access = PortalAccess(client_registry, NavigationCatalog(_required('WEB_NAVIGATION_CATALOG_FILE')))


def _encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(f"{value}{padding}".encode("ascii"))


def _sign(payload: str) -> str:
    digest = hmac.new(SESSION_SECRET, payload.encode("ascii"), hashlib.sha256).digest()
    return _encode(digest)


def _issue_session(user: str, audience: str = "platform") -> str:
    payload = _encode(
        json.dumps(
            {"user": user, "aud": audience, "exp": epoch_seconds() + SESSION_TTL_SECONDS},
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8")
    )
    return f"{payload}.{_sign(payload)}"


def _validate_session(token: str | None, audience: str = "platform") -> str | None:
    if token is None or token.count(".") != 1:
        return None
    payload, supplied_signature = token.split(".", 1)
    if re.fullmatch(r"[A-Za-z0-9_-]+", payload) is None:
        return None
    if re.fullmatch(r"[A-Za-z0-9_-]{43}", supplied_signature) is None:
        return None
    if not hmac.compare_digest(_sign(payload), supplied_signature):
        return None
    try:
        data = json.loads(_decode(payload).decode("utf-8"))
        user = str(data["user"])
        expires_at = int(data["exp"])
        token_audience = data.get("aud", "platform")
    except (KeyError, TypeError, ValueError, json.JSONDecodeError):
        return None
    if expires_at <= epoch_seconds():
        return None
    expected_user = KITE_CAT_USER if audience == "kite-cat" else PROTECTED_USER
    if token_audience != audience or not hmac.compare_digest(user.encode(), expected_user.encode()):
        return None
    return user


def _request_user() -> str | None:
    # Se usa la URI original enviada por el gateway, normalizada como el ruteo
    # de Nginx. El alcance nunca lo elige un encabezado del navegador.
    uri = request.headers.get("X-Edge-Original-URI", "/")
    path = posixpath.normpath(re.sub("/+", "/", unquote(uri.split("?", 1)[0])))
    kite_cat = path == "/kite-cat" or path.startswith("/kite-cat/")
    cookie = KITE_CAT_COOKIE_NAME if kite_cat else COOKIE_NAME
    return _validate_session(request.cookies.get(cookie), "kite-cat" if kite_cat else "platform")


def _mode_response(user: str | None, status: int = 204) -> Response:
    response = Response(status=status)
    response.headers["X-Edge-Mode"] = "protected" if user else "secure"
    if user:
        response.headers["X-Edge-User"] = user
    return response


def _clear_session(response: Response) -> Response:
    for cookie in (COOKIE_NAME, KITE_CAT_COOKIE_NAME):
        response.delete_cookie(cookie, path="/", secure=True, httponly=True, samesite="Strict")
    return response


@app.get("/health")
def health():
    return jsonify({"status": "UP"})


@app.post("/login")
def login():
    return _login(PROTECTED_USER, PROTECTED_PASS, COOKIE_NAME, "platform")


@app.post("/kite-cat/login")
def kite_cat_login():
    return _login(KITE_CAT_USER, KITE_CAT_PASS, KITE_CAT_COOKIE_NAME, "kite-cat")


def _login(expected_user: str, expected_pass: str, cookie: str, audience: str):
    supplied_user = request.headers.get("X-Mode-User", "")
    supplied_pass = request.headers.get("X-Mode-Pass", "")
    user_ok = hmac.compare_digest(supplied_user.encode(), expected_user.encode())
    pass_ok = hmac.compare_digest(supplied_pass.encode(), expected_pass.encode())
    if not (user_ok and pass_ok):
        return _mode_response(None, 403)

    response = _mode_response(expected_user)
    response.set_cookie(
        cookie,
        _issue_session(expected_user, audience),
        max_age=SESSION_TTL_SECONDS,
        path="/",
        secure=True,
        httponly=True,
        samesite="Strict",
    )
    return response


@app.post("/secure")
def secure_mode():
    return _clear_session(_mode_response(None))


@app.get("/logout")
def logout():
    response = _clear_session(Response(status=302))
    response.headers["Location"] = "/"
    return response


@app.get("/session")
def session():
    user = _request_user()
    denied = _portal_check()
    if denied is not None:
        return denied
    return _mode_response(user)


@app.get("/verify")
def verify():
    user = _request_user()
    if user is None:
        return _mode_response(None, 401)
    denied = _portal_check()
    if denied is not None:
        return denied
    return _mode_response(user)


def _portal_check():
    if request.headers.get('X-Edge-Public') != '1':
        return None
    try:
        allowed = portal_access.allows(request.headers.get('X-Edge-Client-IP', ''),
                                      request.headers.get('X-Edge-Original-URI', ''))
        return None if allowed else _mode_response(None, 401)
    except Exception:
        app.logger.exception('No se pudo comprobar la primera visita al landing')
        return _mode_response(None, 503)


@app.get('/landing')
def landing():
    try:
        client_registry.event(request.headers.get('X-Edge-Client-IP', ''), {'type': 'landing'})
        return Response(status=204)
    except Exception:
        app.logger.exception('No se pudo registrar la visita al landing')
        return Response(status=503)


@app.post('/events')
def navigation_event():
    origin = f"{request.headers.get('X-Forwarded-Proto')}://{request.headers.get('X-Forwarded-Host')}"
    if (not request.is_json or request.headers.get('X-Portal-Event') != '1'
            or request.headers.get('Origin') != origin
            or request.headers.get('Sec-Fetch-Site') == 'cross-site'):
        return jsonify({'error': 'Evento no permitido'}), 403
    event = request.get_json()
    if not isinstance(event, dict) or event.get('type') not in {'attempt', 'view'}:
        return jsonify({'error': 'Evento invalido'}), 400
    if set(event) - {'type', 'path', 'screen'} or not isinstance(event.get('path'), str):
        return jsonify({'error': 'Destino invalido'}), 400
    try:
        client_registry.event(request.headers.get('X-Edge-Client-IP', ''), event)
        return Response(status=204)
    except Exception:
        app.logger.exception('No se pudo registrar la navegacion')
        return jsonify({'error': 'Registro de navegacion no disponible'}), 503
