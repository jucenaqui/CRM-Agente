# NEWCRM — Product Requirements Document

## 1. Visión
NEWCRM es un CRM ligero, auto-alojable y sin dependencias externas (SQLite) para equipos comerciales pequeños (2–20 personas). Permite gestionar empresas, contactos, oportunidades (deals) en un embudo kanban y actividades de seguimiento, con un dashboard que resume el estado comercial. Objetivo: arrancar en local con `npm install && npm run dev` en menos de 5 minutos.

### Objetivos medibles
- Instalación y arranque en un solo comando desde la raíz.
- Flujo completo login → CRUD de las 4 entidades → dashboard sin errores.
- `npm test` en verde (backend + frontend).
- Cero hallazgos de seguridad críticos/altos abiertos al release.

## 2. Personas
| Persona | Rol | Necesidades |
|---|---|---|
| **Ana, Directora comercial** | `admin` | Ver todo el pipeline del equipo, KPIs (valor abierto/ganado), dar de alta y baja usuarios, reasignar registros. |
| **Luis, Ejecutivo de ventas** | `sales` | Registrar rápidamente empresas, contactos y deals propios; mover deals por etapas; ver sus tareas pendientes. No debe ver datos de otros vendedores. |
| **Equipo técnico / instalador** | — | Instalación sencilla, variables de entorno claras, datos de ejemplo (seed). |

## 3. Historias de usuario y criterios de aceptación

### 3.1 Autenticación (AUTH)
- **AUTH-1** Como visitante quiero registrarme con nombre, email y contraseña para usar el CRM.
  - AC: `POST /api/auth/register` con `{name,email,password}` devuelve `{token,user}` (201). Email duplicado → 409. Datos inválidos → 400/422 con formato de error del contrato.
  - AC: el primer usuario registrado obtiene rol `admin`; los siguientes `sales`.
  - AC: la contraseña se guarda con bcrypt; `user` nunca incluye `passwordHash`.
- **AUTH-2** Como usuario quiero iniciar sesión con email y contraseña.
  - AC: credenciales correctas → `{token,user}`; incorrectas → 401 con mensaje genérico (no revela si el email existe).
  - AC: intentos repetidos están limitados (429).
- **AUTH-3** Como usuario autenticado quiero que mi sesión persista al recargar.
  - AC: token guardado en memoria + localStorage; `GET /api/auth/me` devuelve el usuario; token inválido/expirado → 401 y el frontend redirige a Login.
- **AUTH-4** Como usuario quiero cerrar sesión.
  - AC: se borra el token y se redirige a Login; las rutas protegidas no son accesibles.

### 3.2 Usuarios (USR) — sólo admin
- **USR-1** Como admin quiero listar usuarios con paginación y búsqueda.
  - AC: `GET /api/users` → `{data,total,page,pageSize}`; un `sales` recibe 403.
- **USR-2** Como admin quiero crear usuarios indicando rol.
  - AC: `POST /api/users` `{name,email,password,role}`; email duplicado → 409.
- **USR-3** Como admin quiero editar (nombre, email, rol, contraseña) y eliminar usuarios.
  - AC: `PATCH/DELETE /api/users/:id`; 404 si no existe; el admin no puede eliminarse a sí mismo.
- AC UI: la entrada "Usuarios" del sidebar sólo es visible para admin; acceso directo por URL de un `sales` muestra acceso denegado o redirige.

### 3.3 Empresas (COMP)
- **COMP-1** Como usuario quiero listar empresas con búsqueda, orden y paginación.
  - AC: `GET /api/companies?page&pageSize&search&sort&order`; `sales` sólo ve las suyas (`ownerId`), admin todas.
- **COMP-2** Como usuario quiero crear una empresa (name obligatorio; industry, website, phone, address opcionales).
  - AC: `POST` → 201 con la entidad; `ownerId` = usuario actual; validación zod → 400/422.
- **COMP-3** Como usuario quiero ver el detalle de una empresa, editarla y eliminarla.
  - AC: `GET/PATCH/DELETE /api/companies/:id`; registro ajeno para `sales` → 404/403; `updatedAt` se actualiza.
  - AC UI: el detalle muestra contactos y deals asociados.

