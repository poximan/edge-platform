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
| `resource-monitor` | Métricas server: recursos y registro de clientes web | `/recursos/`, protegido |
| `web-connection-observer` | Sockets TCP de entrada HTTP/HTTPS | privado, espacio de red de TLS |
| `web-navigation` | Catálogo de productos y pantallas observables | compartido en build |

## Frontera

`edge-platform/edge-gateway/config/routes.txt` es la fuente única de rutas. Cada
registro usa:

```text
scope|match|path|destination|uri_mode|access|profile|mirror
```

Las rutas públicas/protegidas se autorizan mediante `edge-auth`; no se confía en
cookies ni encabezados aportados por el cliente. `80/443` son los únicos puertos
de frontera. Los upstreams Docker se alcanzan por nombre y puerto interno.

`/kite-cat/` publica el inventario de SIM del producto `products/kite-cat` con
autenticación protegida obligatoria. Su API `/kite-cat/api/` deniega solicitudes
sin sesión; la página redirige al landing para ingresar. La tarjeta del catálogo
usa el mismo formulario visual, pero autentica en `POST /mode/kite-cat` con
`KITE_CAT_USER` y `KITE_CAT_PASS` del entorno local. Su cookie independiente
incluye un alcance firmado `kite-cat`; no habilita los demás productos. La sesión
general tampoco habilita kite-cat. Ambas sesiones pueden coexistir y `/logout`
las elimina. El gateway comunica la URI original a edge-auth, que normaliza la
ruta antes de elegir la sesión; ni el formulario ni un encabezado del navegador
deciden el alcance de autorización. La primera visita al landing sigue vigente.

La disposición del landing se puede editar sin autenticarse, con arrastre o
mediante «Mover». Admite de uno a tres productos por fila; en pantallas de hasta
720 px se apilan respetando el orden elegido. `layout-model.js` valida las filas
y la cookie `servicoop_portal_layout` (versión 1, duración de un año, SameSite=Lax
y Secure en HTTPS). Cada navegador conserva su preferencia; no existe un orden
compartido en edge-auth ni un endpoint para persistirlo en el servidor. La
cookie no concede permisos para entrar a servicios protegidos.

Las ocho tarjetas de acceso son ahora controles completos: botones nativos
para accesos con autenticación y enlaces nativos para accesos directos. No hay
controles «Abrir» dentro de las tarjetas. `product-tiles.js` valida la secuencia
de pulsación y liberación sobre la misma tarjeta; cancela al soltar afuera,
perder foco, cancelar el puntero o pulsar Escape. Enter y Espacio activan al
soltar la tecla; se conserva la activación semántica de lectores de pantalla.

`product-tiles.css` representa una tecla elevada que baja al presionar, con
el área de interacción fija para que el movimiento visual no cambie el blanco.
Respeta movimiento reducido y los temas claro/oscuro. Los controles de Mover
siguen separados, por lo que arrastrar y guardar la disposición no abre productos.
El encabezado de moto-tester muestra `/moto-tester/assets/trasvase.png`, el mismo
PNG público usado por su splash. No se modifican permisos ni rutas de productos.

La prueba `edge-platform/edge-gateway/tests/product-tiles.browser.mjs` cubre
mouse, teclado, cancelaciones, tacto, icono y reordenamiento con cookie. Simula
la autenticación y las páginas de destino para no operar los servicios reales.

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
puertos. El tracker ejecutado en el navegador envía eventos a `/portal/events`;
un fallo de ese registro no bloquea el funcionamiento del producto.

El espaciado exterior se aplica una vez con `.sc-page`; `Card` aporta por defecto
relleno interior de 12 px. El espaciado de los contenedores generales conserva
sus valores adaptables. Los modos `compact` (8 px) y `none` son explicitos para
mandos pequenos y paneles con regiones propias. Landing y monitor de recursos
distribuyen los mismos tokens y base CSS dentro de sus imagenes. El contrato y
sus consumidores estan documentados en
`frontend-foundation/docs/frontend-standard.md`.

## Observabilidad de recursos

`resource-monitor/src/collector.py` recolecta las métricas Docker en segundo plano
cada 60 segundos. `storage.py` conserva las muestras de contenedor y host y una
proyección por producto y muestra; al iniciar migra una sola vez las muestras
anteriores sin eliminar el histórico. `history_service.py` conserva brevemente
las consultas repetidas de cada ventana y `main.py` expone el contrato HTTP.
La interfaz de `static/app.js` consulta el snapshot y el histórico por separado,
omite la serie histórica del host que no dibuja, cancela respuestas de períodos
anteriores y muestra cuál ventana está cargando o aplicada. Los gráficos viven
en `static/trend-chart.js`.

## Clientes web y navegación

