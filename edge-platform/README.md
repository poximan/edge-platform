# Frontera HTTP

`edge-platform` agrupa solamente las dos capacidades que forman la frontera:

- `edge-gateway`: terminacion HTTP/HTTPS y ruteo declarativo;
- `edge-auth`: autenticacion y validacion de la sesion del operador.

Ambas se despliegan desde el unico `docker-compose.yml` ubicado en la raiz
`platform/`. El repositorio de artefactos y la fundacion frontend son capacidades
hermanas de plataforma y no pertenecen a esta carpeta.
