# Frontera HTTP central de Servicoop

Este proyecto contiene dos capacidades independientes:

- `edge-gateway`: unico punto de ruteo HTTP/HTTPS de la plataforma.
- `artifact-repository`: repositorio central de aplicaciones Android.

Los productos no deben incorporar routers propios. Sus servicios publicables se
conectan a `servicoop-edge-net`; sus adaptadores de canal envian el Host interno
definido para el producto al gateway.

## Reglas de ruteo

Las reglas se editan en `edge-gateway/config/routes.txt`. Cada fila usa ocho
campos separados por `|`:

```text
scope|match|path|destination|uri_mode|access|profile|mirror
```

- `scope`: `public` o el Host interno del producto, por ejemplo `afondo.internal`.
- `match`: `exact` o `prefix`.
- `path`: ruta publica.
- `destination`: servicio o IP con puerto, por ejemplo `afondo-central-server:8080`.
- `uri_mode`: `preserve` conserva la ruta y `strip` quita el prefijo.
- `access`: `public`, `protected-deny` o `protected-redirect`.
- `profile`: `standard`, `stream`, `sse` o `static`.
- `mirror`: `-` o un destino interno para telemetria.

Una redireccion local usa `redirect:/ruta` como destino y `-` en los campos que
no corresponden. El contenedor valida todas las filas y aborta ante una regla
invalida o duplicada.

## Repositorio de APK

La estructura canonica es:

```text
volumes/repository/{nombre-aplicacion}/app.apk
```

Rutas publicadas:

```text
/repo/
/repo/{nombre-aplicacion}/release
/repo/{nombre-aplicacion}/app.apk
```

`release` informa version, versionCode, tamano, fecha y SHA-256 obtenidos del APK.

## Red compartida

Este Compose es el propietario de `servicoop-edge-net` y la crea al desplegar la
plataforma central. Los stacks de producto la declaran externa y se conectan a
ella, por lo que `edge-platform` debe desplegarse primero. Esta propiedad unica
evita comandos manuales y elimina la ambiguedad sobre quien administra la red.

## Configuracion

Copiar `.env.example` como `.env` y completar las credenciales del modo
protegido. No se admiten variables obligatorias vacias.
