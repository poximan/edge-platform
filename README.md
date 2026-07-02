# router-atrevido

Punto de entrada HTTP/HTTPS publico del ecosistema Servicoop.

## Responsabilidad

Este proyecto concentra la frontera publica:

- Redireccion HTTP a HTTPS.
- Terminacion TLS con certificado autofirmado.
- Pantalla de bienvenida de `comunicaciones.servicoop.com.ar`.
- Seleccion de modo seguro/protegido para Lechuza.
- Reverse proxy hacia servicios internos de `infra-monitor` y `chat-global`.
- Reverse proxy hacia `moto-tester`.
- Repositorio HTTP de artefactos APK.

La logica de ruteo publico no pertenece a `infra-monitor` ni a `chat-global`.

## Servicios

| Servicio | Rol |
| --- | --- |
| `edge-router` | NGINX publico, HTTPS, menu y reverse proxy |
| `repo-service` | Repositorio interno de artefactos APK |

## Red Compartida

Todos los stacks que deban recibir trafico desde este router deben conectarse a la red Docker externa:

```text
servicoop-edge-net
```

`servicoop-edge-net` no la crea ningun compose, porque esta declarada como `external: true`. Se crea una sola vez en el host Docker antes de levantar cualquier stack que la use:

```powershell
docker network create servicoop-edge-net
```

Si ya existe, no hay que recrearla. Si no existe, `docker compose up` falla.

El `edge-router` resuelve destinos con el DNS interno de Docker en tiempo de request. Por eso la portada y el repositorio pueden arrancar aunque algun servicio interno todavia no este levantado. Si se accede a una ruta cuyo destino no existe en `servicoop-edge-net`, esa ruta falla de forma visible.

Orden operativo recomendado:

1. Crear `servicoop-edge-net`.
2. Levantar `router-atrevido`.
3. Levantar `infra-monitor/lechuza-server`.
4. Levantar `chat-global/chatcheto`.
5. Levantar `moto-tester`.

## Configuracion

Copiar `.env.example` a `.env` y completar las credenciales del modo protegido:

```text
EDGE_PROTECTED_USER=admin
EDGE_PROTECTED_PASS=...
```

## Rutas publicas

| Ruta | Destino |
| --- | --- |
| `/` | Menu publico |
| `/mode/secure` | Cookie de modo seguro |
| `/mode/protected` | Validacion protegida y cookie |
| `/dash/` | `panelexemys` |
| `/api/` | `modbus-mw-service` |
| `/pve/` | `pve-service` |
| `/router/` | `router-telef-service` |
| `/scada/` | `scada-citec-service` |
| `/chatcheto/` | `atendedor` |
| `/chatcheto-api/` | `chat-core` |
| `/chatcheto-geo/` | `geo-posicion` |
| `/chatcheto-dashboard-api/` | `dashboard-service` |
| `/moto-tester/` | `trasvase-tester` |
| `/repo/` | Repositorio navegable servido por `repo-service` |

## Repositorio Trafito

`repo-service` publica todo el contenido de:

```text
volumes/repo/
```

La URL publica de navegacion es:

```text
https://comunicaciones.servicoop.com.ar/repo/
```

Si se crea una subcarpeta local:

```text
volumes/repo/trafito-app/
```

se ve en:

```text
https://comunicaciones.servicoop.com.ar/repo/trafito-app/
```

Un APK ubicado en:

```text
volumes/repo/trafito-app/trafito-app.apk
```

queda disponible para descarga directa en:

```text
https://comunicaciones.servicoop.com.ar/repo/trafito-app/trafito-app.apk
```

Si una carpeta o archivo no existe, la ruta responde error visible. No hay fallback.
