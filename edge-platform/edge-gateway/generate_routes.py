#!/usr/bin/env python3
import re
import sys
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path


HOST_PATTERN = re.compile(r"^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$")
TARGET_PATTERN = re.compile(r"^(?P<host>[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?):(?P<port>[0-9]{1,5})$")
PATH_PATTERN = re.compile(r"^/[A-Za-z0-9._~/%:@+,-]*$")
MIRROR_PATTERN = re.compile(
    r"^(?P<target>[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?:[0-9]{1,5})(?P<path>/[A-Za-z0-9._~/%:@+,-]*)$",
)


@dataclass(frozen=True)
class Rule:
    scope: str
    match: str
    path: str
    destination: str
    uri_mode: str
    access: str
    profile: str
    mirror: str | None
    line_number: int


def fail(line_number: int, message: str) -> None:
    raise ValueError(f"routes.txt:{line_number}: {message}")


def validate_target(value: str, line_number: int) -> None:
    match = TARGET_PATTERN.fullmatch(value)
    if match is None:
        fail(line_number, f"destino invalido: {value}")
    port = int(match.group("port"))
    if port < 1 or port > 65535:
        fail(line_number, f"puerto fuera de rango: {port}")


def parse_rules(path: Path) -> list[Rule]:
    rules: list[Rule] = []
    identities: set[tuple[str, str, str]] = set()

    for line_number, raw_line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        fields = [field.strip() for field in line.split("|")]
        if len(fields) != 8:
            fail(line_number, "se esperaban 8 campos separados por |")
        scope, match_type, route_path, destination, uri_mode, access, profile, mirror = fields

        if scope != "public" and HOST_PATTERN.fullmatch(scope) is None:
            fail(line_number, f"scope invalido: {scope}")
        if match_type not in {"exact", "prefix"}:
            fail(line_number, f"match invalido: {match_type}")
        if PATH_PATTERN.fullmatch(route_path) is None:
            fail(line_number, f"ruta invalida: {route_path}")
        if match_type == "prefix" and route_path != "/" and not route_path.endswith("/"):
            fail(line_number, "una ruta prefix debe terminar en /")

        is_redirect = destination.startswith("redirect:")
        if is_redirect:
            redirect_path = destination.removeprefix("redirect:")
            if match_type != "exact" or PATH_PATTERN.fullmatch(redirect_path) is None:
                fail(line_number, "un redirect debe ser exact y apuntar a una ruta local valida")
            if uri_mode != "-" or access != "public" or profile != "-" or mirror != "-":
                fail(line_number, "un redirect no admite opciones de proxy")
        else:
            validate_target(destination, line_number)
            if uri_mode not in {"preserve", "strip"}:
                fail(line_number, f"uri_mode invalido: {uri_mode}")
            if access not in {"public", "protected-deny", "protected-redirect"}:
                fail(line_number, f"access invalido: {access}")
            if profile not in {"standard", "stream", "sse", "static"}:
                fail(line_number, f"profile invalido: {profile}")
            if mirror != "-":
                mirror_match = MIRROR_PATTERN.fullmatch(mirror)
                if mirror_match is None:
                    fail(line_number, f"mirror invalido: {mirror}")
                validate_target(mirror_match.group("target"), line_number)

        identity = (scope, match_type, route_path)
        if identity in identities:
            fail(line_number, f"regla duplicada: {identity}")
        identities.add(identity)

        rules.append(
            Rule(
                scope=scope,
                match=match_type,
                path=route_path,
                destination=destination,
                uri_mode=uri_mode,
                access=access,
                profile=profile,
                mirror=None if mirror == "-" else mirror,
                line_number=line_number,
            ),
        )

    if not rules:
        raise ValueError("routes.txt no contiene reglas")
    return rules


def indent(lines: list[str], spaces: int) -> list[str]:
    prefix = " " * spaces
    return [f"{prefix}{line}" if line else "" for line in lines]


