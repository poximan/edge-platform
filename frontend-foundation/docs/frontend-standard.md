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

## Componentes

Botones, tarjetas, badges de estado y navegación global pertenecen a
`frontend-foundation`. Tablas o gráficos específicos permanecen en el producto
hasta que exista más de un consumidor real.

## Accesibilidad

Toda acción debe ser operable por teclado, tener foco visible y conservar HTML
semántico. El color nunca es el único indicador de estado.
