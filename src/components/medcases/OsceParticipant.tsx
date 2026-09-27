import { useEffect, useState } from 'react';
import type { CandidateCase, PatientCase, TimerConfig } from '../../data/medcases/types';
import { timerFromQuery } from '../../lib/medcases/timer';
import OsceTimer from './OsceTimer';

type Props = { role: 'candidate'; item: CandidateCase } | { role: 'patient'; item: PatientCase };

export default function OsceParticipant(props: Props) {
  const [config, setConfig] = useState<TimerConfig>(props.item.timer);
  useEffect(() => setConfig(timerFromQuery(window.location.search, props.item.timer)), [props.item.timer]);

  return <div className="osce-workspace">
    <div className="osce-intro">
      <p className="osce-eyebrow">{props.item.demo ? 'Demo / Testfall · ' : ''}OSCE · {props.role === 'candidate' ? 'Prüfling' : 'Schauspielpatient'}</p>
      <p>{props.role === 'candidate' ? 'Lies deine Aufgabenstellung. Warte auf das verbale Startkommando des Prüfers.' : 'Nutze die Rollenkarte als Gedächtnisstütze. Warte auf das verbale Startkommando des Prüfers.'}</p>
    </div>
    <div className="osce-workspace__grid">
      <div className="osce-workspace__content">
        {props.role === 'candidate' ? <>
          <section className="osce-panel"><h2>Ausgangssituation</h2><p><strong>Setting:</strong> {props.item.candidate.setting}</p><p><strong>Deine Rolle:</strong> {props.item.candidate.role}</p><p>{props.item.candidate.situation}</p></section>
          <section className="osce-panel"><h2>Aufgaben</h2><ul>{props.item.candidate.tasks.map((task) => <li key={task}>{task}</li>)}</ul></section>
          <section className="osce-panel"><h2>Initiale Informationen</h2><ul>{props.item.candidate.initialInformation.map((line) => <li key={line}>{line}</li>)}</ul></section>
        </> : <>
          <section className="osce-panel"><h2>Deine Rolle</h2><p><strong>Identität:</strong> {props.item.patient.identity}</p><p><strong>Auftreten:</strong> {props.item.patient.demeanor}</p><p className="osce-quote">„{props.item.patient.openingStatement}“</p></section>
          <section className="osce-panel"><h2>Spontan erzählen</h2><ul>{props.item.patient.spontaneousInformation.map((line) => <li key={line}>{line}</li>)}</ul></section>
          <section className="osce-panel"><h2>Nur auf Nachfrage</h2><div className="osce-details">{props.item.patient.history.map(({ topic, answer }) => <details key={topic}><summary>{topic}</summary><p>{answer}</p></details>)}</div></section>
          <section className="osce-panel"><h2>Verhalten</h2><h3>Nicht spontan erwähnen</h3><ul>{props.item.patient.doNotVolunteer.map((line) => <li key={line}>{line}</li>)}</ul><h3>Reaktionen</h3><ul>{props.item.patient.reactions.map((line) => <li key={line}>{line}</li>)}</ul></section>
        </>}
      </div>
      <aside className="osce-workspace__timer"><OsceTimer config={config} /></aside>
    </div>
  </div>;
}
