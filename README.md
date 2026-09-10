# platform

Plataforma compartida de Servicoop. El único despliegue es
`docker-compose.yml`; no contiene lógica de producto.

## Componentes

| Componente | Responsabilidad | Runtime |
|---|---|---|
| `tls-terminator` | Terminación TLS y gestión automática de certificados | `80/443` |
| `edge-platform/edge-gateway` | Autorización y ruteo HTTP declarativo | interno |
| `edge-platform/edge-auth` | Sesión firmada y modo protegido | interno |
| `artifact-repository` | APK y metadata verificable | `/repo/*` |
| `frontend-foundation` | Componentes y estilos de build web | sin runtime |

## Frontera

`edge-platform/edge-gateway/config/routes.txt` es la fuente única de rutas. Cada
registro usa:

```text
scope|match|path|destination|uri_mode|access|profile|mirror
```

Las rutas públicas/protegidas se autorizan mediante `edge-auth`; no se confía en
cookies ni encabezados aportados por el cliente. `80/443` son los únicos puertos
de frontera. Los upstreams Docker se alcanzan por nombre y puerto interno.

## Red

El Compose crea `servicoop-edge-net`. Los productos la declaran externa y deben
desplegarse después de `platform`. Solo se conectan servicios publicados por el
gateway. Los quick tunnels pertenecen a los productos y son conexiones salientes.

## Artefactos

`artifact-repository/volumes/repository/{app}/app.apk` se sirve como:

```text
/repo/{app}/release
/repo/{app}/app.apk
```

`release` expone versión, `versionCode`, tamaño, fecha y SHA-256 calculados del
APK almacenado. El contenedor recibe el volumen en solo lectura.

## Frontend

`frontend-foundation` es una dependencia de build. Define tokens, shell,
componentes comunes y presentación UTC−3 en formato de 24 horas. No expone
puertos ni accede a APIs en runtime.

## Configuración

Copiar `.env.example` a `.env` y completar valores obligatorios. Los secretos no
se versionan; los archivos locales deben conservar permisos restrictivos.

## TLS y rutas de operación

`tls-terminator` obtiene y renueva automáticamente el certificado de
`ACME_DOMAIN`. Mantiene abiertos los puertos 80 y 443 y emite mediante el desafío
TLS-ALPN-01 por el puerto 443; si la autoridad certificadora no está disponible, conserva
el proceso activo y reintenta sin bloquear el inicio de `edge-gateway`. Las claves
permanecen en el volumen privado `caddy-data` y no se comparten con el gateway.
Android conserva la validación TLS del sistema.

Las APIs `/chatcheto-bkr-gis-api/`, `/chatcheto-bkr-movil-api/` y
`/chatcheto-gis-api/` se enrutan y protegen aquí. Atendedor sirve exclusivamente
su distribución web. PostgreSQL y los servicios internos no publican puertos.

Excepción de construcción: edge-gateway interpreta Python y genera configuración
al iniciar a partir del archivo de rutas montado; no tiene dependencias Python
ni compilación que requieran una etapa de build independiente. El resto de las
imágenes con dependencias separa su instalación del runtime. Los paquetes del
sistema instalados con apk/apt siguen los repositorios de la distribución fijada;
no se declara reproducibilidad binaria de esos repositorios.
