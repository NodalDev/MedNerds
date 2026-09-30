import type { TimerConfig } from '../../lib/osce-timer/timer';

export type { TimerConfig } from '../../lib/osce-timer/timer';

export type OsceRole = 'examiner' | 'candidate' | 'patient';

export type MaterialType = 'image' | 'ecg' | 'sono' | 'xray' | 'lab' | 'vitals' | 'document';

export interface CaseMaterial {
  id: string;
  type: MaterialType;
  title: string;
  description: string;
  src?: string;
  alt?: string;
  lines?: string[];
  /** Explicitly permits this material to be released to the patient in a live session. */
  releaseToPatient?: boolean;
}

export interface ChecklistSection {
  title: string;
  items: { id: string; label: string; points?: number; critical?: boolean }[];
}

export interface OsceCase {
  /** Stable, non-semantic URL identifier. It does not change with the visible title. */
  id: string;
  /** Static V1 lookup code, not a session identifier. */
  joinCode: string;
  title: string;
  specialty: string;
  summary: string;
  demo: boolean;
  timer?: TimerConfig;
  candidate: {
    setting: string;
    role: string;
    situation: string;
    tasks: string[];
    initialInformation: string[];
    materials?: CaseMaterial[];
  };
  patient: {
    identity: string;
    demeanor: string;
    openingStatement: string;
    spontaneousInformation: string[];
    history: { topic: string; answer: string }[];
    doNotVolunteer: string[];
    reactions: string[];
    materials?: CaseMaterial[];
  };
  examiner: {
    background: string;
    coreProblem: string;
    instructions: string[];
    checklist?: ChecklistSection[];
    findings?: { title: string; lines: string[] }[];
    materials?: CaseMaterial[];
    learningObjectives?: string[];
    debrief?: { keyPoints: string[]; reflectionQuestions: string[] };
  };
}

export type PublicCase = Pick<OsceCase, 'id' | 'joinCode' | 'title' | 'specialty' | 'summary' | 'demo' | 'timer'>;
export type CandidateCase = Pick<OsceCase, 'id' | 'demo' | 'candidate'>;
export type PatientCase = Pick<OsceCase, 'id' | 'title' | 'demo' | 'patient'> & { releasableMaterials: CaseMaterial[] };
export type MasterCase = OsceCase;
