# Cambios / desviaciones respecto a CONTRACT.md

## 2026-10-22 — Backend: driver SQLite
- `better-sqlite3` fijado a **11.10.0** (exacto). La 13.x provocaba *segfault* en Windows con Node 22.12.
- 11.10.0 no publica prebuild para Node 24 (ABI 137). El backend usa un adaptador (`backend/src/sqlite.ts`): intenta `better-sqlite3` y, si su binario nativo no carga, recurre a **`node:sqlite`** (incluido en Node >= 22.13 / 24). La API interna es la misma. Se puede forzar con `SQLITE_DRIVER=better|node`.
- Motivo: durante el desarrollo el Node de la máquina pasó de 22.12 a 24.20 (la carpeta nvm `v22.12.0` contiene ahora `node.exe` 24.20 y un npm 11.19 roto). Así los tests pasan con cualquiera de las dos versiones.

## 2026-10-22 — Backend: detalles de la API (sin cambios de rutas)
- Errores de validación: **400** `VALIDATION_ERROR` con `details: [{path,message,code}]`. Referencias (`companyId`, `contactId`, `dealId`) inexistentes o de otro usuario: **422** `INVALID_REFERENCE`. JSON mal formado: 400 `INVALID_JSON`; body > 100kb: 413 `PAYLOAD_TOO_LARGE`.
- Registros ajenos (usuario `sales`): **404** (no se revela si existen).
- `DELETE` responde **204** sin cuerpo.
- `pageSize` se recorta a 100 y `page` < 1 pasa a 1; un `sort` fuera de la whitelist o un `order` que no sea asc/desc dan 400.
- `website`: sólo `http(s)`; un dominio sin esquema (`acme.com`) se guarda como `https://acme.com` (resuelve INT-1 en el backend).
- Fechas `dueDate`/`expectedCloseDate` se normalizan a ISO 8601 completo (`toISOString`).
- Users: extra `GET /api/users/:id` (admin). No se puede borrar la propia cuenta ni borrar o degradar al último admin (409). Al borrar un usuario sus registros pasan al admin que lo borra.
- `upcomingActivities`: no completadas con `dueDate >= ahora`, ordenadas por fecha (máx. 5).
