import { useCallback, useEffect, useRef, useState } from 'react';
import type { MasterCase } from '../../data/medcases/types';
import { OsceTimerSound } from '../../lib/osce-timer/sound';
import { validTimerConfig, type TimerCue, type TimerStatus } from '../../lib/medcases/timer';
import OsceTimer from './OsceTimer';
import RealtimeExaminer from './RealtimeExaminer';

type OsceMode = 'live' | 'local';

export default function OsceMaster({ item }: { item: MasterCase }) {
  const [mode, setMode] = useState<OsceMode>('live');
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [soundTestStatus, setSoundTestStatus] = useState<'untested' | 'tested' | 'failed'>('untested');
  const [localStatus, setLocalStatus] = useState<TimerStatus>('ready');
  const [liveActive, setLiveActive] = useState(false);
  const [liveTimerStatus, setLiveTimerStatus] = useState<TimerStatus | null>(null);
  const [checked, setChecked] = useState<Set<string>>(() => new Set());
  const [debriefOpen, setDebriefOpen] = useState(false);
  const audio = useRef<OsceTimerSound | null>(null);
  const timerConfig = validTimerConfig(item.timer) ? item.timer : null;
  const checklist = item.examiner.checklist ?? [];
  const checklistItems = checklist.flatMap((section) => section.items);
  const hasScoring = checklistItems.length > 0 && checklistItems.every((entry) => typeof entry.points === 'number' && Number.isFinite(entry.points));
  const total = checklistItems.reduce((sum, entry) => sum + (entry.points ?? 0), 0);
  const score = checklistItems.filter((entry) => checked.has(entry.id)).reduce((sum, entry) => sum + (entry.points ?? 0), 0);
  const findings = item.examiner.findings ?? [];
  const materials = item.examiner.materials ?? [];
  const learningObjectives = item.examiner.learningObjectives ?? [];
  const debrief = item.examiner.debrief;
  const hasDebrief = learningObjectives.length > 0 || Boolean(debrief && (debrief.keyPoints.length > 0 || debrief.reflectionQuestions.length > 0));

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('mode') === 'local') setMode('local');
    return () => { void audio.current?.close(); };
  }, []);
  const playCue = useCallback((cue: TimerCue) => {
    if (!soundEnabled) return;
    audio.current ??= new OsceTimerSound();
    void audio.current.play(cue);
  }, [soundEnabled]);
  const testCue = async (cue: TimerCue) => {
    audio.current ??= new OsceTimerSound();
    setSoundTestStatus(await audio.current.play(cue) ? 'tested' : 'failed');
  };
  const toggle = (id: string) => setChecked((previous) => {
    const next = new Set(previous);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const selectMode = (next: OsceMode) => {
    if (next === mode) return;
    const running = mode === 'local' ? localStatus === 'running' : liveTimerStatus === 'running';
    const unknownLiveTimer = mode === 'live' && liveActive && liveTimerStatus === null;
    if ((running || unknownLiveTimer) && !window.confirm(
      `${unknownLiveTimer ? 'Der Status des aktiven Live-Timers ist derzeit nicht bestätigt.' : 'Der aktuelle Timer läuft bereits.'}\n`
      + 'Er läuft beim Moduswechsel weiter. Der Zeitstand wird nicht übernommen. Modus wechseln?',
    )) return;
    setMode(next);
    const url = new URL(window.location.href);
    url.searchParams.set('mode', next);
    window.history.replaceState(null, '', url);
  };
  const soundControls = <section className="osce-sound" aria-label="Tonprüfung">
    <p className="osce-eyebrow">Tonprüfung</p>
    <strong>Ton vor Prüfungsbeginn testen</strong>
    <p className="osce-fineprint">Einige Browser und Geräte benötigen eine aktive Tonprüfung, damit Warn- und Endsignal zuverlässig abgespielt werden.</p>
    <p className="osce-sound__status" role="status" aria-live="polite">{soundTestStatus === 'tested' ? '✓ Ton getestet' : soundTestStatus === 'failed' ? 'Ton konnte nicht abgespielt werden' : '○ Noch nicht getestet'}</p>
    <button className="osce-button osce-button--secondary" type="button" onClick={() => void testCue('start')}>Ton testen</button>
    <label className="osce-toggle"><input type="checkbox" checked={soundEnabled} onChange={(event) => setSoundEnabled(event.target.checked)} />Ton aktiviert</label>
    <details><summary>Weitere Töne testen</summary><div className="osce-actions">
      <button className="osce-button osce-button--secondary" type="button" onClick={() => void testCue('start')}>Startton testen</button>
      <button className="osce-button osce-button--secondary" type="button" onClick={() => void testCue('warning')}>Warnung testen</button>
      <button className="osce-button osce-button--secondary" type="button" onClick={() => void testCue('end')}>Endton testen</button>
    </div></details>
    <p className="osce-fineprint">Nur dieses Prüfergerät gibt Signale aus.</p>
  </section>;

  return <div className="osce-workspace">
    <div className="osce-intro"><p className="osce-eyebrow">{item.demo ? 'Demo / Testfall · ' : ''}OSCE · Prüfer</p><p>Du leitest diesen Durchlauf. Frage, ob alle bereit sind, und gib das Startkommando verbal.</p></div>
    <div className="osce-master-grid">
      <div className="osce-master-grid__main">
        <section className="osce-panel"><h2>Fallüberblick</h2><p>{item.examiner.background}</p><p><strong>Kernproblem:</strong> {item.examiner.coreProblem}</p>{item.examiner.instructions.length > 0 && <ul>{item.examiner.instructions.map((line) => <li key={line}>{line}</li>)}</ul>}</section>
        {checklist.length > 0 && <section className="osce-panel"><div className="osce-section-heading"><h2>Checkliste</h2>{hasScoring && <strong className="osce-score" aria-live="polite">{score} / {total} Punkte</strong>}</div>{checklist.map((section) => <div className="osce-checklist" key={section.title}><h3>{section.title}</h3>{section.items.map((entry) => <label className="osce-checklist__item" key={entry.id}><input type="checkbox" checked={checked.has(entry.id)} onChange={() => toggle(entry.id)} /><span>{entry.label}{entry.critical && <small> · Schwerpunkt</small>}</span>{hasScoring && <strong>{entry.points} P</strong>}</label>)}</div>)}</section>}
        {findings.length > 0 && <section className="osce-panel"><h2>Untersuchungsbefunde</h2><p className="osce-muted">Bei Bedarf öffnen und verbal mitteilen.</p><div className="osce-details">{findings.map((finding) => <details key={finding.title}><summary>{finding.title}</summary><ul>{finding.lines.map((line) => <li key={line}>{line}</li>)}</ul></details>)}</div></section>}
        {materials.length > 0 && <section className="osce-panel"><h2>Materialien</h2>{materials.map((material) => <div className="osce-material" key={material.id}><p className="osce-eyebrow">{material.type.toUpperCase()}{item.demo ? ' · Demo' : ''}</p><h3>{material.title}</h3><p>{material.description}</p>{material.src ? <img src={material.src} alt={material.alt ?? material.title} loading="lazy" /> : material.lines && <ul>{material.lines.map((line) => <li key={line}>{line}</li>)}</ul>}</div>)}</section>}
        {hasDebrief && <section className="osce-panel"><h2>Debriefing</h2><p>Öffne die Auswertung nach dem Durchlauf bewusst selbst.</p><button className="osce-button osce-button--secondary" type="button" aria-expanded={debriefOpen} onClick={() => setDebriefOpen((open) => !open)}>{debriefOpen ? 'Debriefing schließen' : 'Debriefing öffnen'}</button>{debriefOpen && <div className="osce-debrief">{hasScoring && <p><strong>Gesamtscore:</strong> {score} / {total} Punkte</p>}{learningObjectives.length > 0 && <><h3>Lernziele</h3><ul>{learningObjectives.map((line) => <li key={line}>{line}</li>)}</ul></>}{debrief && debrief.keyPoints.length > 0 && <><h3>Kernpunkte</h3><ul>{debrief.keyPoints.map((line) => <li key={line}>{line}</li>)}</ul></>}{debrief && debrief.reflectionQuestions.length > 0 && <><h3>Reflexion</h3><ul>{debrief.reflectionQuestions.map((line) => <li key={line}>{line}</li>)}</ul></>}</div>}</section>}
      </div>
      <aside className="osce-master-grid__side">
        {timerConfig ? <>
          <div className="osce-mode-content" hidden={mode !== 'live'}>
            <RealtimeExaminer caseId={item.id} timer={timerConfig} materials={materials.filter(({ releaseToPatient }) => releaseToPatient)}
              onActiveChange={setLiveActive} onTimerStatusChange={setLiveTimerStatus} onUseLocalTimer={() => selectMode('local')}
              onCue={(cue) => { if (mode === 'live') playCue(cue); }} soundControls={soundControls} />
          </div>
          <div className="osce-mode-content" hidden={mode !== 'local'}>
            <OsceTimer config={timerConfig} master onCue={(cue) => { if (mode === 'local') playCue(cue); }}
              onStatusChange={setLocalStatus} soundControls={soundControls} />
          </div>
          <div className="osce-mode-switch"><span>Modus: {mode === 'live' ? 'Live-OSCE' : 'Lokaler Timer · Fallback'}</span>
            <button type="button" onClick={() => selectMode(mode === 'live' ? 'local' : 'live')}>
              {mode === 'live' ? 'Lokalen Timer verwenden' : 'Zu Live-OSCE wechseln'}
            </button>
          </div>
        </> : <section className="osce-panel" role="status"><h2>Timer nicht verfügbar</h2><p>Für diesen Fall fehlt eine gültige Timerkonfiguration.</p></section>}
      </aside>
    </div>
  </div>;
}
