# NEWCRM — Registro de bugs (QA)

Severidad: Crítica / Alta / Media / Baja. Estado: OPEN / FIXED / MITIGATED / WONTFIX.

| ID | Sev. | Área | Título | Estado |
|---|---|---|---|---|
| BUG-001 | Media | Frontend | Un `website` de empresa sin `http(s)://` da 400 en el backend | FIXED (QA) |
| BUG-002 | Media (entorno) | Entorno / backend | El Node del sistema pasó a ser 24.20 y el npm global estaba roto | FIXED (2026-10-22: Node 22.12 / npm 10.9 reinstalados; install, ls, audit y run funcionan) |
| BUG-003 | Baja | Frontend | El Dashboard lanza un TypeError si `/dashboard/stats` responde algo que no cumple el contrato | FIXED (2026-10-22) |

---

## BUG-001: un `website` sin esquema se rechaza al guardar una empresa
- **Severidad:** Media (el usuario no puede guardar la empresa y no ve claro por qué). Es la misma incidencia que INT-1 de `docs/INTEGRATION_ISSUES.md`.
- **Pasos:** Empresas → "+ Nueva empresa" → Nombre `Acme`, Sitio web `acme.com` → Guardar.
- **Esperado:** se guarda. La validación del cliente acepta `acme.com`, así que el valor que se envía debe ser `https://acme.com`.
- **Obtenido:** el frontend envía `website: "acme.com"`. El backend (`optUrl`, que exige `http:`/`https:`) responde 400 `VALIDATION_ERROR`.
- **Test:** `frontend/tests/qa/screens.qa.test.tsx` → `[F-07][BUG-001]`. Fallaba antes del arreglo y ahora pasa.
- **Arreglo (QA, después de que Frontend reportara DONE):** `frontend/src/components/forms/CompanyForm.tsx` tiene un nuevo helper `normalizeUrl()` y el payload usa `website: normalizeUrl(f.website)`. No hay más cambios.
- **Estado:** FIXED.

## BUG-002: Node 24 y npm roto en la máquina
- **Severidad:** Media. El código no tiene el fallo, pero bloquea `npm install`, `npm test` y `npm run dev` en esta máquina.
- **Pasos:** `node -v` → `v24.20.0`, aunque nvm apunta a `v22.12.0`. `npm -v` / `npm test` → `npm error Class extends value undefined is not a constructor or null`.
- **Causa:** un instalador de Node 24 sobrescribió `C:\Users\HP\AppData\Roaming\nvm\v22.12.0` a través del symlink `C:\Program Files\nodejs`. Hay `node.exe` 24.20 y npm 11.19 con dependencias mezcladas (`minipass-flush`). El binario de `better-sqlite3@11.10.0` está compilado para ABI 127 (Node 22), y Node 24 exige 137.
- **Obtenido (QA, antes de la mitigación):** con Node 24 todos los e2e daban 500 (`NODE_MODULE_VERSION 127 ... requires 137`).
- **Mitigación (Backend):** `src/sqlite.ts` vuelve automáticamente a `node:sqlite` cuando el binario nativo no carga. QA lo ha verificado y los 226 tests del backend pasan tanto con Node 24.20 (driver `node:sqlite`) como con Node 22.12 (driver `better-sqlite3`).
- **Pendiente (entorno, fuera del proyecto):** reparar Node/npm con `nvm uninstall 22.12.0 && nvm install 22.12.0 && nvm use 22.12.0`, o desinstalar el MSI de Node 24. Mientras tanto se puede usar Node 22.12 portable (zip oficial de nodejs.org, comprobado con SHA256). Así ejecutó QA `npm test` y `npm run build` en la raíz.
- **Precisión (2026-10-22, coordinador):** con el npm 11.19 del sistema, `npm --version`, `npm run build` y `npm test` sí funcionan; fallan los comandos que usan la caché de paquetes (`npm install`, `npm ls`, `npm audit`) porque `minipass-flush` no carga (`cacache/lib/content/write.js`).
- **Resuelto (2026-10-22):** se reinstaló Node 22.12.0 con npm 10.9.0 en la máquina; `npm install`, `npm ls`, `npm audit` y `npm run` funcionan. El fallback a `node:sqlite` del backend se mantiene por si se vuelve a Node 24.
- **Estado:** FIXED.

## BUG-003: el Dashboard no tolera un `stats` malformado
- **Severidad:** Baja. Sólo pasa si el backend incumple el contrato, por ejemplo con un proxy mal configurado que devuelve otra cosa.
- **Pasos:** se mockea `GET /api/dashboard/stats` con `{data:[],total:0,...}`.
- **Esperado:** un estado de error.
- **Obtenido:** `TypeError: Cannot read properties of undefined (reading 'companies')` en `DashboardPage` y la página se queda en blanco (no hay error boundary).
- **Sugerencia:** comprobar `data?.totals` o añadir un ErrorBoundary global.
- **Arreglo (2026-10-22):** `dashboardApi.stats` valida la forma de la respuesta (`parseStats`) y, si no cumple el contrato, falla con «El servidor devolvió el resumen en un formato inesperado…», que la página muestra con el botón Reintentar. Además hay un `ErrorBoundary` global (por pantalla, que se reinicia al cambiar de ruta, y otro en la raíz) para que cualquier fallo de dibujado muestre un aviso con «Reintentar» y «Recargar» en lugar de una página en blanco. Tests en `frontend/src/pages/DashboardPage.test.tsx`.
- **Estado:** FIXED.

---

## Exploración que no encontró bugs
Casos límite revisados en `backend/tests/e2e/edge.test.ts` sin incidencias: ids no numéricos, PATCH vacío, campos extra (`strictObject` → 400), vincular registros de otro usuario (422/404), borrar una empresa con contactos (`companyId → null`), borrar un usuario con registros, que el admin se borre a sí mismo, el token de un usuario borrado (401), strings muy largas, XSS almacenado como texto plano, comodines e inyección SQL en `search`/`sort`, decimales y moneda, fechas inválidas.
