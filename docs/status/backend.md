# Backend — estado

**Estado: DONE.** Compila (`tsc`) y pasan los tests: 12 ficheros y 226 tests (integración propios + e2e de QA + seguridad).

## Qué hay
- Express 5 + TypeScript (ESM, NodeNext), zod 4, JWT HS256 (`jsonwebtoken`), `bcryptjs`, SQLite.
- `src/app.ts` exporta `app`, `createApp()` y `default` (para supertest); `src/index.ts` carga `.env`, valida la config, abre la BD (las migraciones corren al arrancar) y escucha en `PORT` (4000).
- Seguridad: `app.ts` llama a `applySecurity(app)` de `src/middleware/security.ts` (de Security: helmet, CORS, límite de body, rate limit) antes de las rutas.
- Estructura: `src/config.ts` (env), `src/db.ts` (migraciones), `src/sqlite.ts` (adaptador de driver), `src/lib/{auth,crud,errors,validation,users}.ts`, `src/routes/{auth,users,companies,contacts,deals,activities,dashboard}.ts`, `src/seed.ts`.
- Todos los endpoints del contrato. Las listas admiten paginación, búsqueda LIKE escapada, `sort` con whitelist + `order`, y los filtros del contrato (más `?type=` en activities y `?role=` en users).
- Propiedad: un `sales` sólo ve y edita lo suyo (lo ajeno da 404), tanto en listas y detalle como en el dashboard; el admin lo ve todo. `ownerId` sale siempre del token y los esquemas son `strictObject` (sin mass assignment).
- Auth: el primer usuario registrado es admin y `register` ignora `role`. Login con mensaje único `INVALID_CREDENTIALS`. El token caduca (`JWT_EXPIRES_IN`, por defecto 8h). En cada petición se recarga el usuario desde la BD, así que un usuario borrado da 401. En producción `JWT_SECRET` (>= 32 caracteres) es obligatorio.
- Errores: `{error:{code,message,details?}}`. En producción no se exponen stack ni mensajes internos.

## Cómo correrlo (en `/backend`)
```
npm install
npm run seed      # admin@crm.local / Admin123!  ·  sales@crm.local / Sales123!
npm run dev       # tsx watch, http://localhost:4000
npm run build && npm start
npm test          # vitest run (BD :memory:, rate limit desactivado)
```
Variables de entorno: `PORT`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `DB_PATH` (por defecto `backend/data/crm.db`; `:memory:` en tests), `CORS_ORIGIN`, `BCRYPT_ROUNDS`, `SQLITE_DRIVER` (`better`|`node`, opcional).

## Desviaciones (detalle en `docs/CHANGELOG_CONTRACT.md`)
- `better-sqlite3` fijado a 11.10.0, con fallback automático a `node:sqlite` si el binario nativo no carga (Node 24).
- 400 para validación, 422 para referencias inválidas, 404 para recursos ajenos, 204 en DELETE. Además: `GET /api/users/:id` y protección del último admin.

## Aviso de entorno (importante)
Durante la sesión el Node de la máquina cambió: `C:\Users\HP\AppData\Roaming\nvm\v22.12.0\node.exe` es ahora **v24.20.0** (parece que un instalador MSI de Node 24 escribió a través del symlink `C:\Program Files\nodejs`). El npm de esa carpeta (11.19) está roto: cualquier `npm ...` falla con `Class extends value undefined is not a constructor or null`. Por eso build y tests se han verificado llamando a las herramientas directamente:
```
node node_modules/typescript/bin/tsc
node node_modules/vitest/vitest.mjs run
node node_modules/tsx/dist/cli.mjs src/seed.ts
node dist/index.js
```
Arreglo recomendado (no lo he tocado porque está fuera del proyecto): `nvm uninstall 22.12.0 && nvm install 22.12.0 && nvm use 22.12.0`, o desinstalar el MSI de Node 24 y luego `nvm use`. Con Node 22.12 el backend usa `better-sqlite3`; con Node 24 usa `node:sqlite`. Funciona con los dos.

Verificado además contra el servidor real: health, login del admin del seed y dashboard (4 empresas, 5 contactos, 6 deals).
