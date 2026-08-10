# frontend-foundation

Paquete central de decisiones visuales y componentes compartidos de Servicoop.
Se consume como dependencia de build; no agrega una dependencia HTTP en runtime.

La versión inicial contiene tokens, estilos base, botones, tarjetas, badges y el
shell de navegación. Los componentes de dominio permanecen en cada producto.

Consumidores actuales:

- `products/comunic-mon/lechuza-server/alarmero-service/frontend`;
- `products/moto-tester/trasvase-tester/frontend`.

Panelexemys se incorpora página por página después de extraer los contratos HTTP
que hoy permanecen dentro de callbacks Dash.
