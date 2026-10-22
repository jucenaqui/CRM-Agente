# NEWCRM

CRM ligero para equipos comerciales pequeños: empresas, contactos, oportunidades (deals) con kanban por etapa, actividades de seguimiento y dashboard de KPIs. Backend Express + SQLite, frontend React + Vite. Todo se ejecuta en local, sin servicios externos.

## Requisitos
- Node.js **22** (verificado con 22.12.0 y npm 10.9) — también funciona con Node 24 gracias al fallback a `node:sqlite`
- Windows, macOS o Linux. `better-sqlite3` usa binarios precompilados; si no hay uno para tu plataforma necesitarás herramientas de compilación (Python + compilador C++ / "Desktop development with C++" en Windows).

## Problemas conocidos de entorno
Si `npm` falla con `Class extends value undefined is not a constructor or null`, la instalación de Node/npm de la máquina está dañada (por ejemplo, un MSI de Node 24 escrito sobre la carpeta de nvm). Afecta a `npm install`, `npm ls` y `npm audit`; `npm run` puede seguir funcionando. Repárala con `nvm uninstall 22.12.0 && nvm install 22.12.0 && nvm use 22.12.0`, o usa una distribución portable de Node 22 anteponiendo su carpeta al `PATH`.

## Instalación
```bash
npm install          # instala la raíz y, vía postinstall, /backend y /frontend
cp backend/.env.example backend/.env   # en PowerShell: Copy-Item backend/.env.example backend/.env
# edita backend/.env y pon un JWT_SECRET largo y aleatorio
npm run seed         # crea la BD con datos de ejemplo
```
Si necesitas reinstalar sólo los subproyectos: `npm run install:all`.

## Ejecución
```bash
npm run dev
```
- Backend: http://localhost:4000 (health: http://localhost:4000/api/health)
- Frontend: http://localhost:5173 (proxy `/api` → `http://localhost:4000`)

### Credenciales seed
| Email | Contraseña | Rol |
|---|---|---|
| `admin@crm.local` | `Admin123!` | admin |
| `sales@crm.local` | `Sales123!` | sales |

Si `JWT_SECRET` no está definido, en desarrollo se usa un secreto fijo de desarrollo. En `NODE_ENV=production` el arranque falla sin un secreto de ≥ 32 caracteres. El seed se niega a ejecutarse con `NODE_ENV=production` (crea credenciales conocidas); sólo se fuerza con `SEED_ALLOW_PRODUCTION=1` en un entorno de demostración.

Si no ejecutas el seed, el **primer usuario que se registre** será `admin`; los siguientes serán `sales`.

## Scripts (raíz)
| Script | Descripción |
|---|---|
| `npm run dev` | Backend + frontend en paralelo (`concurrently`) |
| `npm run install:all` | `npm install` en `/backend` y `/frontend` (se ejecuta en `postinstall`) |
| `npm run build` | Compila backend (`tsc`) y frontend (`vite build`) |
| `npm test` | Tests de backend y frontend (vitest) |
| `npm run seed` | Carga datos de ejemplo en la BD |
| `npm run dev:backend` / `dev:frontend` | Arranca sólo uno de los dos |
| `npm run test:backend` / `test:frontend` | Tests de uno de los dos |

