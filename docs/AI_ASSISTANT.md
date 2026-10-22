# Asistente IA: quién paga y cómo se conecta

NEWCRM se despliega **una instalación por cliente** (cada cliente tiene su servidor y su base de datos). El asistente se puede usar de tres formas a la vez en la misma instalación.

| Modo | Quién paga | Cómo se usa |
|---|---|---|
| **Clave del proveedor** (tú) | El dueño de `ANTHROPIC_API_KEY` en el servidor; se factura al cliente según el consumo registrado | Panel «Asistente» del CRM, sin configurar nada |
| **Clave del cliente** | El cliente, directamente a Anthropic | Panel «Asistente»; un admin guarda su clave en **Ajustes** |
| **MCP** | El cliente, con su suscripción de Claude | Claude Code / Claude Desktop con un token personal (Ajustes → Conexión con Claude) |

## Borrados y cambios: siempre con confirmación

En el chat del CRM el asistente **no puede borrar ni modificar nada por su cuenta**. Antes de ejecutar un borrado, o cualquier cambio sobre un registro existente (editar, mover un deal de etapa, actualizar un usuario), el chat muestra el recuadro de confirmación:
- **Borrar:** «¿Borrar empresa «Acme» (id 4)? Esta acción no se puede deshacer», con los botones **Borrar** y **Cancelar**.
- **Cambiar:** «¿Actualizar empresa «Acme» (id 4)?» con la lista de lo que cambia, campo por campo (por ejemplo `nombre: Acme → Acme SA`, `etapa: Negociación → Ganado`), con los botones **Actualizar** y **Cancelar**. Solo se listan los campos que de verdad cambian; si el cambio no modifica nada, no se pregunta. Las contraseñas nunca se muestran.

Está forzado en el servidor, no depende de las instrucciones del modelo. Sin respuesta en 5 minutos (`AGENT_CONFIRM_TIMEOUT_MS`) o si se cierra la pestaña, no se cambia nada. **Crear registros no pide confirmación.** Además, si una petición cambiaría varios registros sin nombrarlos, el asistente primero los lista y pregunta. Por MCP, la confirmación la gestiona la aplicación del cliente (Claude Code y Desktop piden permiso por herramienta; el servidor marca como destructivas las de borrar y modificar).

## Qué clave se usa (`AGENT_KEY_POLICY`)

La define quien administra la instalación (es una variable del servidor, no un ajuste del cliente, porque afecta a su dinero).

| Valor | Comportamiento |
|---|---|
| *(vacío)* `default` | Si el cliente guardó su clave, se usa **solo** esa. Si no, la del proveedor. Nunca pasa a la del proveedor por su cuenta. |
| `provider_only` | Siempre la del proveedor. Una clave guardada por el cliente se ignora y no se puede guardar otra. |
| `customer_only` | Solo la del cliente. Sin clave guardada, el asistente responde «no configurado». |
| `customer_then_provider` | La del cliente primero; si se queda **sin saldo o deja de ser válida**, usa la del proveedor, con un tope mensual. |

### Qué pasa cuando la clave del cliente se queda sin saldo

- Con `default` o `customer_only`: el chat se detiene con «Tu clave de Anthropic no tiene saldo…». **No se gasta nada de la clave del proveedor.**
- Con `customer_then_provider`: el chat continúa con la clave del proveedor y muestra un aviso. Cada respuesta queda registrada como *respaldo*. Al llegar a `AGENT_FALLBACK_MONTHLY_CAP_USD` (10 USD por defecto, por mes natural UTC) el chat se detiene.
- Solo se cambia de clave ante **saldo agotado** o **clave inválida/revocada**. Los fallos pasajeros (límite de velocidad, caída de Anthropic) no activan el respaldo.
- El estado de la clave (`Funciona`, `Sin saldo`, `No válida`) se ve en Ajustes y se corrige solo cuando vuelve a funcionar.

> **Verificado con una cuenta real sin saldo (2026-10-22):** Anthropic responde 400 `invalid_request_error` con «Your credit balance is too low to access the Anthropic API…», que es el texto que se detecta. Listar modelos (`agent:check`) funciona aunque no haya saldo; generar texto no.

## Coste medido con la API real (2026-10-22)

Primer mensaje de una conversación, con una consulta sencilla (1-2 herramientas), a precios de lista:

| Modelo | Coste aproximado |
|---|---|
| Haiku 5.5 | 0,001 USD |
| Sonnet 5.5 | 0,016 USD |
| Opus 5.5 | 0,04 USD |
| Fable 5.1 | 0,08 USD |

