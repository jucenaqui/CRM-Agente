# Security: estado

**Estado: DONE.** Los hallazgos críticos y altos están resueltos y verificados. El detalle está en `docs/security/FINDINGS.md`.

## Entregables
- `docs/security/THREAT_MODEL.md`: STRIDE de auth, IDOR, inyección SQL, XSS, fuerza bruta y secretos.
- `backend/src/middleware/security.ts`: `applySecurity(app)`. Aplica:
  - `x-powered-by` desactivado y helmet (CSP `default-src 'none'`).
  - CORS restringido a `CORS_ORIGIN` (por defecto `http://localhost:5173`, admite varios separados por comas).
  - Body JSON y urlencoded limitado a 100kb.
  - Rate limit general de 300 req cada 15 min en `/api`.
  - Rate limit estricto de 10 cada 15 min en `/api/auth/login` (sólo cuenta los fallos) y en `/api/auth/register` (cuenta todo).
  - Las respuestas 429 siguen el formato del contrato (`RATE_LIMITED`).
  - Se desactiva con `NODE_ENV=test` o `RATE_LIMIT_DISABLED=1`. Los límites se ajustan con `RATE_LIMIT_MAX` y `AUTH_RATE_LIMIT_MAX`, y `TRUST_PROXY` es opcional.
- `backend/tests/security/`:
  - `security.test.ts`: IDOR (leer, listar, editar, borrar, cambiar etapa y enlazar referencias ajenas entre dos `sales`), dashboard aislado, 401 sin token o con token forjado, malformado o `alg=none`, `sort` y `order` inyectados → 400, búsqueda con metacaracteres SQL, `passwordHash` ausente en todas las respuestas de auth y users, no enumeración en login, `role` ignorado en register, `sales` sin acceso a `/api/users`, body > 100kb, JSON malformado, cabeceras y CORS.
  - `rateLimit.test.ts`: 429 en login, desactivación por env, 413 y CORS configurable.

## Hallazgos
| Severidad | Total | Estado |
|---|---|---|
| Crítica | 1 | Resuelto (vitest/tinypool RCE → vitest 4.1.12) |
| Alta | 1 | Resuelto (vite dev server → vite 6.4.5) |
| Media | 3 | Abiertos, recomendados: react-router 7, aviso por secreto JWT de dev, seed bloqueado en producción |
| Baja | 5 | Aceptados: enumeración en register, `err.message` en dev, token en localStorage, sin revocación de JWT, límite de 72 bytes de bcrypt, rate limit en memoria |

El código del backend no tenía hallazgos críticos ni altos: consultas parametrizadas, whitelist de `sort`, control de propiedad en todos los endpoints, `strictObject` en zod, bcrypt, JWT HS256 con caducidad y secreto obligatorio en producción, sin `passwordHash` en las respuestas y login sin enumeración.

## Verificación
- Backend: `tsc` OK, 226/226 tests (12 ficheros), `npm audit` sin vulnerabilidades.
- Frontend: `tsc --noEmit` OK, `vite build` OK, 57/57 tests, `npm audit` con 2 moderadas (react-router, SEC-003).

## Nota de entorno
El npm global está roto: Node 24 quedó instalado sobre la carpeta nvm `v22.12.0`. Los comandos se ejecutaron con `node node_modules/...` y con un npm 10.9.2 temporal en el scratchpad.
