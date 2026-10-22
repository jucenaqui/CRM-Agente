# NEWCRM: hallazgos de seguridad

Revisión de Security (fase 2) sobre `backend/src` y `frontend/src`, más `npm audit` en los dos módulos.

## Resumen
| Severidad | Total | Resueltos | Abiertos o aceptados |
|---|---|---|---|
| Crítica | 1 | 1 | 0 |
| Alta | 1 | 1 | 0 |
| Media | 3 | 0 | 3 (recomendaciones) |
| Baja | 6 | 0 | 6 (aceptados) |
| Info | 1 | — | — |

## Hallazgos
| ID | Sev. | Archivo:línea | Descripción | Fix | Estado |
|---|---|---|---|---|---|
| SEC-001 | Crítica | `frontend/package.json` (devDep `vitest@^2.1.4`, transitiva `tinypool<=2.1.1`) | `npm audit`: GHSA-5gmw-xhrv-c9v3 y GHSA-85c8-ppgw-ccpr (prototype pollution → RCE en tinypool/vitest). Afecta al entorno de desarrollo y CI. | `vitest` → `^4.1.12` | **Resuelto** (Security) |
| SEC-002 | Alta | `frontend/package.json` (devDep `vite@^5.4.10`) | `npm audit`: vulnerabilidades del dev server de Vite (<=6.4.3, lectura de ficheros vía `server.fs`) y de esbuild. | `vite` → `^6.4.5`, `@vitejs/plugin-react` → `^4.7.0` | **Resuelto** (Security) |
| SEC-003 | Media | `frontend/package.json` (`react-router-dom@^6.28.0`) | `npm audit` moderate: open redirect con backslash en `<Link>`/`useNavigate` (GHSA-wrjc-x8rr-h8h6) y un fallo de SSR que no aplica a una SPA. La redirección post-login ya sólo acepta rutas internas. | Migrar a `react-router-dom@7.18.4+` (cambio mayor) | Abierto, recomendado al Frontend |
| SEC-004 | Media | `backend/src/config.ts:8,28` | Sin `NODE_ENV=production` y sin `JWT_SECRET`, se usa un secreto fijo del repo, lo que permitiría forjar tokens. En producción el arranque falla (`assertConfig`, >= 32 caracteres). | `console.warn` o exigir `JWT_SECRET` salvo en test | Abierto (aceptable en dev) |
| SEC-005 | Media | `backend/src/seed.ts:24-25` | El seed crea o resetea `admin@crm.local/Admin123!` y `sales@crm.local/Sales123!`. Ejecutado en producción, deja credenciales conocidas. | Abortar si `NODE_ENV=production` salvo flag explícito | Abierto, recomendado al Backend |
| SEC-006 | Baja | `backend/src/lib/users.ts:29` | `register` responde 409 `EMAIL_TAKEN`, lo que permite enumerar emails. El login no enumera: mensaje único `INVALID_CREDENTIALS` y hash dummy para igualar tiempos. | Lo mitiga el rate limit de register (10 cada 15 min) | Aceptado |
| SEC-007 | Baja | `backend/src/app.ts:50` | Fuera de producción, el 500 devuelve `err.message` (sin stack). En producción el mensaje es genérico. | — | Aceptado |
| SEC-008 | Baja | `frontend/src/api/client.ts:76` | Token en `localStorage` (lo pide el contrato). No hay sinks XSS: sin `dangerouslySetInnerHTML` ni `innerHTML`, `website` pasa por `safeUrl` (sólo http/https) con `rel="noopener noreferrer"` y `mailto:` lleva prefijo fijo. | Opción futura: cookie httpOnly | Aceptado |
| SEC-009 | Baja | `backend/src/lib/auth.ts` (`signToken`) | No hay revocación de JWT. El usuario y su rol se recargan de la BD en cada petición, así que un usuario borrado o degradado pierde acceso enseguida. | Opcional: `tokenVersion` | Aceptado |
| SEC-010 | Baja | `backend/src/lib/validation.ts:87` | bcrypt trunca a 72 bytes y la contraseña admite hasta 128 caracteres. | Opcional: limitar a 72 bytes | Aceptado |
| SEC-011 | Baja | `backend/src/middleware/security.ts` | El rate limit es en memoria por proceso. `trust proxy` sólo se activa con `TRUST_PROXY`, lo que evita spoofing por `X-Forwarded-For`. | Store compartido si se escala | Aceptado |
| SEC-012 | Info | Entorno | El Node global pasó a v24.20.0 dentro de la carpeta nvm `v22.12.0` y el npm global está roto (`Class extends value undefined`). Security usó un npm 10.9.2 temporal en el scratchpad. | Reinstalar Node 22.12 con nvm | Fuera de alcance |

## Controles verificados (sin hallazgo)
- **SQL.** Todo va parametrizado. Tablas y columnas vienen de código. `sort` usa whitelist por entidad (400 si no está) y `order` ∈ {asc, desc}. LIKE con `%`, `_` y `\` escapados.
- **IDOR.** `findOwned` aplica `WHERE id=? AND ownerId=?` para `sales` en GET, PATCH, DELETE y `/deals/:id/stage` (lo ajeno da 404). Listas y dashboard filtran por `ownerId`. `checkRefs` impide enlazar referencias ajenas (422).
- **Mass assignment.** `z.strictObject` en todos los esquemas. `ownerId` sale siempre del token. `register` ignora `role`.
- **Admin.** `/api/users` va con `requireAuth` + `requireRole('admin')`. Hay protección del último admin y nadie puede borrarse a sí mismo.
- **Contraseñas y JWT.** bcryptjs con cost 10 (>= 10 en producción). `toPublicUser` en todas las respuestas, sin `passwordHash`. HS256 fijado al firmar y al verificar (se rechaza `alg=none`), `expiresIn` 8h.
- **Errores.** Formato del contrato. JSON malformado da 400, body de más de 100kb da 413, sin stack traces.
- **Cabeceras.** helmet, `x-powered-by` desactivado, CORS restringido a `CORS_ORIGIN`.
- **Frontend.** En 401 se borra el token y la app vuelve a /login (login y registro quedan excluidos). La redirección post-login sólo acepta rutas internas.

## Cambios en carpetas ajenas (hechos por Security)
| Fichero | Cambio | Motivo |
|---|---|---|
| `frontend/package.json`, `frontend/package-lock.json` | `vite ^5.4.10→^6.4.5`, `vitest ^2.1.4→^4.1.12`, `@vitejs/plugin-react ^4.3.3→^4.7.0` | SEC-001 y SEC-002. Instalado con `--legacy-peer-deps` por un bug de arborist (`edgesOut` null). Un `npm install` normal posterior funciona. |
| `frontend/vite.config.ts:1` | `defineConfig` importado de `vitest/config`, sin la referencia `/// <reference types="vitest" />` | Con Vitest 4, `tsc --noEmit` fallaba por la clave `test`. |
| `backend/package.json` | Añadidas `helmet`, `cors`, `express-rate-limit` y la devDep `@types/cors` | Fase 1 |

**Verificación:**
- Frontend: `tsc --noEmit` OK, `vite build` OK, 57/57 tests.
- Backend: `tsc` OK, 226/226 tests (incluye `tests/security`), `npm audit` sin vulnerabilidades.
