import type { Metrics, PipelineOverview } from '../api/types';

/** Configuración de ventas por defecto, como la devuelve GET /api/pipeline. */
export const pipelineOverview: PipelineOverview = {
  stages: [
    { id: 1, key: 'lead', name: 'Lead', position: 1, probability: 10, kind: 'open', color: '#868e96' },
    { id: 2, key: 'qualified', name: 'Calificado', position: 2, probability: 25, kind: 'open', color: '#1c7ed6' },
    { id: 3, key: 'proposal', name: 'Propuesta', position: 3, probability: 50, kind: 'open', color: '#7048e8' },
    { id: 4, key: 'negotiation', name: 'Negociación', position: 4, probability: 75, kind: 'open', color: '#f08c00' },
    { id: 5, key: 'won', name: 'Ganado', position: 5, probability: 100, kind: 'won', color: '#2f9e44' },
    { id: 6, key: 'lost', name: 'Perdido', position: 6, probability: 0, kind: 'lost', color: '#e03131' },
  ],
  leadSources: [
    { id: 1, kind: 'lead_source', name: 'Web', position: 1, archived: false },
    { id: 2, kind: 'lead_source', name: 'Recomendación', position: 2, archived: false },
  ],
  lossReasons: [
    { id: 11, kind: 'loss_reason', name: 'Precio', position: 1, archived: false },
    { id: 12, kind: 'loss_reason', name: 'Sin presupuesto', position: 2, archived: false },
  ],
};

const months = ['2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];

/** Métricas de ejemplo (mismos números que el escenario de los tests del servidor). */
export const sampleMetrics: Metrics = {
  period: '90d',
  from: '2026-07-24T00:00:00.000Z',
  generatedAt: '2026-10-22T12:00:00.000Z',
  summary: {
    wonCount: 2,
    wonValue: 4000,
    lostCount: 2,
    lostValue: 2500,
    winRate: 50,
    avgDealSize: 2000,
    avgCycleDays: 20,
    openCount: 3,
    openValue: 7000,
    weightedForecast: 3600,
    stalledCount: 1,
    overdueActivities: 1,
  },
  salesByMonth: months.map((month) => ({ month, wonCount: month === '2026-10' ? 2 : 0, wonValue: month === '2026-10' ? 4000 : 0, lostCount: month === '2026-10' ? 2 : 0 })),
  forecast: {
    weighted: 3600,
    expectedThisMonth: 1500,
    overdueExpected: 1,
    byStage: [
      { stage: 'lead', name: 'Lead', probability: 10, count: 1, value: 1000, weighted: 100 },
      { stage: 'qualified', name: 'Calificado', probability: 25, count: 0, value: 0, weighted: 0 },
      { stage: 'proposal', name: 'Propuesta', probability: 50, count: 1, value: 4000, weighted: 2000 },
      { stage: 'negotiation', name: 'Negociación', probability: 75, count: 1, value: 2000, weighted: 1500 },
    ],
  },
  funnel: [
    { stage: 'lead', name: 'Lead', kind: 'open', reached: 7, conversionFromPrev: null, avgDaysInStage: 5 },
    { stage: 'qualified', name: 'Calificado', kind: 'open', reached: 5, conversionFromPrev: 71.4, avgDaysInStage: 9.5 },
    { stage: 'proposal', name: 'Propuesta', kind: 'open', reached: 4, conversionFromPrev: 80, avgDaysInStage: 7.5 },
    { stage: 'negotiation', name: 'Negociación', kind: 'open', reached: 3, conversionFromPrev: 75, avgDaysInStage: null },
    { stage: 'won', name: 'Ganado', kind: 'won', reached: 2, conversionFromPrev: 66.7, avgDaysInStage: null },
  ],
  bySource: [
    { sourceId: null, name: 'Sin origen', deals: 4, won: 0, lost: 1, wonValue: 0, winRate: 0 },
    { sourceId: 1, name: 'Web', deals: 2, won: 1, lost: 1, wonValue: 1000, winRate: 50 },
    { sourceId: 2, name: 'Recomendación', deals: 1, won: 1, lost: 0, wonValue: 3000, winRate: 100 },
  ],
  lostReasons: [
    { reasonId: 11, name: 'Precio', count: 1, value: 2000 },
    { reasonId: null, name: 'Sin motivo', count: 1, value: 500 },
  ],
  activities: { completed: 1, overdue: 1, completedByType: [{ type: 'call', count: 1 }] },
  stalled: [{ id: 9, title: 'Trato olvidado', value: 1000, stage: 'lead', days: 60 }],
  byOwner: [
    { ownerId: 2, name: 'Sergio Sales', openCount: 3, openValue: 7000, weighted: 3600, wonCount: 2, wonValue: 4000, lostCount: 2, winRate: 50, activitiesCompleted: 1 },
    { ownerId: 3, name: 'Lucía Ventas', openCount: 0, openValue: 0, weighted: 0, wonCount: 1, wonValue: 9999, lostCount: 0, winRate: 100, activitiesCompleted: 0 },
  ],
};
