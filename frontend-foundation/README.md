# frontend-foundation

Paquete central de decisiones visuales y componentes compartidos de Servicoop.
Se consume como dependencia de build; no agrega una dependencia HTTP en runtime.

La versión inicial contiene tokens, estilos base, botones, tarjetas, badges y el
shell de navegación. Los componentes de dominio permanecen en cada producto.

El landing guarda el tema elegido en `localStorage` con la clave
`servicoop-theme`. `AppShell` aplica esa preferencia antes de pintar cada
producto; los valores admitidos son `light` y `dark`.

Consumidores actuales:

- `products/comunic-mon/lechuza-server/alarmero-service/frontend`;
- `products/comunic-mon/lechuza-server/panelexemys/frontend`;
- `products/moto-tester/trasvase-tester/frontend`.

Este paquete no contiene vistas operativas. La metodología general está en `../../metodologia.txt`.
