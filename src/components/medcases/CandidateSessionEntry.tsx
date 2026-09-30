import { useEffect, useRef, useState, type SubmitEvent } from 'react';
import { resolveRealtimeCode } from '../../lib/medcases/MedCasesRealtimeClient';
import { realtimeConfig } from '../../lib/medcases/realtime-config';
import { normalizeSessionCode } from '../../lib/medcases/realtime-ui';

const CASE_ID = /^case-[a-f0-9]{10}$/;

export default function CandidateSessionEntry() {
  const [code, setCode] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const requestId = useRef(0);

  async function join(input: string) {
    const normalized = normalizeSessionCode(input);
    setCode(input);
    if (!normalized) {
      setError('Bitte gib einen gültigen sechsstelligen Session-Code ein.');
      return;
    }
    if (!realtimeConfig.workerUrl) {
      setError('Der Session-Beitritt ist derzeit nicht verfügbar.');
      return;
    }
    const current = ++requestId.current;
    setPending(true);
    setError('');
    try {
      const result = await resolveRealtimeCode(realtimeConfig.workerUrl, normalized);
      if (current !== requestId.current) return;
      if (!CASE_ID.test(result.caseId)) throw new Error('invalid-case');
      window.location.replace(`/medcases/osce/${result.caseId}/candidate/`);
    } catch (reason) {
      if (current !== requestId.current) return;
      setError(reason instanceof Error && reason.message === 'not-found'
        ? 'Diese Session ist nicht verfügbar.'
        : 'Der Session-Beitritt ist derzeit nicht verfügbar. Bitte versuche es erneut.');
      setPending(false);
    }
  }

  useEffect(() => {
    const queryCode = new URLSearchParams(window.location.search).get('code');
    if (queryCode) void join(queryCode);
    return () => { requestId.current += 1; };
  }, []);

  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    void join(code);
  }

  return <section className="osce-panel osce-candidate-entry">
    <h2>Session-Code eingeben</h2>
    <form className="osce-entry-form" onSubmit={submit}>
      <label className="osce-label" htmlFor="candidate-session-code">Session-Code</label>
      <div className="osce-join__row">
        <input id="candidate-session-code" className="osce-input osce-code-input" value={code}
          onChange={(event) => setCode(event.target.value)} autoComplete="off" autoCapitalize="characters"
          spellCheck={false} maxLength={16} required disabled={pending} />
        <button className="osce-button" type="submit" disabled={pending}>{pending ? 'Session wird geprüft …' : 'Beitreten'}</button>
      </div>
    </form>
    {error && <p className="osce-error" role="alert">{error}</p>}
  </section>;
}
