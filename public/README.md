# ALFRED IOS STORES — Railway

## Despliegue

1. Sube el contenido de esta carpeta a GitHub (no el ZIP).
2. En Railway crea un proyecto y despliega el repositorio.
3. Railway puede detectar Node.js automáticamente; el proyecto incluye `railway.json` y `npm start`.
4. Crea un **Volume** para el servicio con mount path `/app/data`.
5. Añade estas variables en Railway:

```text
NODE_ENV=production
DB_PATH=/app/data/store.db
UPLOAD_DIR=/app/data/uploads
ADMIN_EMAIL=tu_correo_de_admin
ADMIN_PASSWORD=tu_clave_segura
SESSION_SECRET=una_cadena_larga_y_aleatoria
```

6. En Networking, genera el dominio público.

El Volume es importante porque SQLite y los archivos subidos necesitan almacenamiento persistente. Railway indica que el volumen debe montarse en la ruta donde la aplicación escribe los datos. 

## Panel

`/admin/`

## Salud

`/api/health`

## Seguridad

Las contraseñas y secretos deben configurarse como Variables de Railway y no subirse a GitHub.