Casi todo es la **escritura de caché** de las instrucciones y las 16 herramientas (~5.600 tokens), que se vuelve a pagar cuando pasan más de 5 minutos entre mensajes. Los mensajes siguientes dentro de la misma conversación cuestan bastante menos. Son estimaciones calculadas a partir de los tokens que informa Anthropic; la factura real está en console.anthropic.com. Los precios de lectura de caché de cada modelo salen de la documentación; el de Haiku 5.5 (0,01 USD) y el recargo de escritura del 25 % son supuestos habituales no confirmados para estos modelos.

## Registro de consumo y facturación

Cada paso del asistente se guarda en `agent_usage`: usuario, modelo, tokens, coste estimado (a precio de lista del modelo), qué clave se usó y si fue respaldo. Los admins lo ven en **Ajustes → Consumo** (por clave y por usuario) y por API: `GET /api/agent/usage?month=2026-10`. Para facturar al cliente, suma las filas con clave `provider`; el coste es una estimación, no la factura de Anthropic.

## Clave del cliente: seguridad

- Se valida con Anthropic antes de guardarla (consulta de modelos, sin gastar tokens).
- Se guarda **cifrada** (AES-256-GCM) en la base de datos; solo se devuelven sus últimos 4 caracteres. La clave de cifrado sale de `SETTINGS_ENCRYPTION_KEY`, o de `JWT_SECRET` si no está definida. **Si cambia ese secreto, la clave guardada deja de poder leerse** y hay que volver a introducirla.
- Solo los admins pueden verla, guardarla o quitarla.

## MCP (Claude Code y Claude Desktop)

Servidor MCP en `POST /api/mcp` (transporte Streamable HTTP, sin sesiones), con las mismas 16 herramientas del asistente y los mismos permisos.

- **Token personal:** cada usuario lo crea en Ajustes (máx. 10 activos). Se muestra una sola vez; en la base solo se guarda su hash. Sirve únicamente en `/api/mcp` (no en el resto de la API) y se puede revocar. Al borrar al usuario, sus tokens dejan de funcionar.
- **Claude Code:**
  ```bash
  claude mcp add --transport http newcrm https://TU-CRM/api/mcp --header "Authorization: Bearer ncrm_..."
  ```
- **Claude Desktop:** mediante el puente `mcp-remote` (paquete de terceros, requiere Node.js). La pantalla de Ajustes genera el JSON. Los pasos exactos pueden variar según la versión de la aplicación.
- **claude.ai (web):** **no soportado todavía.** Exige publicar el CRM en internet con HTTPS y un inicio de sesión OAuth que no está implementado.
- **Verificado con Claude Code real (2026-10-22):** `claude mcp add --transport http …` conecta (`✔ Connected` en `claude mcp list`), lista y crea registros con los permisos del dueño del token, y las herramientas que modifican (`update_*`) quedan bloqueadas hasta que el usuario las autoriza en Claude Code (p. ej. `--allowedTools` o el aviso de permisos): sin esa autorización no se cambia nada. También con el cliente oficial del SDK de MCP sobre HTTP real. **Claude Desktop** (puente `mcp-remote`) no se ha probado.

## Variables

| Variable | Por defecto | Para qué |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Clave del proveedor |
| `AGENT_KEY_POLICY` | `default` | Qué clave paga (ver arriba) |
| `AGENT_FALLBACK_MONTHLY_CAP_USD` | `10` | Tope mensual del respaldo con la clave del proveedor |
| `AGENT_MODELS` / `AGENT_DEFAULT_MODEL` | todos / `claude-opus-5-5` | Modelos elegibles y preseleccionado |
| `AGENT_RATE_LIMIT_MAX` | `60` | Mensajes al asistente por usuario cada 15 min |
| `MCP_RATE_LIMIT_MAX` | `120` | Peticiones MCP por usuario por minuto |
| `SETTINGS_ENCRYPTION_KEY` | derivada de `JWT_SECRET` | Cifrado de la clave del cliente |

## Problemas frecuentes

**«Esta clave no está asociada a un workspace» (error 400 de Anthropic).** La clave no está asociada a ningún workspace concreto y Anthropic exige indicar cuál (se observó con claves que empiezan por `sk-ant-usr…`, pero el prefijo no es lo que decide: una clave nueva del mismo tipo creada dentro de un workspace sí funcionó). Solución: crear la clave **dentro de un workspace** (console.anthropic.com → Workspaces → elegir uno → API keys → Create key). Vale tanto para `ANTHROPIC_API_KEY` como para la que guarda el cliente en Ajustes. El CRM lo detecta al guardar la clave y también durante el chat, y lo explica en español. (Ver una sola vez este error en una clave que antes funcionaba suele indicar que se creó un segundo workspace.)

**Comprobado en una prueba real (2026-10-22):** con `customer_then_provider`, al invalidarse la clave del cliente el chat muestra el aviso de cambio a la clave del proveedor y continúa con ella; sin esa política, se detiene sin gastar nada del proveedor.
