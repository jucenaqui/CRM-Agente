# NEWCRM — Backlog

Estados: `TODO` · `DOING` · `DONE` · `BLOCKED`. Actualizado por el PM a partir de `docs/status/*.md`, `docs/security/FINDINGS.md`, `docs/qa/BUGS.md`.

_Última revisión: 2026-10-22 (cierre) — los 4 agentes DONE; cierre del PM verificado (install, build, test, dev + smoke). Ver `docs/RELEASE_NOTES.md`._

## PM
| ID | Tarea | Estado |
|---|---|---|
| PM-1 | PRD (`docs/PRD.md`) | DONE |
| PM-2 | Backlog (`docs/BACKLOG.md`) | DONE |
| PM-3 | `package.json` raíz (dev/install:all/build/test/seed + concurrently) | DONE |
| PM-4 | README, `.gitignore`, `backend/.env.example` | DONE |
| PM-5 | Seguimiento e `INTEGRATION_ISSUES.md` | DONE |
| PM-6 | Cierre: install/build/test/dev + `RELEASE_NOTES.md` | DONE |

## Backend
| ID | Tarea | Estado |
|---|---|---|
| BE-1 | Scaffold Express + TS + config env (PORT, JWT_SECRET, DB_PATH, CORS_ORIGIN) | DONE |
| BE-2 | Esquema SQLite + migraciones (users, companies, contacts, deals, activities) | DONE |
| BE-3 | Middleware errores `{error:{code,message,details}}` + validación zod | DONE |
| BE-4 | Auth: register (1º = admin), login, me, middleware JWT | DONE |
| BE-5 | Users CRUD (admin) | DONE |
| BE-6 | Companies CRUD + lista paginada/búsqueda/orden + ownership | DONE |
| BE-7 | Contacts CRUD + filtro companyId | DONE |
| BE-8 | Deals CRUD + filtros + PATCH stage | DONE |
| BE-9 | Activities CRUD + filtros (contactId, dealId, completed) | DONE |
| BE-10 | Dashboard stats | DONE |
| BE-11 | `/api/health` | DONE |
| BE-12 | Seed (`admin@crm.local` / `Admin123!` + datos demo) | DONE |
| BE-13 | Tests vitest + supertest | DONE |
| BE-14 | `docs/status/backend.md` | DONE |

## Frontend
| ID | Tarea | Estado |
|---|---|---|
| FE-1 | Scaffold Vite + React + TS + Router + proxy `/api` | DONE |
| FE-2 | Cliente API + AuthContext (token memoria + localStorage) + ruta protegida | DONE |
| FE-3 | Login / Registro | DONE |
| FE-4 | Layout con sidebar | DONE |
| FE-5 | Dashboard (KPIs, embudo, próximas actividades) | DONE |
| FE-6 | Empresas (lista + detalle/edición) | DONE |
| FE-7 | Contactos (lista + detalle con actividades) | DONE |
| FE-8 | Deals (lista + kanban con cambio de etapa) | DONE |
| FE-9 | Actividades (lista, marcar completada) | DONE |
| FE-10 | Usuarios (sólo admin) | DONE |
| FE-11 | Tests vitest + Testing Library | DONE |
| FE-12 | `docs/status/frontend.md` | DONE |

## Security
| ID | Tarea | Estado |
|---|---|---|
| SEC-1 | Middleware de seguridad (cabeceras, CORS, rate limit) | DONE |
| SEC-2 | Revisión auth/JWT/bcrypt, autorización por ownership (IDOR) | DONE |
| SEC-3 | Revisión inyección SQL / validación / XSS frontend | DONE |
| SEC-4 | `docs/security/FINDINGS.md` + parches críticos/altos | DONE |
| SEC-5 | `docs/status/security.md` | DONE |

## QA
| ID | Tarea | Estado |
|---|---|---|
| QA-1 | Plan de pruebas (`docs/qa`) | DONE |
| QA-2 | Tests e2e backend (`backend/tests/e2e`) | DONE |
| QA-3 | Tests frontend (`frontend/tests/qa`) | DONE |
| QA-4 | `docs/qa/BUGS.md` | DONE |
| QA-5 | `docs/status/qa.md` | DONE |

## Pendientes post-release (no bloquean)
| ID | Origen | Tarea | Dueño | Estado |
|---|---|---|---|---|
| POST-1 | SEC-003 (Media) | Migrar `react-router-dom` a 7.x (2 avisos moderados en `npm audit` del frontend) | Frontend | DONE |
| POST-2 | SEC-004 (Media) | Avisar con `console.warn` (o exigir) si no hay `JWT_SECRET` fuera de test | Backend | DONE |
| POST-3 | SEC-005 (Media) | El seed debe abortar con `NODE_ENV=production` salvo flag explícito | Backend | DONE |
| POST-4 | BUG-003 (Baja) | Dashboard tolerante a un `stats` malformado | Frontend | DONE |
| POST-5 | BUG-002 (entorno) | Node/npm de la máquina reparados (Node 22.12 / npm 10.9) | Usuario | DONE |
| POST-6 | INT-1..4 | Correcciones de integración aplicadas por el PM (ver `docs/INTEGRATION_ISSUES.md`) | PM | DONE |
