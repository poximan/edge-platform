# Estándar frontend

## Tipografía y dimensiones

- familia principal: Segoe UI con fallback Arial y sans-serif, sin dependencias de fuentes remotas;
- escala tipográfica: 12, 14, 16, 20, 28 y 40 píxeles equivalentes en `rem`;
- escala espacial basada en 4 píxeles;
- ancho operativo máximo: 1500 píxeles;
- controles interactivos: altura mínima de 40 píxeles;
- corte compacto principal: 720 píxeles.

## Estilos

Los productos consumen tokens semánticos `--sc-*`. No redefinen colores,
tipografía, radios o sombras globales. El CSS local se limita a distribución y
representaciones propias del dominio.

## Espaciado y contenedores

La pagina es duena del espacio respecto de la ventana y cada panel es dueno de
su relleno interior. No se aplica padding global a `body` ni a todos los `div`:
eso duplicaria espacios y alteraria barras fijas, tablas y graficos.

| Contrato | Uso | Espacio |
| --- | --- | --- |
| `.sc-page` | Contenedor principal, una vez por pantalla | 16–32 px laterales y 20–40 px verticales |
| `--sc-section-gap` | Separacion entre paneles principales | 16–24 px |
| `--sc-panel-padding` | Contenedor general de una sección o diálogo | 16–24 px |
| `Card` / `--sc-card-padding` | Relleno de una tarjeta | 12 px |
| `--sc-card-gap` | Separación entre tarjetas o datos de una tarjeta | 8 px |
| `Card padding="compact"` | Tarjetas numericas o mandos compactos | 8 px |
| `Card padding="none"` | Panel con cabecera, cuerpo o tabla con relleno propio | 0 px en la carcasa; cada region conserva su relleno |

Los valores fluidos se definen en `tokens.css`, no en cada producto. `.sc-page`
conserva el ancho operativo y respeta las areas seguras laterales; un producto
puede ajustar `--sc-page-max-width` cuando su distribucion lo requiere.
No se anidan paginas para obtener mas padding. Las tarjetas no agregan margen
exterior: su padre distribuye los hermanos con `gap`.

La separación de los contenedores generales no se hereda como relleno de cada
tarjeta. Dentro de las tarjetas se evita reservar alturas vacías para textos,
indicadores o listas: el contenido ocupa su altura real. Las filas operativas
mantienen sus controles alineados al cambiar entre lectura y edición.

Las tablas y graficos anchos desplazan su contenido dentro de su propia region,
sin ensanchar la pagina. Los dialogos conservan espacio respecto de la ventana
y relleno interior tambien en movil. Los paneles sin relleno deben declararlo
en el componente, en lugar de anular silenciosamente el padding con CSS local.

Los frontends React consumen esta base como dependencia de build. El landing,
el monitor de recursos y Chatest copian los mismos `tokens.css` y `base.css` a
sus imagenes: no mantienen otra escala espacial ni dependen de un servidor CSS.

## Componentes

Botones, tarjetas, badges de estado y navegación global pertenecen a
`frontend-foundation`. Tablas o gráficos específicos permanecen en el producto
hasta que exista más de un consumidor real.

## Accesibilidad

Toda acción debe ser operable por teclado, tener foco visible y conservar HTML
semántico. El color nunca es el único indicador de estado.

## Registro de navegación

`AppShell` inicia una vez por documento el tracker compartido. Observa la ruta
inicial, `history.pushState`, `history.replaceState` y `popstate`. Solo envía al
gateway el pathname local y la pantalla declarada; descarta query strings y
orígenes externos. Deduplica por documento y los fallos no bloquean la interfaz.
Las vistas sin cambio de ruta llaman `recordScreen(pathname, screen)` desde
`@servicoop/frontend-foundation/visit-tracker`; sus identificadores se declaran
en `platform/web-navigation/catalog.json`. El landing informa los intentos con
`recordProductAttempt`. Estos eventos no autentican usuarios ni conceden permisos.
