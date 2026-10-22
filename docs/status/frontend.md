# Estado — Frontend

**Estado:** terminado. `npm run build` y `npm test` pasan en `/frontend` (sin errores de TypeScript).

## Stack
React 18.3 + Vite 5.4 + TypeScript 5.6 (strict) + React Router 6.28. Tests: Vitest 2 + jsdom + Testing Library. CSS propio, sin librerías de UI.

Scripts (`frontend/package.json`): `dev` (puerto 5173, proxy `/api` → `http://localhost:4000`), `build` (`tsc --noEmit && vite build`), `preview`, `test` (`vitest run`), `typecheck`.

## Estructura
- `src/api/` — `types.ts` (tipos del dominio y payloads), `client.ts` (fetch, `ApiError` con el formato de error del contrato, token en memoria + `localStorage` (`newcrm.token`), `Authorization: Bearer`, logout automático en 401 vía `setUnauthorizedHandler`, mensajes por defecto por status, `fieldErrors()` para issues de zod), `endpoints.ts` (auth, users, companies, contacts, deals con `moveStage` → `PATCH /deals/:id/stage`, activities con `setCompleted`, dashboard).
- `src/auth/` — `AuthContext` (login, registro, restaura la sesión con `/auth/me`, logout), `ProtectedRoute` (con `role="admin"` opcional) y `PublicOnlyRoute`.
- `src/components/` — Layout con sidebar (drawer en móvil), Modal accesible (focus trap, Esc), ConfirmDialog propio para todos los borrados, Pagination, campos de formulario con errores accesibles, SearchInput, Toasts, estados de carga, error y vacío, badges y cabeceras ordenables. `forms/` contiene los modales de Empresa, Contacto, Deal, Actividad y Usuario, con validación en cliente y errores de campo del backend.
- `src/pages/` — Login, Registro, Dashboard (KPIs, embudo por etapa con barras CSS, próximas actividades), Empresas (lista y detalle con contactos y deals), Contactos (lista con filtro por empresa y detalle con actividades y deals), Deals (lista con filtro por etapa y Kanban con drag&drop y botones ‹ › con actualización optimista y rollback), Actividades (filtros pendientes/completadas/todas, orden, marcar como completada), Usuarios (sólo admin), 404.
- Listas: búsqueda con debounce de 300 ms, paginación (`pageSize=10`), orden `sort`/`order` y filtros que se pasan al backend.

## Seguridad
- No se usa `dangerouslySetInnerHTML`.
- Los enlaces externos (`website`) pasan por `safeUrl` (sólo http/https) y llevan `rel="noopener noreferrer"`.
- La redirección después del login sólo acepta rutas internas, para evitar un open redirect.
- En 401 se borra el token y la app vuelve a /login. Login y registro no disparan ese logout.

## Tests (`src/**/*.test.ts(x)`): 26 propios
- `api/client.test.ts`: query string, header Authorization, persistencia del token, formato de error, error de red, 401 → logout, 204, `moveStage`.
- `pages/LoginPage.test.tsx`: validación, error del backend, login correcto que guarda el token y navega al dashboard.
- `auth/ProtectedRoute.test.tsx`: redirección sin token, restauración con `/auth/me`, token inválido, sales sin acceso a /users, logout automático en 401, botón Salir.
- `pages/CrudPages.test.tsx`: borrado de una empresa con el modal, validación del formulario, mover etapa en el Kanban (PATCH /stage), completar actividad y reintento en el dashboard.
- `vitest.config` incluye también `tests/**`, así que los tests de QA en `frontend/tests/qa` se ejecutan con `npm test` (ahora mismo pasan los 13).

## Suposiciones y desviaciones del contrato
1. **IDs numéricos** (`number`). Si el backend usa strings (UUID), hay que cambiar los tipos en `src/api/types.ts`; las rutas ya convierten con `Number(...)`.
2. **Campos opcionales** (`industry`, `website`, `email`, `phone`, `description`, `dueDate`, etc.): el frontend envía `null` cuando están vacíos. El backend debería aceptar `null` (zod `.nullable().optional()`).
3. **Selects y Kanban** piden `pageSize=100`. Si el backend pone un tope menor, sólo se cargan los primeros. El Kanban avisa cuando `total > cargados`.
4. **Contraseña:** el frontend exige un mínimo de 8 caracteres en el registro y al crear usuarios. El contrato no lo fija.
5. **Sort:** se envían los campos `name`, `industry`, `createdAt`, `firstName`, `email`, `title`, `value`, `stage`, `expectedCloseDate`, `dueDate`, `updatedAt` y `role`. El backend debería ignorar o validar los que no admita.
6. **Contraseña al editar un usuario:** en `PATCH /users/:id` el campo `password` sólo se envía si se rellena. `role` se envía siempre.
7. **Actividades:** al marcar como completada se hace `PATCH /activities/:id` con `{completed}`. El contrato no define un endpoint específico.
8. **Errores de campo:** `details` se interpreta como un array de issues de zod (`path`, `message`), como `flatten()` (`fieldErrors`) o como un objeto campo→mensaje.
9. **Nombres de empresa y contacto** en las tablas de deals y actividades: se resuelven en el cliente con las listas auxiliares. No se espera que el backend devuelva joins.

## Nota de entorno
En este equipo, `npm` desde Git Bash falla con "Class extends value undefined". Desde PowerShell (npm 11.19) funciona bien. Los comandos se verificaron en PowerShell.
