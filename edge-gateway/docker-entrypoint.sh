#!/bin/sh
set -eu

python /app/generate_routes.py \
    /etc/nginx/source/routes.txt \
    /etc/nginx/generated/public-locations.conf \
    /etc/nginx/generated/internal-servers.conf

nginx -e /dev/stderr -t -c /etc/nginx/source/nginx.conf
exec nginx -e /dev/stderr -c /etc/nginx/source/nginx.conf -g 'daemon off;'
