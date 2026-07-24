# Almacenamiento local del repositorio

Cada aplicacion se publica con una carpeta en kebab-case y un unico nombre de
artefacto estable:

```text
repository/
  nombre-aplicacion/
    app.apk
```

Los APK no se versionan. El servicio los monta en modo de solo lectura y los
expone como `/repo/{nombre-aplicacion}/app.apk`.
