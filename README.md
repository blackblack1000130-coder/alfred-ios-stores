# ALFRED IOS STORES — paquete completo

Incluye la tienda visual principal, cuentas de clientes, saldo, comprobantes, compras, entrega, panel administrativo y categorías.

## Tienda
- Sensibilidades
- Filza
- 3105
- iMazing
- 6 productos iniciales con sus precios
- Compra con saldo
- Aviso de entrega de 1 a 2 horas
- Banreservas: 9605206264

## Panel
`/admin/`

## Credenciales
Correo de administrador: Blackblack1000130@gmail.com
La contraseña se configura únicamente en Render mediante `ADMIN_PASSWORD`; no se guarda en GitHub.

## Subida a GitHub
Sube TODO el contenido de este paquete, no el ZIP dentro del repositorio. No subas `.env`.

## Render Free

Esta edición no usa Persistent Disk ni `/var/data`, por lo que puede arrancar en un Web Service Free.

**Importante:** el almacenamiento local de Render Free es efímero: la base SQLite y archivos subidos pueden perderse en reinicios, redeploys o spin-down. Render recomienda usar un datastore para datos que deban persistir. Esta edición es adecuada para prueba/preview; para una tienda real con cuentas, balances, compras y comprobantes, se debe migrar la persistencia a PostgreSQL u otro almacenamiento externo. 