### 3.4 Contactos (CONT)
- **CONT-1** Como usuario quiero listar contactos y filtrarlos por empresa.
  - AC: `GET /api/contacts?companyId=`; búsqueda por nombre/apellido/email.
- **CONT-2** Como usuario quiero crear/editar un contacto (firstName, lastName obligatorios; email, phone, position, companyId opcionales).
  - AC: `companyId` debe existir y ser accesible por el usuario.
- **CONT-3** Como usuario quiero ver el detalle de un contacto con sus actividades.
  - AC UI: detalle lista actividades (`GET /api/activities?contactId=`) y permite crear una nueva.
- **CONT-4** Como usuario quiero eliminar un contacto.
  - AC: `DELETE` → 204/200; deals/actividades relacionados no rompen (FK a null o borrado en cascada documentado).

### 3.5 Deals (DEAL)
- **DEAL-1** Como usuario quiero listar deals filtrando por etapa, empresa o contacto.
  - AC: `GET /api/deals?stage=&companyId=&contactId=`.
- **DEAL-2** Como usuario quiero crear/editar un deal (title, value obligatorios; currency default `USD`; stage default `lead`; contactId, companyId, expectedCloseDate opcionales).
  - AC: `stage` ∈ {lead, qualified, proposal, negotiation, won, lost}; `value` ≥ 0.
- **DEAL-3** Como usuario quiero ver un kanban por etapa y mover deals (drag&drop o botones).
  - AC: `PATCH /api/deals/:id/stage` `{stage}`; la UI refleja el cambio sin recargar; etapa inválida → 400/422.
- **DEAL-4** Como usuario quiero eliminar un deal.

### 3.6 Actividades (ACT)
- **ACT-1** Como usuario quiero listar actividades filtrando por contacto, deal o estado.
  - AC: `GET /api/activities?contactId=&dealId=&completed=true|false`.
- **ACT-2** Como usuario quiero crear actividades (type ∈ call/email/meeting/task/note, subject obligatorio, description, dueDate, contactId, dealId opcionales).
- **ACT-3** Como usuario quiero marcar una actividad como completada.
  - AC: `PATCH /api/activities/:id` `{completed:true}`; la lista se actualiza.
- **ACT-4** Como usuario quiero editar y eliminar actividades.

### 3.7 Dashboard (DASH)
- **DASH-1** Como usuario quiero ver KPIs: nº empresas, contactos, deals, valor de deals abiertos y valor ganado.
  - AC: `GET /api/dashboard/stats` → `{totals:{companies,contacts,deals,openDealsValue,wonDealsValue}, dealsByStage:[{stage,count,value}], upcomingActivities}`; `sales` sólo ve sus datos.
  - AC: "abiertos" = etapas distintas de `won` y `lost`.
- **DASH-2** Como usuario quiero ver el embudo por etapa (las 6 etapas, aunque tengan 0).
- **DASH-3** Como usuario quiero ver mis próximas actividades (no completadas, ordenadas por dueDate asc).

### 3.8 Transversal (NFR)
- **NFR-1** Errores con formato `{error:{code,message,details?}}`.
- **NFR-2** Listas con formato `{data,total,page,pageSize}`; `pageSize` acotado (máx. 100).
- **NFR-3** Seguridad: helmet/cabeceras, CORS restringido a `CORS_ORIGIN`, rate limit en auth, JWT con secreto por entorno, consultas parametrizadas, validación de entrada.
- **NFR-4** `GET /api/health` → `{status:"ok"}` sin auth.
- **NFR-5** Seed con usuario `admin@crm.local` / `Admin123!` y datos de ejemplo.
- **NFR-6** UI responsive básica, layout con sidebar, estados de carga y error.

## 4. Fuera de alcance (v1)
- Multi-tenant / varias organizaciones.
- Recuperación de contraseña por email, 2FA, SSO/OAuth.
- Envío real de emails, integración con calendario o telefonía.
- Importación/exportación CSV, adjuntos de ficheros.
- Notificaciones en tiempo real (websockets), app móvil.
- Multi-moneda con conversión (sólo se guarda `currency`).
- Informes avanzados / forecasting, campos personalizados, auditoría completa.
- Despliegue en producción (Docker, CI/CD) — sólo ejecución local.
