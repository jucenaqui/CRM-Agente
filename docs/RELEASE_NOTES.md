# NEWCRM v1.0.0: release notes

**Fecha:** 2026-10-22
**Estado:** listo para uso local. Se cumple la definición de terminado de `docs/CONTRACT.md`.

## Qué incluye
- **Backend** (Express 5 + TypeScript + SQLite):
  - Todos los endpoints del contrato: auth, users, companies, contacts, deals (incluido `PATCH /:id/stage`), activities, `dashboard/stats` y `health`.
  - Paginación, búsqueda, orden con whitelist y filtros.
  - Control de propiedad: un `sales` sólo ve lo suyo, lo ajeno da 404 y el admin lo ve todo.
  - Validación zod estricta, errores en el formato del contrato y seed.
  - Seguridad: helmet, CORS restringido, rate limit y límite de body.
- **Frontend** (React 18 + Vite 6 + React Router):
  - Pantallas: Login, Registro, Dashboard (KPIs, embudo y próximas actividades), Empresas, Contactos, Deals (lista y Kanban con drag&drop y botones), Actividades y Usuarios (sólo admin).
  - Sidebar, rutas protegidas, y token en memoria y en `localStorage`.
- **Raíz**: `npm install` (con `postinstall` que instala los dos subproyectos), `npm run dev`, `build`, `test` y `seed`.
- **Documentación**:
  - `README.md`
  - `docs/PRD.md`, `docs/BACKLOG.md`, `docs/CHANGELOG_CONTRACT.md` y `docs/INTEGRATION_ISSUES.md`
  - `docs/security/*` y `docs/qa/*`

## Verificación del cierre (PM)
Comandos ejecutados desde la raíz en PowerShell con **Node 22.12.0 / npm 10.9.0** (portable, porque el npm global de la máquina está roto; ver Pendientes). Después el coordinador repitió `npm test` con el Node 24.20 / npm 11.19 del sistema: 226 + 58 tests pasan (`npm run`/`npm test` funcionan; `install`, `ls` y `audit` no).

| Paso | Resultado |
|---|---|
| `npm install` (+ `postinstall` → backend y frontend) | ✅ exit 0 (después de corregir INT-4) |
| `npm run build` (`tsc` backend + `tsc --noEmit && vite build` frontend) | ✅ exit 0 (después de corregir INT-3) |
| `npm test` | ✅ backend 12 ficheros / **226 tests**, frontend 6 ficheros / **58 tests** |
| `npm run seed` | ✅ |
| `npm run dev` (concurrently) | ✅ backend en :4000 (driver `better-sqlite3`), Vite en :5173 |
| `GET http://localhost:4000/api/health` | ✅ `{"status":"ok"}`, también a través del proxy `:5173/api/health` |
| `GET http://localhost:5173/` | ✅ 200, sirve `index.html` con `#root` |
| Smoke de integración real (a través del proxy de Vite) | ✅ **23/23**. Cubre login, me, el CRUD de las 4 entidades con opcionales `null`, cambio de etapa, completar actividad, `pageSize` 100 y su tope, filtros, forma de `error.details`, dashboard, `DELETE` 204, 401 y 403 |
| Procesos detenidos al terminar | ✅ los puertos 4000 y 5173 quedan libres |

## Correcciones aplicadas en el cierre (detalle en `docs/INTEGRATION_ISSUES.md`)
- **INT-2**: `ApiError.fieldErrors()` no leía `details[].path` cuando es un string, que es el formato real del backend. Los errores de campo no se mostraban en los formularios. Se corrigió y se añadió un test de regresión. También se ajustó el test QA [F-07].
- **INT-3**: faltaba `@types/cors` en `backend/package.json`, por lo que `npm run build` fallaba. Se añadió.
- **INT-4**: el `postinstall` raíz entraba en recursión con `npm --prefix ... install`. Ahora usa `cd backend && npm install && cd ../frontend && npm install`.
- **INT-1** (`website` sin esquema) ya estaba resuelto por Backend y QA (BUG-001).

## Seguridad y calidad
- **Seguridad**: los hallazgos críticos y altos están resueltos: SEC-001 (vitest/tinypool → vitest 4.x) y SEC-002 (vite → 6.4.5). El código del backend no tenía hallazgos críticos ni altos.
- **QA**: 3 bugs registrados.
  - BUG-001: corregido.
  - BUG-002: es de entorno y está mitigado en el proyecto.
  - BUG-003 (Baja): sigue abierto.

## Pendientes (no bloquean la release)
| ID | Severidad | Descripción | Dueño |
|---|---|---|---|
| SEC-006..011 | Baja | Riesgos aceptados: enumeración de emails en el registro, token en `localStorage`, sin revocación de JWT, límite de 72 bytes de bcrypt y rate limit en memoria. | — |
| BUG-002 | Entorno | En la máquina, la carpeta nvm `v22.12.0` contiene ahora Node 24.20 con un npm 11.19 dañado: `npm install`, `npm ls` y `npm audit` fallan con "Class extends value undefined…" (`npm run` y `npm test` sí funcionan). Para repararlo: `nvm uninstall 22.12.0 && nvm install 22.12.0 && nvm use 22.12.0`. El backend funciona con Node 22 (`better-sqlite3`) y con Node 24 (fallback a `node:sqlite`). | Usuario |
| — | Resuelto | `docs/qa/REPORT.md` creado por el coordinador con autorización del usuario (el permiso se lo había bloqueado al agente QA). Ver también `docs/status/qa.md` y `docs/qa/BUGS.md`. | Usuario |
| — | Limitación | El Kanban y los selects cargan como máximo 100 registros (`MAX_PAGE_SIZE`). Con más, el Kanban muestra un aviso. | — |

## Cómo arrancar
```bash
npm install
npm run seed
npm run dev          # http://localhost:5173  ·  admin@crm.local / Admin123!
```

## Actualización 2026-10-22: seguridad
SEC-003 (react-router 7, `npm audit` sin vulnerabilidades), SEC-004 (aviso de `JWT_SECRET` ausente) y SEC-005 (el seed no corre en producción salvo `SEED_ALLOW_PRODUCTION=1`) quedaron resueltos, igual que BUG-003 (el dashboard ya no se queda en blanco con datos mal formados). Detalle en `docs/security/FINDINGS.md`.
