# Estado — QA

**Estado: DONE.** La suite completa pasa y no queda ningún bug crítico ni alto abierto.

- Backend `npm test`: 12 ficheros y 226 tests ✓ (162 e2e de QA en `backend/tests/e2e`, 16 de integración y 48 de seguridad). Verificado con Node 22.12 (`better-sqlite3`) y con Node 24.20 (fallback a `node:sqlite`).
- Frontend `npm test`: 6 ficheros y 57 tests ✓ (31 de QA en `frontend/tests/qa`, 26 unitarios).
- `npm test` y `npm run build` en la raíz ✓ (ejecutados con el npm de Node 22.12 portable).
- Humo con el servidor real: 24/24 ✓, tanto directo como a través del proxy de `vite preview`. Los procesos se detuvieron al terminar.
- Bugs (`docs/qa/BUGS.md`): 3 encontrados.
  - BUG-001 (Media): QA lo arregló en `frontend/src/components/forms/CompanyForm.tsx` (es el INT-1 del PM).
  - BUG-002 (Media, entorno): Backend lo mitigó.
  - BUG-003 (Baja): sigue abierto.
- Plan de pruebas: `docs/qa/TEST_PLAN.md`, con cobertura automática del 100 % de los casos.

## Aviso de entorno
El Node del sistema es 24.20 (se sobrescribió la carpeta nvm v22.12.0) y el npm global está roto. Para repararlo: `nvm uninstall 22.12.0 && nvm install 22.12.0 && nvm use 22.12.0`. Mientras tanto se pueden usar las herramientas directamente: `node node_modules/vitest/vitest.mjs run`.

## Nota
El harness del agente bloqueó la escritura de `docs/qa/REPORT.md`. El contenido del informe se entregó en la respuesta final de QA al coordinador; este fichero y `BUGS.md` contienen el resumen.