## Variables de entorno (`backend/.env`)
| Variable | Por defecto | Descripción |
|---|---|---|
| `PORT` | `4000` | Puerto HTTP del backend |
| `JWT_SECRET` | — (obligatorio fuera de dev/test) | Secreto para firmar los JWT; usa ≥ 32 caracteres aleatorios |
| `DB_PATH` | `./data/crm.db` | Ruta del fichero SQLite |
| `CORS_ORIGIN` | `http://localhost:5173` | Origen(es) permitido(s) para CORS, separados por comas |
| `JWT_EXPIRES_IN` | `8h` | (opcional) Caducidad del token |
| `BCRYPT_ROUNDS` | `10` | (opcional) Coste de bcrypt |
| `RATE_LIMIT_MAX` / `AUTH_RATE_LIMIT_MAX` | `300` / `10` | (opcional) Peticiones por 15 min en `/api` y en login/registro |
| `SQLITE_DRIVER` | auto | (opcional) `better` o `node`; por defecto usa `better-sqlite3` y, si su binario no carga (p. ej. Node 24), `node:sqlite` |
| `ANTHROPIC_API_KEY` | — | Clave de la API de Anthropic para el asistente IA; sin ella el asistente responde 503 |
| `AGENT_MODELS` | todos | (opcional) Modelos que el cliente puede elegir, separados por comas |
| `AGENT_DEFAULT_MODEL` | `claude-opus-5-5` | (opcional) Modelo preseleccionado |
| `AGENT_RATE_LIMIT_MAX` | `60` | (opcional) Mensajes al asistente por usuario cada 15 min |
| `AGENT_KEY_POLICY` | `default` | (opcional) Qué clave paga el asistente: `default`, `provider_only`, `customer_only`, `customer_then_provider` |
| `AGENT_FALLBACK_MONTHLY_CAP_USD` | `10` | (opcional) Tope mensual del respaldo con la clave del proveedor |
| `SETTINGS_ENCRYPTION_KEY` | derivada de `JWT_SECRET` | (opcional) Cifrado de la clave de Anthropic que guarda el cliente |
| `MCP_RATE_LIMIT_MAX` | `120` | (opcional) Peticiones MCP por usuario por minuto |

Ver `backend/.env.example`.

## Estructura
```
NEWCRM/
├── package.json          # scripts raíz (concurrently)
├── backend/              # Express + TypeScript + better-sqlite3 + zod + JWT
│   ├── src/              # app, rutas, middleware, db, seed
│   └── tests/            # vitest + supertest (tests/e2e: QA)
├── frontend/             # React 18 + Vite + TypeScript + React Router
│   ├── src/              # páginas, componentes, cliente API, auth
│   └── tests/qa/         # tests QA (Testing Library)
└── docs/
    ├── CONTRACT.md       # contrato API/dominio compartido
    ├── PRD.md            # requisitos de producto
    ├── BACKLOG.md        # tareas por agente
    ├── INTEGRATION_ISSUES.md
    ├── RELEASE_NOTES.md
    ├── status/           # estado de cada agente
    ├── security/         # hallazgos de seguridad
    └── qa/               # plan de pruebas y bugs
```

## Asistente IA

Botón **Asistente** (abajo a la derecha, en todas las pantallas). Abre un chat donde se le pide en lenguaje natural lo mismo que se haría en la interfaz: buscar, crear, editar, mover de etapa o borrar empresas, contactos, deals, actividades y (si eres admin) usuarios. Las pantallas abiertas se refrescan solas cuando el asistente cambia datos.

- **Permisos:** el asistente actúa con tu sesión. Un `sales` sólo ve y cambia lo suyo; sólo un admin gestiona usuarios. Antes de borrar, confirma qué va a borrar salvo que se lo hayas pedido sin ambigüedad.
- **Modelo:** cada usuario elige en el panel entre los modelos habilitados y puede cambiarlo a mitad de conversación. El servidor decide cuáles se ofrecen (`AGENT_MODELS`) y el preseleccionado (`AGENT_DEFAULT_MODEL`).

| Modelo | Uso | Entrada / salida (USD por millón de tokens) |
|---|---|---|
| `claude-opus-5-5` (por defecto) | Equilibrio recomendado | 4 / 20 |
| `claude-sonnet-5-5` | Rápido y económico | 2 / 10 |
| `claude-haiku-5-5` | El más barato, tareas sencillas | 0.10 / 0.50 |
| `claude-fable-5-1` | El más potente, más lento y caro | 10 / 50 |

