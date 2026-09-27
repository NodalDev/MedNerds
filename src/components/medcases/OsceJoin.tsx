import { useEffect, useState } from 'react';
import type { PublicCase } from '../../data/medcases/types';
import { timerFromQuery } from '../../lib/medcases/timer';

export default function OsceJoin({ cases }: { cases: PublicCase[] }) {
  const [code, setCode] = useState('');
  const [selected, setSelected] = useState<PublicCase | null>(null);
  const [message, setMessage] = useState('');
  const [query, setQuery] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fromQr = params.get('case')?.toUpperCase() ?? '';
    setQuery(window.location.search);
    if (fromQr) {
      setCode(fromQr);
      const found = cases.find((item) => item.joinCode === fromQr);
      if (found) setSelected(found);
      else setMessage('Dieser Fallcode wurde nicht gefunden. Bitte prüfe den Code und versuche es erneut.');
    }
  }, [cases]);

  const submit = (event: { preventDefault(): void }) => {
    event.preventDefault();
    const found = cases.find((item) => item.joinCode === code.trim().toUpperCase());
    setSelected(found ?? null);
    setMessage(found ? '' : 'Dieser Fallcode wurde nicht gefunden. Bitte prüfe den Code und versuche es erneut.');
    if (found && code.trim().toUpperCase() !== new URLSearchParams(query).get('case')) setQuery('');
  };

  const suffix = selected && new URLSearchParams(query).get('case') === selected.joinCode
    ? (() => {
        const config = timerFromQuery(query, selected.timer);
        return `?duration=${config.durationSeconds}&warning=${config.warningRemainingSeconds}`;
      })()
    : '';

  return <div className="osce-join">
    <form className="osce-panel" onSubmit={submit}>
      <label className="osce-label" htmlFor="osce-code">Sechsstelliger Fallcode</label>
      <div className="osce-join__row">
        <input id="osce-code" className="osce-input osce-code-input" autoComplete="off" autoCapitalize="characters" maxLength={6} pattern="[A-Za-z2-9]{6}" value={code} onChange={(event) => { setCode(event.target.value.toUpperCase()); setSelected(null); setMessage(''); }} placeholder="K7P4MX" required />
        <button className="osce-button" type="submit">Weiter</button>
      </div>
      <p className="osce-fineprint">Der Code gehört zu einem Fall. Er verbindet keine Geräte miteinander.</p>
      {message && <p className="osce-error" role="alert">{message}</p>}
    </form>
    {selected && <section className="osce-panel" aria-labelledby="osce-role-title">
      <p className="osce-eyebrow">{selected.demo ? 'Demo / Testfall' : selected.specialty}</p>
      <h2 id="osce-role-title">{selected.title}</h2>
      <p>Welche Rolle übernimmst du?</p>
      <div className="osce-role-links">
        <a className="osce-role-link" href={`/medcases/osce/${selected.id}/candidate/${suffix}`}><strong>Prüfling</strong><span>Aufgabenstellung und eigener Timer</span></a>
        <a className="osce-role-link" href={`/medcases/osce/${selected.id}/patient/${suffix}`}><strong>Schauspielpatient</strong><span>Rollenkarte und eigener Timer</span></a>
      </div>
      <p className="osce-fineprint">{suffix ? 'Die Zeitvorgaben wurden aus dem QR-Code übernommen.' : 'Bei manueller Eingabe gelten die Standardzeiten des Falls.'} Start erst nach dem Kommando des Prüfers.</p>
    </section>}
  </div>;
}
