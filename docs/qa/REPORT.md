# NEWCRM — Informe de QA (2026-10-22)

> Contenido redactado por el agente QA. El agente no pudo escribir este archivo (lo bloqueó el control de permisos), así que lo creó el coordinador con autorización del usuario. Las cifras del frontend incluyen el test de regresión que añadió el PM en el cierre (57 → 58).

## Resumen
- **Backend:** 12 ficheros, 226 tests, todos pasan (e2e de QA 162, integración 16, seguridad 48), con Node 22.12 y con Node 24.20.
- **Frontend:** 6 ficheros, 58 tests, todos pasan (QA 31, unitarios 27).
- **Raíz:** `npm test` y `npm run build` pasan.
- **Humo con el servidor real:** 24 de 24, contra el backend directo y a través del proxy de Vite.

## Cobertura del plan
Todos los casos de [TEST_PLAN.md](TEST_PLAN.md) tienen un test automático o una comprobación de humo.

| Bloque | Casos |
|---|---|
| Health | 2 |
| Auth | 13 |
| Users | 10 |
| CRUD genérico (16 casos × 4 entidades) | 64 |
| Específicos de contactos, deals y actividades | 15 |
| Dashboard | 4 |
| Casos límite | 14 |
| Pantallas del frontend | 14 |
| Humo | 7 |

## Bugs
Detalle en [BUGS.md](BUGS.md). 3 encontrados; ninguno crítico ni alto abierto.

| ID | Severidad | Estado |
|---|---|---|
| BUG-001 | Media | Resuelto por QA (web de empresa sin `https://`) |
| BUG-002 | Media (entorno) | Mitigado en el proyecto; falta reparar Node/npm en la máquina |
| BUG-003 | Baja | Abierto (Dashboard ante un `stats` malformado) |

## Comportamiento comprobado
- El primer usuario registrado es admin. El registro ignora el campo `role` y `passwordHash` no aparece en ninguna respuesta.
- Un usuario `sales` no puede ver, editar, borrar ni cambiar de etapa registros de otro (404), ni vincular registros ajenos (422).
- Los errores siguen el formato del contrato, también con JSON mal formado.
- La paginación limita `pageSize` a 100. La búsqueda escapa los comodines y el orden sólo acepta campos de una lista permitida.
- Los filtros del contrato funcionan en contactos, deals y actividades.
- El cambio de etapa de un deal recorre las 6 etapas.
- Los valores del dashboard son correctos y se filtran por propietario.
- Las pantallas del frontend funcionan con la API simulada: login, registro, sesión, logout automático en 401, ruta protegida, KPIs, CRUD, kanban (con vuelta atrás si falla) y actividades.

## Casos límite sin fallos
En `backend/tests/e2e/edge.test.ts`: ids no numéricos, PATCH vacío, campos extra, vincular registros de otro usuario, borrar una empresa con contactos, borrar usuarios con registros, que el admin se borre a sí mismo, token de un usuario borrado, strings muy largas, XSS almacenado como texto, comodines e inyección SQL en `search`/`sort`, decimales y moneda, fechas inválidas.
