import { useEffect, useState, type FormEvent } from 'react';
import { pipelineApi } from '../api/endpoints';
import { ApiError, errorMessage } from '../api/client';
import type { CrmOption, OptionKind, Stage, StageKind } from '../api/types';
import { usePipeline } from '../utils/pipeline';
import { Modal } from './Modal';
import { useToast } from './Toast';

const KIND_LABEL: Record<StageKind, string> = { open: 'Abierta', won: 'Ganada', lost: 'Perdida' };

/** Se ejecuta una acción del editor: recarga la configuración y avisa si algo falla (reglas del servidor incluidas). */
function useMutate() {
  const toast = useToast();
  const { reload } = usePipeline();
  return async (action: () => Promise<unknown>, okMessage?: string): Promise<boolean> => {
    try {
      await action();
      await reload();
      if (okMessage) toast.success(okMessage);
      return true;
    } catch (e) {
      toast.error(errorMessage(e));
      await reload(); // vuelve a mostrar lo que hay realmente en el servidor
      return false;
    }
  };
}

function StageRow({ stage, index, count, onMove, onDelete }: { stage: Stage; index: number; count: number; onMove: (dir: -1 | 1) => void; onDelete: () => void }) {
  const mutate = useMutate();
  const [name, setName] = useState(stage.name);
  const [prob, setProb] = useState(String(stage.probability));
  const [color, setColor] = useState(stage.color);

  // Si el servidor cambia el valor (otra pestaña, regla de tipo…), la fila lo refleja.
  useEffect(() => {
    setName(stage.name);
    setProb(String(stage.probability));
    setColor(stage.color);
  }, [stage]);

  const commitName = () => {
    const n = name.trim();
    if (n === stage.name) return;
    if (n === '') return setName(stage.name);
    void mutate(() => pipelineApi.updateStage(stage.id, { name: n }));
  };
  const commitProb = () => {
    const p = Number(prob);
    if (!Number.isInteger(p) || p < 0 || p > 100) return setProb(String(stage.probability));
    if (p !== stage.probability) void mutate(() => pipelineApi.updateStage(stage.id, { probability: p }));
  };
  const commitColor = () => {
    if (color !== stage.color) void mutate(() => pipelineApi.updateStage(stage.id, { color }));
  };

  return (
    <li className="pipeline-row" data-testid={`stage-${stage.key}`}>
      <input type="color" className="pipeline-color" aria-label={`Color de ${stage.name}`} value={color} onChange={(e) => setColor(e.target.value)} onBlur={commitColor} />
      <input className="pipeline-name" aria-label={`Nombre de la etapa ${stage.name}`} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} onBlur={commitName} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
      <select
        aria-label={`Tipo de ${stage.name}`}
        value={stage.kind}
        onChange={(e) => void mutate(() => pipelineApi.updateStage(stage.id, { kind: e.target.value as StageKind }))}
      >
        {(Object.keys(KIND_LABEL) as StageKind[]).map((k) => (
          <option key={k} value={k}>
            {KIND_LABEL[k]}
          </option>
        ))}
      </select>
      {stage.kind === 'open' ? (
        <label className="pipeline-prob">
          <input
            type="number"
            min={0}
            max={100}
            aria-label={`Probabilidad de cierre de ${stage.name}`}
            value={prob}
            onChange={(e) => setProb(e.target.value)}
            onBlur={commitProb}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          />
          <span>%</span>
        </label>
      ) : (
        <span className="pipeline-prob muted">{stage.kind === 'won' ? '100 %' : '0 %'}</span>
      )}
      <span className="pipeline-actions">
        <button type="button" className="icon-btn" aria-label={`Subir ${stage.name}`} disabled={index === 0} onClick={() => onMove(-1)}>
          ↑
        </button>
        <button type="button" className="icon-btn" aria-label={`Bajar ${stage.name}`} disabled={index === count - 1} onClick={() => onMove(1)}>
          ↓
        </button>
        <button type="button" className="btn btn-ghost btn-sm text-danger" onClick={onDelete}>
          Eliminar
        </button>
      </span>
    </li>
  );
}