def render_access(rule: Rule) -> list[str]:
    if rule.access == "protected-deny":
        return ["auth_request /__edge_auth_verify;"]
    if rule.access == "protected-redirect":
        return [
            "auth_request /__edge_auth_verify;",
            "error_page 401 403 = @edge_auth_redirect;",
        ]
    return ["auth_request /__edge_auth_session;"]


def render_proxy(rule: Rule, index: int) -> list[str]:
    location = f"location = {rule.path}" if rule.match == "exact" else f"location ^~ {rule.path}"
    lines = [f"{location} {{"]
    body = render_access(rule)
    body.extend(
        [
            "auth_request_set $edge_mode $upstream_http_x_edge_mode;",
            "auth_request_set $edge_user $upstream_http_x_edge_user;",
        ],
    )
    if rule.mirror is not None:
        body.append(f"mirror /__edge_mirror_{index};")
        body.append("mirror_request_body off;")

    body.append(f"set $route_upstream_{index} http://{rule.destination};")

    if rule.uri_mode == "strip":
        escaped_path = re.escape(rule.path)
        if rule.match == "exact":
            body.append(f"rewrite ^{escaped_path}$ / break;")
        else:
            body.append(f"rewrite ^{escaped_path}(.*)$ /$1 break;")

    body.extend(
        [
            f"proxy_pass $route_upstream_{index};",
            "proxy_http_version 1.1;",
            "proxy_connect_timeout 3s;",
            "proxy_set_header Host $host;",
            "proxy_set_header X-Real-IP $remote_addr;",
            "proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;",
            "proxy_set_header X-Forwarded-Proto $scheme;",
            "proxy_set_header X-Forwarded-Host $host;",
            "proxy_set_header X-Forwarded-Port $server_port;",
            "proxy_set_header X-Edge-Mode $edge_mode;",
            "proxy_set_header X-Edge-User $edge_user;",
            "proxy_set_header Upgrade $http_upgrade;",
            "proxy_set_header Connection $connection_upgrade;",
        ],
    )
    if rule.uri_mode == "strip":
        body.append(f"proxy_set_header X-Forwarded-Prefix {rule.path.rstrip('/')};")

    if rule.profile == "stream":
        body.extend(["proxy_buffering off;", "proxy_read_timeout 3600s;", "proxy_send_timeout 3600s;"])
    elif rule.profile == "sse":
        body.extend(
            [
                "proxy_buffering off;",
                "proxy_cache off;",
                "proxy_read_timeout 3600s;",
                "add_header X-Accel-Buffering no;",
            ],
        )
    elif rule.profile == "static":
        body.extend(["proxy_buffering on;", "proxy_read_timeout 60s;"])
    else:
        body.extend(["proxy_buffering off;", "proxy_read_timeout 30s;"])

    lines.extend(indent(body, 4))
    lines.append("}")
    return lines


def render_mirror(rule: Rule, index: int) -> list[str]:
    if rule.mirror is None:
        return []
    mirror_match = MIRROR_PATTERN.fullmatch(rule.mirror)
    if mirror_match is None:
        raise AssertionError("mirror sin validar")
    target = mirror_match.group("target")
    path = mirror_match.group("path")
    return [
        f"location = /__edge_mirror_{index} {{",
        "    internal;",
        f"    set $mirror_upstream_{index} http://{target};",
        f"    proxy_pass $mirror_upstream_{index}{path};",
        "    proxy_method POST;",
        "    proxy_pass_request_body off;",
        "    proxy_set_header Content-Length \"\";",
        "    proxy_set_header X-Edge-Time $time_iso8601;",
        "    proxy_set_header X-Edge-Remote-Addr $remote_addr;",
        "    proxy_set_header X-Edge-Forwarded-For $http_x_forwarded_for;",
        "    proxy_set_header X-Edge-Method $request_method;",
        "    proxy_set_header X-Edge-Path $uri;",
        "    proxy_set_header X-Edge-Query $args;",
        "    proxy_set_header X-Edge-Status $status;",
        "    proxy_set_header X-Edge-Request-Time $request_time;",
        "    proxy_set_header X-Edge-Protocol $server_protocol;",
        "    proxy_set_header X-Edge-Upgrade $http_upgrade;",
        "    proxy_set_header X-Edge-Referer $http_referer;",
        "    proxy_set_header X-Edge-User-Agent $http_user_agent;",
        "}",
    ]


