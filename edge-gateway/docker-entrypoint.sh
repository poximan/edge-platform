#!/bin/sh
set -eu

required_vars="
EDGE_PROTECTED_USER
EDGE_PROTECTED_PASS
"

for var_name in $required_vars
do
    eval "var_value=\${$var_name:-}"
    if [ -z "$var_value" ]; then
        echo "Falta variable obligatoria: $var_name" >&2
        exit 1
    fi
done

case "$EDGE_PROTECTED_USER" in
    *[!A-Za-z0-9._-]*)
        echo "EDGE_PROTECTED_USER contiene caracteres no permitidos" >&2
        exit 1
        ;;
esac

case "$EDGE_PROTECTED_PASS" in
    *[!A-Za-z0-9._~!@#%^+=-]*)
        echo "EDGE_PROTECTED_PASS contiene caracteres no permitidos" >&2
        exit 1
        ;;
esac

python /app/generate_routes.py \
    /etc/nginx/source/routes.txt \
    /etc/nginx/generated/public-locations.conf \
    /etc/nginx/generated/internal-servers.conf

envsubst '${EDGE_PROTECTED_USER} ${EDGE_PROTECTED_PASS}' \
    < /etc/nginx/source/protected-users.map \
    > /etc/nginx/generated/protected-users.map

nginx -t -c /etc/nginx/source/nginx.conf
exec nginx -c /etc/nginx/source/nginx.conf -g 'daemon off;'
