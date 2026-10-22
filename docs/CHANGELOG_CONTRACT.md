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

## 2026-10-22 — Asistente IA (nuevo módulo)
Rutas nuevas, todas con `Authorization: Bearer <token>`:

| Método | Ruta | Descripción |
|---|---|---|
| GET | /api/agent/models | `{configured, defaultModel, models:[{id,label,description,inputPrice,outputPrice}]}` |
| POST | /api/agent/chat | `{message, model?, conversationId?}` → **SSE** (`text/event-stream`), un evento JSON por línea `data:` |
| GET | /api/agent/conversations | `{data:[{id,title,model,createdAt,updatedAt}]}` (sólo las propias) |
| GET | /api/agent/conversations/:id | `{id,title,model,…,items:[{kind:user|assistant|tool,…}]}` |
| DELETE | /api/agent/conversations/:id | 204 |

- Eventos SSE: `conversation`, `text` (delta), `tool_start`, `tool_end` (`ok`, `changed` = entidad modificada), `done` (`usage` con coste estimado), `error` (`code`, `message`).
- Errores antes del streaming: 503 `AGENT_NOT_CONFIGURED` (sin `ANTHROPIC_API_KEY`), 400 modelo no permitido (`details.allowed`), 404 conversación ajena, 409 `AGENT_BUSY`, 429 por usuario (`AGENT_RATE_LIMIT_MAX`, 60 cada 15 min).
- El agente actúa con el token del usuario: sus herramientas llaman a la API del CRM por un servidor interno sólo en `127.0.0.1` con clave aleatoria por proceso, así que hereda validación y permisos (`sales` sólo lo suyo, `users` sólo admin).
- Modelos elegibles: `claude-opus-5-5` (por defecto), `claude-sonnet-5-5`, `claude-haiku-5-5`, `claude-fable-5-1`; el despliegue los limita con `AGENT_MODELS` y fija el preseleccionado con `AGENT_DEFAULT_MODEL`. Se puede cambiar de modelo a mitad de conversación.
- Tabla nueva `agent_conversations` (migración 2), borrado en cascada con el usuario.