def render_rule(rule: Rule, index: int) -> list[str]:
    if rule.destination.startswith("redirect:"):
        destination = rule.destination.removeprefix("redirect:")
        return [f"location = {rule.path} {{", f"    return 308 {destination}$is_args$args;", "}"]
    return render_proxy(rule, index)


def render_public(rules: list[Rule]) -> str:
    lines: list[str] = []
    for index, rule in enumerate(rules, 1):
        if rule.scope != "public":
            continue
        lines.extend(render_rule(rule, index))
        lines.append("")
        lines.extend(render_mirror(rule, index))
        if rule.mirror is not None:
            lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def render_internal(rules: list[Rule]) -> str:
    grouped: dict[str, list[tuple[int, Rule]]] = defaultdict(list)
    for index, rule in enumerate(rules, 1):
        if rule.scope != "public":
            grouped[rule.scope].append((index, rule))

    lines = [
        "server {",
        "    listen 8080 default_server;",
        "    server_name _;",
        "    location = /gateway-health {",
        "        access_log off;",
        "        default_type application/json;",
        "        return 200 '{\"status\":\"UP\"}';",
        "    }",
        "    location / { return 404; }",
        "}",
        "",
    ]

    for scope in sorted(grouped):
        scoped_rules = grouped[scope]
        lines.extend(["server {", "    listen 8080;", f"    server_name {scope};", ""])
        lines.extend(
            [
                "    location = /gateway-health {",
                "        access_log off;",
                "        default_type application/json;",
                "        return 200 '{\"status\":\"UP\"}';",
                "    }",
                "",
                "    location = /__edge_auth_session {",
                "        internal;",
                "        proxy_pass http://edge-auth:8085/session;",
                "        proxy_pass_request_body off;",
                '        proxy_set_header Content-Length "";',
                "        proxy_set_header Cookie $http_cookie;",
                "    }",
                "",
                "    location = /__edge_auth_verify {",
                "        internal;",
                "        proxy_pass http://edge-auth:8085/verify;",
                "        proxy_pass_request_body off;",
                '        proxy_set_header Content-Length "";',
                "        proxy_set_header Cookie $http_cookie;",
                "    }",
                "",
                "    location @edge_auth_redirect {",
                "        return 302 /;",
                "    }",
                "",
            ],
        )
        has_root_prefix = False
        for index, rule in scoped_rules:
            has_root_prefix = has_root_prefix or (rule.match == "prefix" and rule.path == "/")
            lines.extend(indent(render_rule(rule, index), 4))
            lines.append("")
            mirror_lines = render_mirror(rule, index)
            if mirror_lines:
                lines.extend(indent(mirror_lines, 4))
                lines.append("")
        if not has_root_prefix:
            lines.append("    location / { return 404; }")
        lines.append("}")
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def main() -> None:
    if len(sys.argv) != 4:
        raise SystemExit("uso: generate_routes.py ROUTES PUBLIC_OUTPUT INTERNAL_OUTPUT")
    source = Path(sys.argv[1])
    public_output = Path(sys.argv[2])
    internal_output = Path(sys.argv[3])
    rules = parse_rules(source)
    public_output.write_text(render_public(rules), encoding="utf-8", newline="\n")
    internal_output.write_text(render_internal(rules), encoding="utf-8", newline="\n")


if __name__ == "__main__":
    main()
