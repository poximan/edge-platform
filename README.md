# Plataforma compartida de Servicoop

Este repositorio contiene capacidades transversales sin dominio de producto.
Existe un unico `docker-compose.yml`, porque los servicios de runtime se operan
como un solo despliegue de plataforma.

- `edge-platform/edge-gateway`: unico router HTTP/HTTPS del host.
- `edge-platform/edge-auth`: emite y valida la sesion firmada del modo protegido.
- `artifact-repository`: repositorio central de APK y metadata de versiones.
- `frontend-foundation`: dependencia de build compartida por los frontends web.

## Ingreso publico

`comunicaciones.servicoop.com.ar` es administrado fuera de este workspace. El DNS apunta al router frontera y ese equipo reenvia el trafico `80/443` al host Docker administrado localmente. Este repositorio comienza su responsabilidad cuando la conexion llega al host.

```text
comunicaciones.servicoop.com.ar
  -> router frontera externo
  -> host Docker:80/443
  -> edge-gateway
  -> servicio seleccionado por ruta
```

Si el router solo hace NAT o passthrough, el certificado publico debe terminar en `edge-gateway`. Si termina TLS, el certificado pertenece al router y debe existir un contrato explicito para el tramo hacia el host.

El puerto `8443` pertenece exclusivamente al listener no privilegiado dentro del
contenedor. El gateway normaliza el origen publico como HTTPS `443`, emite
redirecciones relativas y nunca propaga `8443` a navegadores ni servicios.

Los quick tunnels pertenecen a cada producto, no a la plataforma. Son conexiones salientes y no compiten con los puertos `80/443`. Los adaptadores de canal ingresan al listener interno `8080` con un Host de producto, por ejemplo `afondo.internal`.

## Ruteo

`edge-platform/edge-gateway/config/routes.txt` es la unica fuente de verdad. Formato:

```text
scope|match|path|destination|uri_mode|access|profile|mirror
```

- `scope`: `public` o Host interno del producto.
- `match`: `exact` o `prefix`.
- `destination`: servicio y puerto Docker.
- `uri_mode`: `preserve` conserva la ruta; `strip` quita el prefijo.
- `access`: `public`, `protected-deny` o `protected-redirect`.
- `profile`: `standard`, `stream`, `sse` o `static`.
- `mirror`: `-` o destino interno de telemetria.

Las filas invalidas o duplicadas abortan el inicio. Una redireccion usa `redirect:/ruta` como destino.

Las rutas publicas reciben `X-Edge-Mode: secure` o `protected` despues de validar la sesion. Las rutas protegidas usan `auth_request`; nunca confian en una cookie ni en un encabezado aportado directamente por el cliente. El inicio de sesion se limita por IP y la cookie es firmada, `Secure`, `HttpOnly` y `SameSite=Strict`.

## Red compartida

Este Compose crea y administra `servicoop-edge-net`. Los productos la declaran `external: true`; por eso `platform` se despliega primero. No se debe crear la red manualmente ni declarar la plataforma como consumidor externo.

Solo deben conectarse a esta red los servicios alcanzables por el gateway.

## Repositorio de APK

Estructura:

```text
artifact-repository/volumes/repository/{aplicacion}/app.apk
```

Rutas:

```text
/repo/{aplicacion}/release
/repo/{aplicacion}/app.apk
```

`release` informa version, versionCode, tamano, fecha y SHA-256 extraidos del APK.

## Fundacion frontend

`frontend-foundation` es la unica fuente de verdad para tokens visuales,
estilos base, componentes globales y la barra de navegacion de los productos web.
Las interfaces nuevas usan React, TypeScript estricto y Vite; los estilos propios
de cada dominio usan CSS Modules y no duplican decisiones globales.

La fundacion se incorpora como dependencia durante el build. No es un servicio,
no expone un puerto y no agrega acoplamiento HTTP en runtime.

## Configuracion

Copiar `.env.example` como `.env` y completar las credenciales y un secreto aleatorio de al menos 32 caracteres. No se admiten variables obligatorias vacias ni secretos versionados.
