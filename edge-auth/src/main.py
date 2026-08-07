import base64
import hashlib
import hmac
import json
import os
import re

from flask import Flask, Response, jsonify, request

from .time_provider import epoch_seconds


def _required(name: str) -> str:
    value = os.getenv(name)
    if value is None or not value.strip():
        raise RuntimeError(f"Falta variable obligatoria: {name}")
    return value.strip()


PROTECTED_USER = _required("EDGE_PROTECTED_USER")
PROTECTED_PASS = _required("EDGE_PROTECTED_PASS")
SESSION_SECRET = _required("EDGE_SESSION_SECRET").encode("utf-8")
COOKIE_NAME = _required("EDGE_SESSION_COOKIE_NAME")
SESSION_TTL_SECONDS = int(_required("EDGE_SESSION_TTL_SECONDS"))

if len(SESSION_SECRET) < 32:
    raise RuntimeError("EDGE_SESSION_SECRET debe contener al menos 32 caracteres")
if SESSION_TTL_SECONDS < 60:
    raise RuntimeError("EDGE_SESSION_TTL_SECONDS debe ser al menos 60")

app = Flask(__name__)


def _encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(f"{value}{padding}".encode("ascii"))


def _sign(payload: str) -> str:
    digest = hmac.new(SESSION_SECRET, payload.encode("ascii"), hashlib.sha256).digest()
    return _encode(digest)


def _issue_session(user: str) -> str:
    payload = _encode(
        json.dumps(
            {"user": user, "exp": epoch_seconds() + SESSION_TTL_SECONDS},
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8")
    )
    return f"{payload}.{_sign(payload)}"


def _validate_session(token: str | None) -> str | None:
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
    except (KeyError, TypeError, ValueError, json.JSONDecodeError):
        return None
    if expires_at <= epoch_seconds():
        return None
    if not hmac.compare_digest(user, PROTECTED_USER):
        return None
    return user


def _mode_response(user: str | None, status: int = 204) -> Response:
    response = Response(status=status)
    response.headers["X-Edge-Mode"] = "protected" if user else "secure"
    if user:
        response.headers["X-Edge-User"] = user
    return response


def _clear_session(response: Response) -> Response:
    response.delete_cookie(
        COOKIE_NAME,
        path="/",
        secure=True,
        httponly=True,
        samesite="Strict",
    )
    return response


@app.get("/health")
def health():
    return jsonify({"status": "UP"})


@app.post("/login")
def login():
    supplied_user = request.headers.get("X-Mode-User", "")
    supplied_pass = request.headers.get("X-Mode-Pass", "")
    user_ok = hmac.compare_digest(supplied_user, PROTECTED_USER)
    pass_ok = hmac.compare_digest(supplied_pass, PROTECTED_PASS)
    if not (user_ok and pass_ok):
        return _mode_response(None, 403)

    response = _mode_response(PROTECTED_USER)
    response.set_cookie(
        COOKIE_NAME,
        _issue_session(PROTECTED_USER),
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
    user = _validate_session(request.cookies.get(COOKIE_NAME))
    return _mode_response(user)


@app.get("/verify")
def verify():
    user = _validate_session(request.cookies.get(COOKIE_NAME))
    if user is None:
        return _mode_response(None, 401)
    return _mode_response(user)