- **Coste:** tras cada respuesta el panel muestra los tokens y un coste estimado. El consumo por clave y por usuario está en **Ajustes** (admins).
- **Quién paga:** la clave del proveedor (`ANTHROPIC_API_KEY`), la del propio cliente (la guarda un admin en **Ajustes**, cifrada) o ambas con respaldo limitado. También se puede usar sin el chat del CRM, desde Claude Code o Claude Desktop, con un token personal (**MCP**). Todo el detalle en [docs/AI_ASSISTANT.md](docs/AI_ASSISTANT.md).
- **Historial:** las conversaciones se guardan por usuario (privadas) y se pueden reabrir o borrar.
- **Puesta en marcha:** crea una clave en https://console.anthropic.com, ponla en `backend/.env` como `ANTHROPIC_API_KEY=...`, reinicia y comprueba con:
  ```bash
  npm --prefix backend run agent:check   # verifica la clave y que cada modelo esté disponible (no gasta tokens)
  ```

## API (resumen)
Prefijo `/api`, JSON, cabecera `Authorization: Bearer <token>` (salvo auth y health).

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/api/auth/register` | `{name,email,password}` → `{token,user}` |
| POST | `/api/auth/login` | `{email,password}` → `{token,user}` |
| GET | `/api/auth/me` | usuario actual |
| GET/POST | `/api/users` | admin: listar / crear |
| PATCH/DELETE | `/api/users/:id` | admin |
| GET/POST | `/api/companies` | listar / crear |
| GET/PATCH/DELETE | `/api/companies/:id` | detalle / editar / borrar |
| GET/POST | `/api/contacts` | filtro `?companyId=` |
| GET/PATCH/DELETE | `/api/contacts/:id` | |
| GET/POST | `/api/deals` | filtros `?stage=&companyId=&contactId=` |
| GET/PATCH/DELETE | `/api/deals/:id` | |
| PATCH | `/api/deals/:id/stage` | `{stage}` (kanban) |
| GET/POST | `/api/activities` | filtros `?contactId=&dealId=&completed=` |
| GET/PATCH/DELETE | `/api/activities/:id` | |
| GET | `/api/dashboard/stats` | totales, deals por etapa, próximas actividades |
| GET | `/api/agent/models` | modelos del asistente que el cliente puede elegir |
| POST | `/api/agent/chat` | mensaje al asistente → respuesta en streaming (SSE) |
| GET/DELETE | `/api/agent/conversations[/:id]` | historial de conversaciones propias |
| GET/PUT/DELETE | `/api/agent/settings[/customer-key]` | admin: estado y clave de Anthropic del cliente |
| GET | `/api/agent/usage` | admin: consumo del asistente por mes |
| GET/POST/DELETE | `/api/tokens[/:id]` | tokens personales para MCP |
| POST | `/api/mcp` | servidor MCP (autenticado con token personal) |
| GET | `/api/health` | `{status:"ok"}` |

- Listas: `?page=1&pageSize=20&search=&sort=&order=asc|desc` → `{data,total,page,pageSize}`.
- Errores: `{ "error": { "code", "message", "details"? } }`.
- Roles: `sales` sólo ve/edita sus registros; `admin` ve todo y gestiona usuarios.
- Etapas de deal: `lead`, `qualified`, `proposal`, `negotiation`, `won`, `lost`.

Detalle completo en [`docs/CONTRACT.md`](docs/CONTRACT.md).

## Tests
```bash
npm test                 # todo
npm run test:backend     # vitest + supertest (incluye tests e2e de QA)
npm run test:frontend    # vitest + Testing Library (jsdom), incluye tests/qa
```
Estado al cierre: backend 226 tests (integración, e2e de QA y seguridad); frontend 58 tests.

## Documentación
Índice completo y orden de lectura: [docs/README.md](docs/README.md).
- [Asistente IA y MCP](docs/AI_ASSISTANT.md) · [PRD](docs/PRD.md) · [Backlog](docs/BACKLOG.md) · [Contrato](docs/CONTRACT.md) · [Cambios al contrato](docs/CHANGELOG_CONTRACT.md) · [Integración](docs/INTEGRATION_ISSUES.md) · [Release notes](docs/RELEASE_NOTES.md)
- Seguridad: [Threat model](docs/security/THREAT_MODEL.md) · [Hallazgos](docs/security/FINDINGS.md) — QA: [Plan](docs/qa/TEST_PLAN.md) · [Bugs](docs/qa/BUGS.md)
