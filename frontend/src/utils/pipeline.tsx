import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { pipelineApi } from '../api/endpoints';
import type { CrmOption, DealStage, Stage, StageKind } from '../api/types';

/**
 * Etapas, orígenes de lead y motivos de pérdida de esta instalación. Los define el cliente
 * (Ajustes → Embudo de ventas); aquí se cargan una vez y todas las pantallas los consultan.
 * Si el servidor no responde se usan los valores por defecto, para que la app no se quede sin etapas.
 */
export const DEFAULT_STAGES: Stage[] = [
  { id: 1, key: 'lead', name: 'Lead', position: 1, probability: 10, kind: 'open', color: '#868e96' },
  { id: 2, key: 'qualified', name: 'Calificado', position: 2, probability: 25, kind: 'open', color: '#1c7ed6' },
  { id: 3, key: 'proposal', name: 'Propuesta', position: 3, probability: 50, kind: 'open', color: '#7048e8' },
  { id: 4, key: 'negotiation', name: 'Negociación', position: 4, probability: 75, kind: 'open', color: '#f08c00' },
  { id: 5, key: 'won', name: 'Ganado', position: 5, probability: 100, kind: 'won', color: '#2f9e44' },
  { id: 6, key: 'lost', name: 'Perdido', position: 6, probability: 0, kind: 'lost', color: '#e03131' },
];

export interface PipelineValue {
  stages: Stage[];
  /** Orígenes de lead y motivos de pérdida que se pueden elegir hoy (no archivados). */
  leadSources: CrmOption[];
  lossReasons: CrmOption[];
  stageName: (key: DealStage) => string;
  stageColor: (key: DealStage) => string;
  stageKind: (key: DealStage) => StageKind | undefined;
  /** Primera etapa abierta: donde empiezan los deals nuevos. */
  defaultStage: DealStage;
  reload: () => Promise<void>;
}

const PipelineContext = createContext<PipelineValue | null>(null);

export function PipelineProvider({ children }: { children: ReactNode }) {
  const [stages, setStages] = useState<Stage[]>(DEFAULT_STAGES);
  const [leadSources, setLeadSources] = useState<CrmOption[]>([]);
  const [lossReasons, setLossReasons] = useState<CrmOption[]>([]);

  const reload = useCallback(async () => {
    try {
      const o = await pipelineApi.overview();
      if (Array.isArray(o.stages) && o.stages.length > 0) setStages(o.stages);
      setLeadSources(Array.isArray(o.leadSources) ? o.leadSources : []);
      setLossReasons(Array.isArray(o.lossReasons) ? o.lossReasons : []);
    } catch {
      /* se mantienen los valores actuales (por defecto la primera vez) */
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const value = useMemo<PipelineValue>(() => {
    const byKey = new Map(stages.map((s) => [s.key, s]));
    return {
      stages,
      leadSources,
      lossReasons,
      stageName: (key) => byKey.get(key)?.name ?? key,
      stageColor: (key) => byKey.get(key)?.color ?? '#868e96',
      stageKind: (key) => byKey.get(key)?.kind,
      defaultStage: (stages.find((s) => s.kind === 'open') ?? stages[0]).key,
      reload,
    };
  }, [stages, leadSources, lossReasons, reload]);

  return <PipelineContext.Provider value={value}>{children}</PipelineContext.Provider>;
}

export function usePipeline(): PipelineValue {
  const ctx = useContext(PipelineContext);
  if (!ctx) {
    // Fuera del proveedor (p. ej. un componente aislado en un test): etapas por defecto, sin recarga.
    return {
      stages: DEFAULT_STAGES,
      leadSources: [],
      lossReasons: [],
      stageName: (k) => DEFAULT_STAGES.find((s) => s.key === k)?.name ?? k,
      stageColor: (k) => DEFAULT_STAGES.find((s) => s.key === k)?.color ?? '#868e96',
      stageKind: (k) => DEFAULT_STAGES.find((s) => s.key === k)?.kind,
      defaultStage: 'lead',
      reload: async () => undefined,
    };
  }
  return ctx;
}
