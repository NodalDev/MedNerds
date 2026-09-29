import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import qrcode from 'qrcode-generator';
import type { MasterCase } from '../../data/medcases/types';
import { OsceTimerSound } from '../../lib/osce-timer/sound';
import { joinUrl, validTimerConfig, type TimerCue } from '../../lib/medcases/timer';
import OsceTimer from './OsceTimer';

function JoinQr({ url }: { url: string }) {
  const matrix = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    const size = qr.getModuleCount();
    const cells: [number, number][] = [];
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (qr.isDark(y, x)) cells.push([x + 4, y + 4]);
    return { cells, size: size + 8 };
  }, [url]);
  return <svg className="osce-qr" viewBox={`0 0 ${matrix.size} ${matrix.size}`} role="img" aria-label="QR-Code zum Beitritt zu diesem OSCE-Fall" xmlns="http://www.w3.org/2000/svg"><rect width={matrix.size} height={matrix.size} fill="#fff" />{matrix.cells.map(([x, y]) => <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill="#10131c" />)}</svg>;
}

export default function OsceMaster({ item, origin }: { item: MasterCase; origin: string }) {
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [checked, setChecked] = useState<Set<string>>(() => new Set());
  const [debriefOpen, setDebriefOpen] = useState(false);
  const audio = useRef<OsceTimerSound | null>(null);
  const timerConfig = validTimerConfig(item.timer) ? item.timer : null;
  const url = joinUrl(origin, item.joinCode);
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

  useEffect(() => () => { void audio.current?.close(); }, []);
  const playCue = useCallback((cue: TimerCue) => {
    if (!soundEnabled) return;
    audio.current ??= new OsceTimerSound();
    void audio.current.play(cue);
  }, [soundEnabled]);
  const testCue = (cue: TimerCue) => {
    audio.current ??= new OsceTimerSound();
    void audio.current.play(cue);
  };
  const toggle = (id: string) => setChecked((previous) => {
    const next = new Set(previous);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

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
        {timerConfig ? <OsceTimer config={timerConfig} master onCue={playCue} /> : <section className="osce-panel" role="status"><h2>Timer nicht verfügbar</h2><p>Für diesen Fall fehlt eine gültige Timerkonfiguration.</p></section>}
        <section className="osce-panel"><h2>Ton</h2><label className="osce-toggle"><input type="checkbox" checked={soundEnabled} onChange={(event) => setSoundEnabled(event.target.checked)} />Ton aktiviert</label><p className="osce-muted">Nur dieses Prüfergerät gibt Signale aus.</p><div className="osce-actions"><button className="osce-button osce-button--secondary" type="button" onClick={() => testCue('start')}>Startton testen</button><button className="osce-button osce-button--secondary" type="button" onClick={() => testCue('warning')}>Warnung testen</button><button className="osce-button osce-button--secondary" type="button" onClick={() => testCue('end')}>Endton testen</button></div></section>
        <section className="osce-panel osce-invite"><h2>Teilnehmer beitreten</h2><JoinQr url={url} /><p className="osce-label">Fallcode</p><strong className="osce-join-code">{item.joinCode}</strong><p className="osce-muted">QR-Code scannen oder <a href="/medcases/join/">mednerds.ch/medcases/join</a> öffnen und den Fallcode eingeben.</p><p className="osce-fineprint">Der QR-Code enthält nur den statischen Fallcode. Er erstellt keine Session und überträgt keine Zeitwerte.</p><a className="osce-text-link" href={url}>Beitrittslink öffnen →</a></section>
      </aside>
    </div>
  </div>;
}
