import { useId } from 'react';
import { hyperHeartPhases } from '../../../lib/tools/hyperheart/phases';
import type { HyperHeartPhaseId } from '../../../lib/tools/hyperheart/types';

interface Props {
  phaseId: HyperHeartPhaseId;
  onSelect: (id: HyperHeartPhaseId) => void;
}

export default function HyperHeartPhaseNav({ phaseId, onSelect }: Props) {
  const selectId = useId();
  return (
    <nav className="hh-phase-nav" aria-label="Phasen des Herzzyklus">
      <ol className="hh-phase-steps">
        {hyperHeartPhases.map((phase) => (
          <li key={phase.id}>
            <button type="button" aria-current={phase.id === phaseId ? 'step' : undefined}
              aria-label={`Phase ${phase.order}: ${phase.label}`} onClick={() => onSelect(phase.id)}>
              <span className="hh-step-marker" aria-hidden="true">{phase.id === phaseId ? '✓' : phase.order}</span>
              <span>{phase.label}</span>
            </button>
          </li>
        ))}
      </ol>
      <label className="hh-phase-select" htmlFor={selectId}>
        <span>Phase wählen</span>
        <select id={selectId} value={phaseId} onChange={(event) => onSelect(event.target.value as HyperHeartPhaseId)}>
          {hyperHeartPhases.map((phase) => <option key={phase.id} value={phase.id}>{phase.order} · {phase.label}</option>)}
        </select>
      </label>
    </nav>
  );
}
