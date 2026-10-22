# NEWCRM — Contrato del equipo

Fuente de verdad compartida por todos los agentes. Si alguien necesita cambiarla, lo anota en `docs/CHANGELOG_CONTRACT.md` y avisa al PM.

## Stack
- **Backend** (`/backend`): Node 22 + Express + TypeScript (tsx para dev), SQLite con `better-sqlite3`, validación con `zod`, auth JWT (`jsonwebtoken`) + `bcryptjs`. Puerto **4000**. Tests con `vitest` + `supertest`.
- **Frontend** (`/frontend`): React 18 + Vite + TypeScript + React Router. Puerto **5173**, proxy `/api` → `http://localhost:4000`. Tests con `vitest` + Testing Library.
- **Raíz**: `package.json` con scripts `dev` (ambos a la vez con `concurrently`), `test`, `build`.

## Propiedad de carpetas (nadie edita la carpeta de otro sin coordinar)
| Agente | Carpetas |
|---|---|
| PM | `/docs` (salvo `docs/security`, `docs/qa`), `README.md`, `package.json` raíz |
| Backend | `/backend` (salvo `backend/tests/e2e` y `backend/src/middleware/security*`) |
| Frontend | `/frontend` (salvo `frontend/tests/qa`) |
| Security | `/docs/security`, `backend/src/middleware/security*.ts`; puede proponer parches en backend/frontend anotándolos en `docs/security/FINDINGS.md` y aplicarlos tras el backend terminar su módulo |
| QA | `/docs/qa`, `backend/tests/e2e`, `frontend/tests/qa` |

## Dominio
- **User**: id, name, email (único), passwordHash, role (`admin` | `sales`), createdAt
- **Company**: id, name, industry, website, phone, address, ownerId, createdAt, updatedAt
- **Contact**: id, firstName, lastName, email, phone, position, companyId?, ownerId, createdAt, updatedAt
- **Deal**: id, title, value (número), currency (default `USD`), stage (`lead` | `qualified` | `proposal` | `negotiation` | `won` | `lost`), contactId?, companyId?, ownerId, expectedCloseDate?, createdAt, updatedAt
- **Activity**: id, type (`call` | `email` | `meeting` | `task` | `note`), subject, description, dueDate?, completed (bool), contactId?, dealId?, ownerId, createdAt

Reglas: `sales` sólo ve/edita sus propios registros; `admin` ve todo y gestiona usuarios. El primer usuario registrado es `admin`.

## API (prefijo `/api`, JSON, header `Authorization: Bearer <token>`)
Errores: `{ "error": { "code": string, "message": string, "details"?: any } }` con status 400/401/403/404/409/422/429/500.
Listas: `GET` acepta `?page=1&pageSize=20&search=...&sort=field&order=asc|desc`, responde `{ data: T[], total, page, pageSize }`.

| Método | Ruta | Descripción |
|---|---|---|
| POST | /api/auth/register | {name,email,password} → {token,user} |
| POST | /api/auth/login | {email,password} → {token,user} |
| GET | /api/auth/me | → user |
| GET/POST | /api/users | admin: listar / crear |
| PATCH/DELETE | /api/users/:id | admin |
| GET/POST | /api/companies | listar / crear |
| GET/PATCH/DELETE | /api/companies/:id | |
| GET/POST | /api/contacts | filtro extra `?companyId=` |
| GET/PATCH/DELETE | /api/contacts/:id | |
| GET/POST | /api/deals | filtros `?stage=&companyId=&contactId=` |
| GET/PATCH/DELETE | /api/deals/:id | |
| PATCH | /api/deals/:id/stage | {stage} (para kanban) |
| GET/POST | /api/activities | filtros `?contactId=&dealId=&completed=` |
| GET/PATCH/DELETE | /api/activities/:id | |
| GET | /api/dashboard/stats | {totals:{companies,contacts,deals,openDealsValue,wonDealsValue}, dealsByStage:[{stage,count,value}], upcomingActivities:Activity[]} |
| GET | /api/health | {status:"ok"} (sin auth) |

Campos en JSON: camelCase. Fechas: ISO 8601 string. `user` nunca incluye `passwordHash`.

## Frontend — pantallas
Login, Registro, Dashboard (KPIs + embudo por etapa + próximas actividades), Empresas (lista + detalle/edición), Contactos (lista + detalle con actividades), Deals (lista + kanban por etapa con drag&drop o botones), Actividades (lista, marcar completada), Usuarios (sólo admin). Layout con sidebar, ruta protegida, token en memoria + localStorage.

## Definición de terminado
`npm install` y `npm run dev` en la raíz arrancan todo; `npm test` pasa; flujo completo login → CRUD de las 4 entidades → dashboard funciona; hallazgos de seguridad críticos/altos resueltos; README con instrucciones.