El acceso **Métricas server** conserva `/recursos/` y requiere autenticación. Su
barra vertical alterna entre Consumo de recursos y Clientes. El segundo panel
agrupa por IP canónica (IPv4 o IPv6), permite editar alias y muestra un árbol
acumulativo landing → productos intentados/ingresados → pantallas internas.
Las tarjetas conservan su orden durante las actualizaciones; los clientes
nuevos se agregan al final. Los cambios de estado o alias no reordenan la lista
ni reconstruyen las tarjetas abiertas. El alias se edita junto a la IP, en la
cabecera, en una sola fila con los botones de guardar/cancelar y el indicador
de conexión. Navegación conocida y Conexiones TCP permanecen siempre visibles,
sin controles para plegarlas. El detalle TCP ocupa solo la altura de su contenido.
En ventanas estrechas, la fila se desplaza horizontalmente dentro de la tarjeta.
Los filtros Buscar, Conexión, Origen y Landing se combinan al instante sobre los
clientes conocidos. Origen usa la clasificación del servicio: IP global como
Internet, el resto como LAN / privada. Landing distingue una visita registrada
de la ausencia de ese registro. Ambos incluyen Todos, se conservan durante el
refresco automático y no alteran el orden de las tarjetas ni el registro TXT.
No conserva una cronología ni identifica personas, navegadores o sesiones.
Detrás de NAT, todos los equipos con la misma IP visible forman un cliente.
El nombre DNS inverso es opcional; no permite pedir el nombre privado de un
equipo al navegador y puede describir al proveedor de conectividad.

El único almacenamiento nuevo es el archivo de texto UTF-8
`resource-monitor/volumes/clients/clients.txt`, con estructura JSON versionada,
permisos 0600 y reemplazo atómico. Contiene alias, nombre DNS opcional, visita
previa al landing y árbol acumulado. Las conexiones activas se miden en memoria;
el TXT no contiene contraseñas, cookies, tokens ni autorizaciones. El directorio
debe ser escribible por UID/GID 1000. Un archivo corrupto impide iniciar el
registro; nunca se sobrescribe silenciosamente. Las métricas existentes siguen
usando su almacenamiento anterior.

`web-connection-observer` comparte exclusivamente el espacio de red de
`tls-terminator`. Lee ESTABLISHED en `/proc/net/tcp{,6}` para los listeners
8080/8443, mostrados como 80/443. No monta Docker ni la red del host y no publica
puertos. El monitor consulta cada dos segundos su endpoint privado 8092 con
`WEB_CLIENTS_KEY`. Una medición fallida o antigua se muestra como **no disponible**,
nunca como conexión cerrada. La interfaz consulta cada cinco segundos mientras
Clientes está visible. TCP abierto no significa que una persona esté usando la
página: también incluye keep-alive y WebSocket. Es un muestreo; un socket que
abra y cierre entre muestras puede no aparecer activo. Los accesos HTTP sí
aportan clientes conocidos mediante el registro del gateway. Actualmente no se
publica HTTP/3 por UDP; este observador mide TCP.

El gateway entrega sus accesos del servidor público por syslog UDP privado 8093.
Un GET HTML completado con 2xx confirma el ingreso; errores y clics solo registran
intento. El tracker común observa rutas SPA y Chatcheto/Métricas informan además
sus pestañas sin cambio de ruta. Las URL se guardan sin query strings. UDP y los
eventos de navegador son observación de mejor esfuerzo: no constituyen un log
forense de cada paquete. Productos externos sin tracker registran la entrega de
HTML, pero no sus cambios internos de estado. Para agregar pantallas se actualiza
`web-navigation/catalog.json` y, si no cambian de ruta, se llama `recordScreen`.

La primera visita al landing se registra sincrónicamente por IP antes de servir
su HTML. Hasta entonces, las pantallas de productos redirigen al landing. Luego
se admiten enlaces directos; APIs y assets conservan sus contratos. **Visitar el
landing no autentica ni autoriza:** `routes.txt` decide en cada solicitud si se
exige una sesión válida. Si un producto pasa de público a protegido, sus visitas
anteriores no evitan la verificación. El gateway reemplaza los encabezados de
identidad y bloquea `/recursos/internal/`. Los eventos de navegador y syslog no
pueden marcar la visita inicial. Un error del registro no concede acceso.

Para desplegar esta función se reconstruyen `resource-monitor`, `edge-auth`,
`edge-gateway`, `web-connection-observer` y los frontends que consumen
`frontend-foundation`. Se recrea el gateway después del monitor: Nginx resuelve
el destino syslog al iniciar. La dependencia Compose reinicia el gateway al
actualizar el monitor. Si se recrea TLS usando `--no-deps`, también debe recrearse
el observador para unirlo al nuevo espacio de red; con el despliegue normal
Compose propaga la dependencia. Ningún puerto nuevo se expone al host.

Las pruebas de `resource-monitor/tests` verifican TXT, estados TCP y navegación;
`edge-platform/edge-auth/tests` verifica que la visita y la sesión sean requisitos
independientes, incluidas rutas equivalentes y errores de persistencia.

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
