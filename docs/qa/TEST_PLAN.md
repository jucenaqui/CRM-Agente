# NEWCRM — Plan de pruebas (QA)

Base: `docs/CONTRACT.md`. IDs de caso usados en los tests (`describe`/`it` llevan el ID entre corchetes).

Convenciones:
- Formato de error esperado: `{ error: { code: string, message: string, details?: any } }`.
- Listas: `{ data, total, page, pageSize }`.
- `user` nunca expone `passwordHash`.
- Usuarios de prueba: `admin` (primer registro), `sales1`, `sales2` (registrados después → rol `sales`).

## 1. API

### 1.1 Health
| ID | Caso | Esperado |
|---|---|---|
| H-01 | GET /api/health sin token | 200 `{status:"ok"}` |
| H-02 | Ruta inexistente `/api/nope` | 404 con formato de error |

### 1.2 Auth
| ID | Caso | Esperado |
|---|---|---|
| A-01 | Register primer usuario | 201/200, `{token,user}`, role `admin`, sin `passwordHash` |
| A-02 | Register segundo usuario | role `sales` |
| A-03 | Register email duplicado | 409 |
| A-04 | Register sin campos / email inválido / password corta | 400 o 422, formato error |
| A-05 | Login correcto | 200 `{token,user}` |
| A-06 | Login password incorrecta | 401 |
| A-07 | Login email inexistente | 401 |
| A-08 | Login body inválido | 400/422 |
| A-09 | GET /me con token | 200 user correcto, sin `passwordHash` |
| A-10 | GET /me sin token | 401 formato error |
| A-11 | GET /me token mal formado / firmado con otro secreto | 401 |
| A-12 | Register no permite autoasignarse `role: admin` | role `sales` |

### 1.3 Users (admin)
| ID | Caso | Esperado |
|---|---|---|
| U-01 | admin lista usuarios | 200 lista paginada, sin `passwordHash` |
| U-02 | sales lista usuarios | 403 |
| U-03 | admin crea usuario (rol sales/admin) | 201 |
| U-04 | admin crea usuario email duplicado | 409 |
| U-05 | admin crea usuario inválido | 400/422 |
| U-06 | admin PATCH usuario (name/role) | 200 |
| U-07 | sales PATCH/DELETE usuario | 403 |
| U-08 | admin PATCH/DELETE id inexistente | 404 |
| U-09 | admin DELETE usuario | 200/204; luego no aparece |
| U-10 | sin token | 401 |

### 1.4 Companies / Contacts / Deals / Activities (CRUD genérico, por entidad)
| ID | Caso | Esperado |
|---|---|---|
| C-01 | POST válido | 201, devuelve entidad con `id`, `ownerId` = usuario, `createdAt` ISO |
| C-02 | POST inválido (falta campo requerido / tipo malo) | 400/422 formato error |
| C-03 | GET lista | 200 `{data,total,page,pageSize}` |
| C-04 | GET :id existente | 200 |
| C-05 | GET :id inexistente | 404 |
| C-06 | PATCH parcial | 200, cambia solo el campo, `updatedAt` presente |
| C-07 | PATCH inválido | 400/422 |
| C-08 | DELETE | 200/204; luego GET → 404 |
| C-09 | Sin token | 401 |
| C-10 | Paginación `page=2&pageSize=2` | `data.length<=2`, `page=2`, `pageSize=2`, `total` correcto |
| C-11 | `search` | filtra por nombre/título/subject |
| C-12 | `sort`/`order` | orden asc/desc correcto |
| C-13 | sales no ve registros de otro sales (lista) | no aparecen |
| C-14 | sales GET/PATCH/DELETE registro ajeno | 403 o 404 (nunca 200) |
| C-15 | admin ve/edita registros de todos | 200 |
| C-16 | pageSize grande / page fuera de rango | 200, data vacía o acotada, no 500 |

Específicos:
| ID | Caso | Esperado |
|---|---|---|
| CT-01 | contacts `?companyId=` | solo contactos de esa empresa |
| CT-02 | contacto con `companyId` inexistente | 400/404/422 (no 500) |
| D-01 | deal sin currency | `currency = "USD"` |
| D-02 | deal stage inválido | 400/422 |
| D-03 | deals `?stage=` / `?companyId=` / `?contactId=` | filtran |
| D-04 | PATCH /deals/:id/stage válido | 200 stage actualizado |
| D-05 | PATCH stage inválido | 400/422 |
| D-06 | PATCH stage deal inexistente | 404 |
| D-07 | PATCH stage deal ajeno (sales) | 403/404 |
| D-08 | value negativo o no numérico | 400/422 |
| AC-01 | activity type inválido | 400/422 |
| AC-02 | `completed` por defecto false | false |
| AC-03 | `?completed=true/false`, `?contactId=`, `?dealId=` | filtran |
| AC-04 | PATCH completed=true | 200, completed true |

### 1.5 Dashboard
| ID | Caso | Esperado |
|---|---|---|
| DB-01 | GET stats estructura | `totals{companies,contacts,deals,openDealsValue,wonDealsValue}`, `dealsByStage[]`, `upcomingActivities[]` |
| DB-02 | Valores: openDealsValue excluye won/lost; wonDealsValue suma won | correctos |
| DB-03 | sales ve solo sus totales; admin ve todo | correctos |
| DB-04 | sin token | 401 |

### 1.6 Formato de error
| ID | Caso | Esperado |
|---|---|---|
| E-01 | Todos los 4xx devuelven `error.code` y `error.message` strings | sí |
| E-02 | JSON mal formado en body | 400 formato error (no 500) |

## 2. Frontend (Testing Library, fetch mockeado)
| ID | Pantalla | Caso | Esperado |
|---|---|---|---|
| F-01 | Login | render campos email/password + botón | visibles |
| F-02 | Login | submit correcto | POST /api/auth/login, guarda token en localStorage, navega a dashboard |
| F-03 | Login | credenciales malas | muestra mensaje de error |
| F-04 | Registro | submit | POST /api/auth/register |
| F-05 | Ruta protegida | sin token → redirige a login | sí |
| F-06 | Dashboard | muestra KPIs de /api/dashboard/stats | números visibles |
| F-07 | Empresas | lista desde /api/companies | nombres visibles |
| F-08 | Contactos | lista | nombres visibles |
| F-09 | Deals | lista/kanban con columnas por etapa | etapas visibles |
| F-10 | Actividades | lista, marcar completada → PATCH | se llama PATCH |
| F-11 | Usuarios | solo admin (sales no ve menú/página) | sí |
| F-12 | Logout | limpia token | sí |

## 3. Humo (servidor real)
S-01 health → S-02 register admin → S-03 login → S-04 me → S-05 CRUD company → contact → deal (+stage) → activity (+completar) → S-06 dashboard → S-07 borrar todo. `npm run build` del frontend sin errores.
