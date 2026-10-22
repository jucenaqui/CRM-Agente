# NEWCRM — Modelo de amenazas (STRIDE)

Alcance: API Express (`/backend`, puerto 4000, SQLite) + SPA React (`/frontend`, puerto 5173). Actores: anónimo, `sales`, `admin`.
Activos: credenciales y hashes, JWT, datos comerciales (empresas, contactos, deals, actividades), secreto JWT, base SQLite.

## Fronteras de confianza
1. Navegador ↔ API (HTTP JSON, `Authorization: Bearer`).
2. API ↔ SQLite (consultas SQL).
3. Usuario `sales` ↔ datos de otros usuarios (aislamiento por `ownerId`).
4. Proceso ↔ entorno (variables `JWT_SECRET`, `CORS_ORIGIN`, `NODE_ENV`).

## STRIDE

| # | Categoría | Amenaza | Componente | Mitigación |
|---|---|---|---|---|
| S1 | Spoofing | Fuerza bruta / credential stuffing en `/api/auth/login` | auth | Rate limit estricto en login/register (`security.ts`), bcrypt (cost ≥ 10) |
| S2 | Spoofing | JWT forjado con secreto débil o por defecto | auth | `JWT_SECRET` por env; en `production` el arranque falla si falta; algoritmo fijado (`HS256`) en `verify` |
| S3 | Spoofing | Token sin caducidad reutilizado indefinidamente | auth | `expiresIn` (p.ej. 8h); 401 en token expirado |
| S4 | Spoofing | Enumeración de usuarios (mensajes distintos para email inexistente vs. contraseña errónea) | login | Mensaje y código únicos `INVALID_CREDENTIALS` |
| T1 | Tampering | Inyección SQL vía `search`, filtros o `sort/order` | repositorios | Sentencias preparadas (`?`) siempre; `sort` contra whitelist; `order` ∈ {asc,desc} |
| T2 | Tampering | Mass assignment (`ownerId`, `role`, `passwordHash` en body) | rutas CRUD / users | Esquemas zod `.strict()`/pick; `ownerId` siempre desde el token; `role` sólo editable por admin |
| T3 | Tampering | IDOR: `sales` edita/borra registros ajenos (`PATCH/DELETE /:id`, `/deals/:id/stage`) | rutas CRUD | Filtro `WHERE id=? AND ownerId=?` para no-admin; responder 404 |
| T4 | Tampering | Vincular registros propios a `companyId/contactId/dealId` ajenos | rutas CRUD | Validar propiedad de las referencias |
| R1 | Repudiation | Sin trazas de acciones | API | Log de requests (sin datos sensibles); `createdAt/updatedAt` |
| I1 | Info disclosure | IDOR de lectura (`GET /:id`, listas, dashboard) | rutas | Filtro por `ownerId` en listados, detalle y agregados del dashboard |
| I2 | Info disclosure | `passwordHash` devuelto en `user` | auth/users | Serializador `toPublicUser`; tests que lo verifican |
| I3 | Info disclosure | Stack traces / mensajes SQL en errores | error handler | En `production` mensaje genérico; sin `stack` |
| I4 | Info disclosure | Cabeceras que revelan tecnología (`X-Powered-By`) | Express | `app.disable('x-powered-by')`, helmet |
| I5 | Info disclosure | Secretos en repo (`.env`, BD) | repo | `.gitignore` para `.env`, `*.db`; `.env.example` sin valores reales |
| I6 | Info disclosure | XSS roba el token de `localStorage` | frontend | Sin `dangerouslySetInnerHTML`/`innerHTML`; React escapa; CSP de helmet; validar `website` (sólo `http(s)://`) antes de usarlo en `href` |
| D1 | DoS | Bodies gigantes | Express | `express.json({ limit: '100kb' })` |
| D2 | DoS | Flood de peticiones | API | Rate limit general (300 req/15 min por IP) |
| D3 | DoS | `pageSize` enorme | listas | zod: `pageSize` máx. 100 |
| E1 | Elevation | `sales` accede a `/api/users` o se asigna `role=admin` en register | users/auth | Middleware `requireRole('admin')`; register ignora `role` (sólo el primer usuario es admin) |
| E2 | Elevation | CORS abierto permite a otros orígenes usar la API | Express | CORS restringido a `CORS_ORIGIN` (def. `http://localhost:5173`) |
| E3 | Elevation | Admin se degrada/borra a sí mismo dejando el sistema sin admin | users | Recomendado: impedir borrar/degradar el último admin |

## Riesgo residual aceptado
- Token en `localStorage` (requisito del contrato): mitigado con CSP y ausencia de sinks XSS; no hay revocación de tokens (caducidad corta).
- Rate limit en memoria por proceso (suficiente para despliegue de un nodo).
