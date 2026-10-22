# Incoherencias de integración backend ↔ frontend

Detectadas por el PM leyendo el código y con un smoke contra el servidor real. Estado: `OPEN` · `FIXED (por quién)` · `WONTFIX`.

## INT-1 — `website` de empresa sin esquema es rechazado por el backend — FIXED (Backend + QA)
- **Frontend** `frontend/src/components/forms/CompanyForm.tsx` validaba con `/^(https?:\/\/)?[\w-]+(\.[\w-]+)+.../` (el `http(s)://` es opcional) y enviaba `website` tal cual.
- **Backend** `backend/src/lib/validation.ts` → `optUrl()` exigía `new URL(v)` con protocolo `http:`/`https:`.
- **Efecto**: guardar `acme.com` daba 400 `VALIDATION_ERROR` en `website`.
- **Resolución**: el backend antepone `https://` a un dominio sin esquema (`docs/CHANGELOG_CONTRACT.md`, 2026-10-22) y QA (BUG-001) normalizó el valor en `CompanyForm.tsx`. Verificado en vivo: `smoke.example` → `https://smoke.example` (201).

## INT-2 — Los errores de campo del backend no llegaban a los formularios — FIXED (PM)
- **Backend** (`backend/src/lib/validation.ts`): `details: [{ path: 'name', message, code }]`. `path` es un **string** (`i.path.join('.')`).
- **Frontend** (`frontend/src/api/client.ts`, `ApiError.fieldErrors()`): sólo aceptaba `path` como array (formato zod crudo) o `field`. Con el formato real devolvía `{}` y el formulario sólo mostraba el mensaje general. Los tests del frontend no lo detectaron porque sus mocks usaban `path: ['email']`.
- **Corrección aplicada** (detectada con el smoke contra el backend real):
  ```ts
  const key = Array.isArray(i.path) ? i.path.join('.')
    : typeof i.path === 'string' && i.path ? i.path
    : typeof i.field === 'string' ? i.field : undefined;
  ```
- **Archivos tocados por el PM**:
  - `frontend/src/api/client.ts`: la corrección.
  - `frontend/src/api/client.test.ts`: un test de regresión con el formato real.
  - `frontend/tests/qa/screens.qa.test.tsx`: el test [F-07] "backend validation error is shown in the form" usaba `findByText` con una regex. Ahora esa regex coincide con 2 elementos (el error de campo y el mensaje general), así que se cambió a `findAllByText` y se añadió una comprobación explícita del error de campo.

## INT-3 — `npm run build` del backend fallaba por falta de `@types/cors` — FIXED (PM)
- `backend/src/middleware/security.ts` importa `cors`, pero `@types/cors` no estaba en `backend/package.json`. Probablemente estaba instalado como paquete extraneous y se perdió al reinstalar. Errores de `tsc`: TS7016 y TS7006.
- **Corrección aplicada**: `npm install -D @types/cors@2` en `/backend`. Sólo cambian `package.json` y `package-lock.json`.

## INT-4 — El `postinstall` raíz entraba en recursión con `npm --prefix` — FIXED (PM)
- Al lanzar `npm --prefix backend install` desde el `postinstall` raíz, npm 10 instalaba la raíz como dependencia `file:..` en `backend/node_modules/newcrm` y volvía a ejecutar el `postinstall`, en bucle hasta fallar.
- **Corrección**: `install:all` pasa a ser `cd backend && npm install && cd ../frontend && npm install`. Se eliminó el symlink `backend/node_modules/newcrm`.

## Comprobaciones sin incidencias
- **Rutas**: `/api/auth/*`, `/api/users`, `/api/companies`, `/api/contacts`, `/api/deals` (con `/:id/stage`), `/api/activities` y `/api/dashboard/stats` coinciden entre `frontend/src/api/endpoints.ts` y `backend/src/routes/*`.
- **Formatos**: listas `{data,total,page,pageSize}` y errores `{error:{code,message,details}}`.
- **Campos `sort`** que envía el frontend: todos están en las whitelists del backend.
- **`strictObject`**: el frontend no envía claves extra (`id`, `ownerId`).
- **Usuarios**: `password` sólo se envía al editar si se ha rellenado.
- **`pageSize`**: el Kanban y los selects piden `pageSize=100`, que es el `MAX_PAGE_SIZE` del backend. Con más de 100 deals el Kanban muestra un aviso. Es una limitación conocida, no un bug.
- **422 `INVALID_REFERENCE`** lleva `details:{field}` sin mensaje por campo. Se muestra el mensaje general, lo cual es aceptable.

## Verificación real de los supuestos del frontend
Smoke contra el servidor, a través del proxy de Vite (`npm run dev`): 23/23 ✓.

| Supuesto | Resultado |
|---|---|
| IDs numéricos | ✓ |
| Opcionales enviados como `null` | ✓ |
| `pageSize=100` | ✓ aceptado; `pageSize=500` se recorta a 100 |
| `PATCH /activities/:id {completed}` | ✓ |
| `PATCH /deals/:id/stage` | ✓ |
| Forma de `error.details` | ✓ tras INT-2 |
| `DELETE` | ✓ 204 sin cuerpo |
| Sin token | ✓ 401 |
| `sales` → `/api/users` | ✓ 403 |
