# Documentación de NEWCRM

Estado: **v1.0.0 terminada** (2026-10-22). Resumen y pendientes en [RELEASE_NOTES.md](RELEASE_NOTES.md).

## Por dónde empezar
1. [RELEASE_NOTES.md](RELEASE_NOTES.md): qué incluye la versión, cómo se verificó y qué queda pendiente.
2. [../README.md](../README.md): instalación, arranque, variables de entorno y credenciales de ejemplo.
3. [CONTRACT.md](CONTRACT.md): contrato de API y dominio que siguieron todos los agentes.

## Producto y planificación (PM)
| Documento | Contenido |
|---|---|
| [PRD.md](PRD.md) | Visión, personas, historias de usuario y criterios de aceptación |
| [BACKLOG.md](BACKLOG.md) | Tareas por agente y pendientes post-release |
| [CHANGELOG_CONTRACT.md](CHANGELOG_CONTRACT.md) | Desviaciones respecto al contrato original |
| [INTEGRATION_ISSUES.md](INTEGRATION_ISSUES.md) | Problemas de integración backend ↔ frontend y su corrección |

## Seguridad
| Documento | Contenido |
|---|---|
| [security/THREAT_MODEL.md](security/THREAT_MODEL.md) | Modelo de amenazas (STRIDE) |
| [security/FINDINGS.md](security/FINDINGS.md) | Hallazgos por severidad y estado |

## Calidad (QA)
| Documento | Contenido |
|---|---|
| [qa/TEST_PLAN.md](qa/TEST_PLAN.md) | Casos de prueba por endpoint y pantalla |
| [qa/BUGS.md](qa/BUGS.md) | Bugs encontrados y su estado |
| [qa/REPORT.md](qa/REPORT.md) | Informe final de QA: resultados, cobertura y bugs |

## Informes de cierre de cada agente
Registro histórico de lo que entregó cada agente; no se actualizan. Varios mencionan el npm dañado de la máquina (ver BUG-002 en [qa/BUGS.md](qa/BUGS.md)).

- [status/backend.md](status/backend.md)
- [status/frontend.md](status/frontend.md)
- [status/security.md](status/security.md)
- [status/qa.md](status/qa.md)
