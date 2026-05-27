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

envsubst '${EDGE_PROTECTED_USER} ${EDGE_PROTECTED_PASS}' \
    < /etc/nginx/templates/protected-users.map.template \
    > /etc/nginx/conf.d/protected-users.map

exec nginx -g 'daemon off;'
