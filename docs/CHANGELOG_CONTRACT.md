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

## 2026-10-22 — Asistente IA: claves del cliente, consumo y MCP
Nuevas rutas (todas con JWT salvo `/api/mcp`):

| Método | Ruta | Descripción |
|---|---|---|
| GET | /api/agent/settings | admin: `{policy, providerKeyConfigured, customerKey:{configured,last4,status}, effectiveSource, fallback:{enabled,capUsd,spentUsd,capReached}}` |
| PUT | /api/agent/settings/customer-key | admin: `{apiKey}`; se valida con Anthropic y se guarda cifrada. 409 `CUSTOMER_KEY_DISABLED` con `provider_only` |
| DELETE | /api/agent/settings/customer-key | admin: 204 |
| GET | /api/agent/usage?month=YYYY-MM | admin: consumo por clave (`customer`/`provider`, `viaFallback`) y por usuario |
| GET/POST | /api/tokens | tokens personales (POST devuelve `token` una sola vez; máx. 10 activos, 409 `TOKEN_LIMIT`) |
| DELETE | /api/tokens/:id | revoca (204) |
| POST | /api/mcp | servidor MCP (JSON-RPC sobre HTTP). `Authorization: Bearer ncrm_…`; un JWT no vale |

- `GET /api/agent/models` añade `keySource` (`customer`/`provider`/`null`); `configured` pasa a significar «hay alguna clave utilizable».
- Evento SSE nuevo en `/api/agent/chat`: `notice` (`KEY_FALLBACK`). Errores nuevos: `AGENT_KEY_EXHAUSTED`, `AGENT_KEY_INVALID`, `AGENT_PROVIDER_EXHAUSTED`, `AGENT_PROVIDER_INVALID`, `AGENT_FALLBACK_CAP`.
- Migración 3: tablas `app_settings`, `agent_usage`, `api_tokens`.
- Variables nuevas: `AGENT_KEY_POLICY`, `AGENT_FALLBACK_MONTHLY_CAP_USD`, `SETTINGS_ENCRYPTION_KEY`, `MCP_RATE_LIMIT_MAX`. Ver [AI_ASSISTANT.md](AI_ASSISTANT.md).
- Dependencia nueva de desarrollo: `@modelcontextprotocol/sdk` (solo para el test de interoperabilidad MCP).

## 2026-10-22 — Asistente IA: confirmación obligatoria antes de borrar
- Cada `delete_record` del asistente exige la aprobación de la persona. El turno (SSE) se queda esperando: se emite `confirm_required` (`callId`, `label` p. ej. `empresa «Acme» (id 4)`) y, tras la respuesta, `confirm_resolved` (`decision`: `approved` / `denied` / `expired`). Si el registro no es visible para el usuario no hay nada que confirmar y el borrado falla (404) como siempre.
- Nueva ruta: `POST /api/agent/chat/confirm` `{callId, approve}` → 204; 404 si no hay confirmación pendiente de ese usuario con ese `callId`.
- Sin respuesta en 5 min (`AGENT_CONFIRM_TIMEOUT_MS`), o si el navegador se desconecta, cuenta como «no»: no se borra nada.
- MCP: `tools/list` marca `delete_record` con `destructiveHint` y las de lectura con `readOnlyHint`, para que Claude Code/Desktop pidan permiso según su configuración. El servidor MCP en sí no añade confirmación propia.
