# ADR: stack frontend común

## Decisión

Las interfaces web nuevas y las migraciones usan React, TypeScript estricto y
Vite. Los estilos usan variables CSS centrales y CSS Modules. Tailwind no forma
parte del stack autorizado.

## Responsabilidades

- `frontend-foundation` es la única fuente de verdad de tokens y componentes globales.
- cada producto conserva sus componentes de dominio y sus clientes HTTP.
- el gateway conserva únicamente autenticación y ruteo; no inyecta componentes.
- React presenta estado y solicita acciones, pero no contiene reglas de negocio.

## Estructura

Cada archivo TSX exporta un único componente. Una carpeta categórica se crea
cuando contiene al menos dos fuentes relacionadas; si queda una sola fuente, se
elimina la carpeta y la fuente se mueve al nivel conceptual superior.