function DeleteStageDialog({ stage, others, onClose }: { stage: Stage | null; others: Stage[]; onClose: () => void }) {
  const mutate = useMutate();
  const [dealsInStage, setDealsInStage] = useState<number | null>(null);
  const [moveTo, setMoveTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDealsInStage(null);
    setError(null);
    setMoveTo(others[0] ? String(others[0].id) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage?.id]);

  if (!stage) return null;

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      await pipelineApi.deleteStage(stage.id, dealsInStage !== null ? Number(moveTo) : undefined);
      await mutate(async () => undefined, `Etapa «${stage.name}» eliminada`);
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'STAGE_IN_USE') {
        const n = (e.details as { deals?: number } | undefined)?.deals ?? 0;
        setDealsInStage(n); // el servidor pide elegir a qué etapa se mueven esos deals
      } else {
        setError(errorMessage(e));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      size="sm"
      title={`Eliminar «${stage.name}»`}
      onClose={() => !busy && onClose()}
      footer={
        <>
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="btn btn-danger" disabled={busy || (dealsInStage !== null && moveTo === '')} onClick={() => void run()}>
            {dealsInStage !== null ? 'Mover deals y eliminar' : 'Eliminar etapa'}
          </button>
        </>
      }
    >
      {dealsInStage === null ? (
        <p>La etapa desaparecerá del embudo. Si hay deals en ella, te preguntaré a qué etapa moverlos.</p>
      ) : (
        <>
          <p>
            Hay <strong>{dealsInStage}</strong> deal(s) en «{stage.name}». ¿A qué etapa los movemos?
          </p>
          <div className="field">
            <label htmlFor="move-to">Mover a</label>
            <select id="move-to" value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
              {others.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>
        </>
      )}
      {error && <div className="alert alert-error">{error}</div>}
    </Modal>
  );
}

function StagesEditor() {
  const { stages } = usePipeline();
  const mutate = useMutate();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<StageKind>('open');
  const [deleting, setDeleting] = useState<Stage | null>(null);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (await mutate(() => pipelineApi.createStage({ name: name.trim(), kind }), 'Etapa añadida')) setName('');
  };

  const move = (index: number, dir: -1 | 1) => {
    const ids = stages.map((s) => s.id);
    const j = index + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j]!, ids[index]!];
    void mutate(() => pipelineApi.reorderStages(ids));
  };

  return (
    <section className="card" aria-labelledby="stages-title">
      <h2 className="card-title" id="stages-title">
        Embudo de ventas
      </h2>
      <p className="muted">
        Las etapas por las que pasa una venta. Cámbialas para que se parezcan a tu forma de vender: renómbralas, reordénalas, añade o elimina. Las{' '}
        <strong>abiertas</strong> van antes que <strong>Ganado</strong> y <strong>Perdido</strong>, y siempre debe haber al menos una de cada tipo. La
        probabilidad de cierre se usa en el pronóstico.
      </p>
      <ul className="pipeline-list" aria-label="Etapas">
        {stages.map((s, i) => (
          <StageRow key={s.id} stage={s} index={i} count={stages.length} onMove={(d) => move(i, d)} onDelete={() => setDeleting(s)} />
        ))}
      </ul>
      <form onSubmit={add} className="settings-actions" aria-label="Añadir etapa">
        <div className="field">
          <label htmlFor="new-stage">Nueva etapa</label>
          <input id="new-stage" value={name} maxLength={60} placeholder="Demo agendada" onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="new-stage-kind">Tipo</label>
          <select id="new-stage-kind" value={kind} onChange={(e) => setKind(e.target.value as StageKind)}>
            {(Object.keys(KIND_LABEL) as StageKind[]).map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn btn-primary" disabled={!name.trim()}>
          Añadir etapa
        </button>
      </form>
      <DeleteStageDialog stage={deleting} others={stages.filter((s) => s.id !== deleting?.id)} onClose={() => setDeleting(null)} />
    </section>
  );
}

