# Cómo funciona el CRM: elementos, embudo y métricas

Un CRM sirve para responder tres preguntas: **¿a quién le vendo?**, **¿en qué punto está cada venta?** y **¿qué tengo que hacer hoy?** Todo lo demás son campos y pantallas para contestarlas y para medir si vas bien.

## Los elementos y cómo se relacionan

| Elemento | Qué es | Campos principales |
|---|---|---|
| **Empresa** | La organización a la que vendes | nombre, sector, web, teléfono, dirección |
| **Contacto** | Una persona (normalmente de una empresa) | nombre, apellidos, email, teléfono, cargo, empresa |
| **Deal** (oportunidad) | Una posible venta, con dinero y una etapa | título, importe, moneda, etapa, cierre previsto, **origen**, **motivo de pérdida**, **cierre real**, contacto, empresa |
| **Actividad** | Algo que haces o debes hacer | tipo (llamada, email, reunión, tarea, nota), asunto, descripción, vencimiento, completada, **fecha de completada**, contacto, deal |
| **Usuario** | Quien vende | nombre, email, rol (administrador o ventas) |

Una **Empresa** tiene varios **Contactos** y varios **Deals**; cada **Deal** acumula **Actividades**. Separar personas, dinero y tareas permite medir cada venta por separado aunque la empresa compre varias veces. Cada registro tiene un propietario (el vendedor responsable); un vendedor solo ve lo suyo y el administrador ve todo.

Otros CRMs lo llaman distinto (Salesforce: Cuentas y Oportunidades; HubSpot: Empresas y Deals; Pipedrive: Organizaciones y Deals), pero el núcleo es el mismo.

## El embudo (las etapas)

Es el camino que recorre una venta. **Por defecto**, para cualquier tipo de negocio:

| Etapa | Qué significa | Tipo | Probabilidad |
|---|---|---|---|
| Lead | Alguien mostró interés; aún no sabes si encaja | abierta | 10 % |
| Calificado | Confirmaste necesidad, presupuesto y quién decide | abierta | 25 % |
| Propuesta | Enviaste una cotización | abierta | 50 % |
| Negociación | Discuten precio y condiciones | abierta | 75 % |
| Ganado | Se vendió | ganada | 100 % |
| Perdido | No se vendió | perdida | 0 % |

**Cada cliente puede adaptarlo** en *Ajustes → Embudo de ventas* (solo administradores): renombrar, reordenar, añadir y eliminar etapas, cambiar su color y su probabilidad de cierre.

Reglas, para que las métricas sigan teniendo sentido:
- Cada etapa es de un **tipo**: *abierta* (la venta sigue viva), *ganada* o *perdida*. Siempre debe haber al menos una de cada tipo.
- Las abiertas van **antes** que las ganadas y perdidas.
- Eliminar una etapa que tiene deals obliga a elegir a qué etapa se mueven (queda registrado en su historial).
- Renombrar una etapa no rompe nada: internamente cada etapa tiene una clave fija que no cambia.
- Un deal nuevo empieza en la primera etapa abierta.

Los **orígenes de lead** (Web, Recomendación, Redes sociales, Llamada en frío, Evento, Publicidad, Otro) y los **motivos de pérdida** (Precio, Eligió a la competencia, Sin presupuesto, Sin respuesta, No era el momento, Otro) también son listas editables en Ajustes. Si eliminas uno que ya usan deals, se **archiva**: deja de ofrecerse, pero los deals antiguos y los informes conservan su nombre.

## Datos que el CRM registra solo

| Dato | Cómo se obtiene |
|---|---|
| **Cierre real** del deal | Se pone al entrar en una etapa ganada o perdida; se borra si el deal se reabre. Pasar de ganado a perdido cuenta como un cierre nuevo. No se edita a mano. |
| **Historial de etapas** | Cada cambio de etapa guarda de dónde a dónde y cuándo. Alimenta la conversión y los días por etapa. |
| **Fecha de completada** de una actividad | Al marcarla como hecha; se borra si se desmarca. |

## Las métricas (Dashboard → Métricas de ventas)

Se calculan sobre un **periodo** (30 días, 90 días, 12 meses o todo). Un vendedor ve las suyas; el administrador ve todo el equipo y puede mirar a una persona.

| Métrica | Cómo se calcula |
|---|---|
| **Ventas ganadas** | Suma del importe de los deals que se **cerraron como ganados** en el periodo |
| **Tasa de conversión** | Ganados ÷ (ganados + perdidos), entre los deals cerrados en el periodo |
| **Ticket medio** | Importe de los ganados ÷ número de ganados |
| **Ciclo de venta** | Media de días entre la creación de un deal y su cierre como ganado |
| **Pronóstico** | Σ importe de cada deal abierto × probabilidad de su etapa. Aparte: lo esperado este mes (por fecha de cierre prevista) y cuántos deals tienen esa fecha ya vencida |
| **Ventas por mes** | Ganado por mes de cierre, últimos 12 meses |
| **Embudo y conversión** | De los deals **creados** en el periodo, cuántos llegaron a cada etapa (saltarse una etapa cuenta como haberla pasado), el % que avanza a la siguiente y los **días medios** que pasan en cada etapa |
| **Por origen** | Deals creados en el periodo, agrupados por origen: cuántos, ganados, conversión e importe vendido |
| **Por qué se pierden** | Deals perdidos en el periodo, agrupados por motivo (los que no tienen motivo aparecen como «Sin motivo») |
| **Deals estancados** | Abiertos sin cambiar de etapa desde hace **30 días o más** |
| **Actividad realizada** | Actividades completadas en el periodo, por tipo; y cuántas pendientes están vencidas |
| **Por vendedor** (admin) | Pipeline, ganado, conversión y actividades de cada persona |

### Limitaciones a tener en cuenta
- **Monedas:** los importes se suman tal cual; si hay deals en monedas distintas, los totales las mezclan (no hay conversión).
- **Datos anteriores a esta versión:** los deals ya existentes tienen como historial solo su etapa actual, y su cierre real se estimó con su última modificación. Las métricas de embudo, días por etapa y ciclo serán más fiables a medida que se acumule historial nuevo.
- **Estancado = 30 días** es un valor fijo por ahora.

## Con el asistente IA

El asistente conoce el embudo del cliente (`get_pipeline`): usa los nombres de las etapas, orígenes y motivos que el cliente definió, y al marcar un deal como perdido pregunta el motivo si no se lo dijeron. Para preguntas como «¿cómo voy este trimestre?» usa `get_metrics`. Mover un deal de etapa, como cualquier modificación, pide tu confirmación mostrando qué cambia. Lo mismo ocurre por MCP: las herramientas son las mismas.
