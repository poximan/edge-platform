# Frontera HTTP

`edge-platform` agrupa solamente las dos capacidades que forman la frontera:

- `edge-gateway`: terminacion HTTP/HTTPS y ruteo declarativo;
- `edge-auth`: autenticacion y validacion de la sesion del operador.

Ambas se despliegan desde el unico `docker-compose.yml` ubicado en la raiz
`platform/`. El repositorio de artefactos y la fundacion frontend son capacidades
hermanas de plataforma y no pertenecen a esta carpeta.

## Red compartida

`edge-platform` es el propietario funcional de `servicoop-edge-net`. Su punto de
despliegue es `platform/docker-compose.yml`, donde la red se declara como propia y
Docker Compose la crea automaticamente si todavia no existe. Los productos solo la
consumen como `external: true` y, por lo tanto, no intentan crearla ni competir por
su propiedad.

`edge-gateway/html/index.html` es un landing estático de una sola vista. No tiene negocio, servicio ni DAO; solo presenta las rutas declaradas por la plataforma. La metodología general está en `../../metodologia.txt`.
