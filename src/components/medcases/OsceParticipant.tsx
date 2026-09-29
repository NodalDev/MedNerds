import type { CandidateCase, CaseMaterial, PatientCase } from '../../data/medcases/types';

type Props = { role: 'candidate'; item: CandidateCase } | { role: 'patient'; item: PatientCase };

function RoleMaterials({ materials }: { materials?: CaseMaterial[] }) {
  if (!materials?.length) return null;
  return <section className="osce-panel"><h2>Materialien</h2>{materials.map((material) => <div className="osce-material" key={material.id}><h3>{material.title}</h3><p>{material.description}</p>{material.src ? <img src={material.src} alt={material.alt ?? material.title} loading="lazy" /> : material.lines && <ul>{material.lines.map((line) => <li key={line}>{line}</li>)}</ul>}</div>)}</section>;
}

export default function OsceParticipant(props: Props) {
  return <div className="osce-workspace">
    <div className="osce-intro">
      <p className="osce-eyebrow">{props.item.demo ? 'Demo / Testfall · ' : ''}OSCE · {props.role === 'candidate' ? 'Prüfling' : 'Schauspielpatient'}</p>
      <p>{props.role === 'candidate' ? 'Lies deine Aufgabenstellung. Der Prüfer steuert die Zeit.' : 'Nutze die Rollenkarte als Gedächtnisstütze. Der Prüfer steuert die Zeit.'}</p>
    </div>
    <div className="osce-workspace__content">
        {props.role === 'candidate' ? <>
          <section className="osce-panel"><h2>Ausgangssituation</h2><p><strong>Setting:</strong> {props.item.candidate.setting}</p><p><strong>Deine Rolle:</strong> {props.item.candidate.role}</p><p>{props.item.candidate.situation}</p></section>
          {props.item.candidate.tasks.length > 0 && <section className="osce-panel"><h2>Aufgaben</h2><ul>{props.item.candidate.tasks.map((task) => <li key={task}>{task}</li>)}</ul></section>}
          {props.item.candidate.initialInformation.length > 0 && <section className="osce-panel"><h2>Initiale Informationen</h2><ul>{props.item.candidate.initialInformation.map((line) => <li key={line}>{line}</li>)}</ul></section>}
          <RoleMaterials materials={props.item.candidate.materials} />
        </> : <>
          <section className="osce-panel"><h2>Deine Rolle</h2><p><strong>Identität:</strong> {props.item.patient.identity}</p><p><strong>Auftreten:</strong> {props.item.patient.demeanor}</p><p className="osce-quote">„{props.item.patient.openingStatement}“</p></section>
          {props.item.patient.spontaneousInformation.length > 0 && <section className="osce-panel"><h2>Spontan erzählen</h2><ul>{props.item.patient.spontaneousInformation.map((line) => <li key={line}>{line}</li>)}</ul></section>}
          {props.item.patient.history.length > 0 && <section className="osce-panel"><h2>Nur auf Nachfrage</h2><div className="osce-details">{props.item.patient.history.map(({ topic, answer }) => <details key={topic}><summary>{topic}</summary><p>{answer}</p></details>)}</div></section>}
          {(props.item.patient.doNotVolunteer.length > 0 || props.item.patient.reactions.length > 0) && <section className="osce-panel"><h2>Verhalten</h2>{props.item.patient.doNotVolunteer.length > 0 && <><h3>Nicht spontan erwähnen</h3><ul>{props.item.patient.doNotVolunteer.map((line) => <li key={line}>{line}</li>)}</ul></>}{props.item.patient.reactions.length > 0 && <><h3>Reaktionen</h3><ul>{props.item.patient.reactions.map((line) => <li key={line}>{line}</li>)}</ul></>}</section>}
          <RoleMaterials materials={props.item.patient.materials} />
        </>}
    </div>
  </div>;
}