function OptionRow({ option, kind, index, count, onMove }: { option: CrmOption; kind: OptionKind; index: number; count: number; onMove: (d: -1 | 1) => void }) {
  const mutate = useMutate();
  const toast = useToast();
  const { reload } = usePipeline();
  const [name, setName] = useState(option.name);
  useEffect(() => setName(option.name), [option.name]);

  const commit = () => {
    const n = name.trim();
    if (n === option.name) return;
    if (n === '') return setName(option.name);
    void mutate(() => pipelineApi.renameOption(kind, option.id, n));
  };

  const remove = async () => {
    try {
      const r = await pipelineApi.deleteOption(kind, option.id);
      toast.success(r.result === 'archived' ? `«${option.name}» ya se usa en deals: se archivó (no se ofrecerá más, pero los deals y los informes la conservan)` : `«${option.name}» eliminada`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
    await reload();
  };

  return (
    <li className="pipeline-row option-row">
      <input className="pipeline-name" aria-label={`Nombre de ${option.name}`} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
      <span className="pipeline-actions">
        <button type="button" className="icon-btn" aria-label={`Subir ${option.name}`} disabled={index === 0} onClick={() => onMove(-1)}>
          ↑
        </button>
        <button type="button" className="icon-btn" aria-label={`Bajar ${option.name}`} disabled={index === count - 1} onClick={() => onMove(1)}>
          ↓
        </button>
        <button type="button" className="btn btn-ghost btn-sm text-danger" onClick={() => void remove()}>
          Eliminar
        </button>
      </span>
    </li>
  );
}

function OptionsEditor({ kind, title, hint, items, placeholder }: { kind: OptionKind; title: string; hint: string; items: CrmOption[]; placeholder: string }) {
  const mutate = useMutate();
  const [name, setName] = useState('');
  const id = `new-${kind}`;

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (await mutate(() => pipelineApi.createOption(kind, name.trim()), 'Añadido')) setName('');
  };
  const move = (index: number, dir: -1 | 1) => {
    const ids = items.map((o) => o.id);
    const j = index + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j]!, ids[index]!];
    void mutate(() => pipelineApi.reorderOptions(kind, ids));
  };

  return (
    <section className="card" aria-labelledby={`${id}-title`}>
      <h2 className="card-title" id={`${id}-title`}>
        {title}
      </h2>
      <p className="muted">{hint}</p>
      <ul className="pipeline-list" aria-label={title}>
        {items.map((o, i) => (
          <OptionRow key={o.id} option={o} kind={kind} index={i} count={items.length} onMove={(d) => move(i, d)} />
        ))}
        {items.length === 0 && <li className="muted">Todavía no hay ninguno.</li>}
      </ul>
      <form onSubmit={add} className="settings-actions" aria-label={`Añadir a ${title}`}>
        <div className="field">
          <label htmlFor={id}>Añadir</label>
          <input id={id} value={name} maxLength={80} placeholder={placeholder} onChange={(e) => setName(e.target.value)} />
        </div>
        <button type="submit" className="btn btn-primary" disabled={!name.trim()}>
          Añadir
        </button>
      </form>
    </section>
  );
}

/** Ajustes de ventas (sólo administradores): etapas del embudo, orígenes de lead y motivos de pérdida. */
export function PipelineSettings() {
  const { leadSources, lossReasons } = usePipeline();
  return (
    <>
      <StagesEditor />
      <OptionsEditor
        kind="lead_source"
        title="Orígenes de lead"
        hint="De dónde llegan tus clientes potenciales. Se elige al crear un deal y alimenta el informe de qué origen trae mejores clientes."
        items={leadSources}
        placeholder="Podcast"
      />
      <OptionsEditor
        kind="loss_reason"
        title="Motivos de pérdida"
        hint="Por qué se pierde una venta. Se pregunta al mover un deal a una etapa perdida y alimenta el informe de por qué pierdes."
        items={lossReasons}
        placeholder="Eligió a la competencia"
      />
    </>
  );
}
