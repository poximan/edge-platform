# artifact-repository

Repositorio central de APK y metadata verificable. Es una capacidad de plataforma
independiente de la frontera HTTP, aunque comparte su despliegue y la red
`servicoop-edge-net` mediante el unico `platform/docker-compose.yml`.

Los artefactos se almacenan en modo solo lectura para el servicio bajo:

```text
volumes/repository/{aplicacion}/app.apk
```

El gateway publica sus contratos estables `/repo/{aplicacion}/release` y
`/repo/{aplicacion}/app.apk` sin asumir propiedad sobre los archivos.
