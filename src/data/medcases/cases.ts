import type { CandidateCase, OsceCase, PatientCase, PublicCase } from './types';

const cases = [
  {
    id: 'akuter-thoraxschmerz',
    joinCode: 'K7P4MX',
    title: 'Akuter Thoraxschmerz',
    specialty: 'Notfallmedizin',
    summary: 'Simuliertes OSCE-Gespräch mit Anamnese, Befunden und einem kurzen Debriefing.',
    demo: true,
    timer: { durationSeconds: 780, warningRemainingSeconds: 120 },
    candidate: {
      setting: 'Simulierte Notaufnahme',
      role: 'Du übernimmst die Erstbeurteilung.',
      situation: 'Eine 54-jährige Person stellt sich wegen akut aufgetretener Brustschmerzen vor.',
      tasks: [
        'Führe ein fokussiertes Gespräch mit der simulierten Person.',
        'Erfrage relevante Beschwerden und teile dem Prüfer mit, welche Befunde du benötigst.',
        'Erläutere dein weiteres Vorgehen gegenüber dem Prüfer.',
      ],
      initialInformation: ['Die Person ist ansprechbar.', 'Weitere Informationen erhältst du im Gespräch oder vom Prüfer.'],
    },
    patient: {
      identity: '54 Jahre, simulierte Patientin oder simulierter Patient',
      demeanor: 'Besorgt, spricht in ganzen Sätzen.',
      openingStatement: 'Seit heute habe ich plötzlich Schmerzen in der Brust.',
      spontaneousInformation: ['Die Beschwerden haben heute begonnen.', 'Die Person möchte wissen, was als Nächstes passiert.'],
      history: [
        { topic: 'Beginn', answer: 'Die Beschwerden begannen vor etwa einer Stunde.' },
        { topic: 'Ausstrahlung', answer: 'Auf Nachfrage: Der Schmerz zieht in den linken Arm.' },
        { topic: 'Begleitbeschwerden', answer: 'Auf Nachfrage: Etwas Übelkeit und Schweiß.' },
        { topic: 'Vorerkrankungen', answer: 'Auf Nachfrage: Bluthochdruck ist bekannt.' },
        { topic: 'Medikamente', answer: 'Auf Nachfrage: Ein regelmäßig eingenommenes Blutdruckmittel.' },
      ],
      doNotVolunteer: ['Antworten zu Ausstrahlung und Vorerkrankungen erst auf Nachfrage geben.'],
      reactions: ['Bei verständlicher Erklärung ruhiger antworten.', 'Bei unklarer Frage um eine Wiederholung bitten.'],
    },
    examiner: {
      background: 'Demo-Fall für die Bedienung der OSCE-Oberfläche. Alle Angaben sind fiktiv und nicht redaktionell als Lehrfall geprüft.',
      coreProblem: 'Akuter Brustschmerz: strukturierte Ersteinschätzung und Kommunikation.',
      instructions: [
        'Gib das Startkommando verbal. Jedes Gerät startet seinen Timer separat.',
        'Teile Befunde nur auf Nachfrage mit oder zeige das Material auf deinem Gerät.',
        'Die Checkliste dient hier dem Funktionstest, nicht einer validierten Prüfung.',
      ],
      checklist: [
        { title: 'Gespräch', items: [
          { id: 'introduce', label: 'Stellt sich vor und erklärt das Vorgehen', points: 1 },
          { id: 'onset', label: 'Fragt nach Beginn und Verlauf', points: 1 },
          { id: 'character', label: 'Fragt nach Charakter und Stärke', points: 1 },
          { id: 'radiation', label: 'Fragt nach Ausstrahlung', points: 1 },
          { id: 'symptoms', label: 'Fragt nach Begleitbeschwerden', points: 1 },
        ] },
        { title: 'Orientierung und Kommunikation', items: [
          { id: 'history', label: 'Erfragt Vorerkrankungen und Medikamente', points: 2 },
          { id: 'findings', label: 'Fordert relevante Befunde an', points: 2 },
          { id: 'plan', label: 'Beschreibt ein nachvollziehbares weiteres Vorgehen', points: 2, critical: true },
          { id: 'explain', label: 'Erklärt das Vorgehen verständlich', points: 1 },
        ] },
      ],
      findings: [
        { title: 'Allgemeinzustand', lines: ['Ansprechbar und orientiert.', 'Wirkt besorgt.'] },
        { title: 'Vitalparameter', lines: ['Demo-Werte: Puls 92/min, Blutdruck 145/90 mmHg, SpO₂ 97 %.'] },
        { title: 'Herz und Lunge', lines: ['Demo-Befund: Auskultatorisch keine auffälligen Geräusche.'] },
      ],
      materials: [
        { id: 'vitals-1', type: 'vitals', title: 'Vitalparameter', description: 'Lokaler Demo-Materialslot für die Prüferansicht.', lines: ['Puls 92/min', 'Blutdruck 145/90 mmHg', 'SpO₂ 97 %'] },
      ],
      learningObjectives: ['Gespräch unter Zeitdruck strukturieren.', 'Befunde gezielt erfragen.', 'Das weitere Vorgehen verständlich kommunizieren.'],
      debrief: {
        keyPoints: ['Was hat im Gespräch Orientierung gegeben?', 'Welche Angaben mussten aktiv erfragt werden?'],
        reflectionQuestions: ['Welche Frage würdest du beim nächsten Durchlauf früher stellen?', 'War die Erklärung für die simulierte Person verständlich?'],
      },
    },
  },
] satisfies OsceCase[];

const validCode = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;
if (new Set(cases.map(({ joinCode }) => joinCode)).size !== cases.length || cases.some(({ joinCode }) => !validCode.test(joinCode))) {
  throw new Error('MedCases-Fallcodes müssen eindeutig und sechs gut lesbare Zeichen lang sein.');
}

function publicProjection({ id, joinCode, title, specialty, summary, demo, timer }: OsceCase): PublicCase {
  return { id, joinCode, title, specialty, summary, demo, timer };
}

export const osceCases: readonly OsceCase[] = cases;
export const publicCases: PublicCase[] = cases.map(publicProjection);
export function forCandidate(item: OsceCase): CandidateCase {
  return { ...publicProjection(item), candidate: item.candidate };
}
export function forPatient(item: OsceCase): PatientCase {
  return { ...publicProjection(item), patient: item.patient };
}
