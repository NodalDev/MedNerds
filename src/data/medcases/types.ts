export type OsceRole = 'master' | 'candidate' | 'patient';

export interface TimerConfig {
  durationSeconds: number;
  warningRemainingSeconds: number;
}

export type MaterialType = 'image' | 'ecg' | 'sono' | 'xray' | 'lab' | 'vitals' | 'document';

export interface CaseMaterial {
  id: string;
  type: MaterialType;
  title: string;
  description: string;
  src?: string;
  alt?: string;
  lines?: string[];
}

export interface ChecklistSection {
  title: string;
  items: { id: string; label: string; points: number; critical?: boolean }[];
}

export interface OsceCase {
  id: string;
  joinCode: string;
  title: string;
  specialty: string;
  summary: string;
  demo: boolean;
  timer: TimerConfig;
  candidate: {
    setting: string;
    role: string;
    situation: string;
    tasks: string[];
    initialInformation: string[];
  };
  patient: {
    identity: string;
    demeanor: string;
    openingStatement: string;
    spontaneousInformation: string[];
    history: { topic: string; answer: string }[];
    doNotVolunteer: string[];
    reactions: string[];
  };
  examiner: {
    background: string;
    coreProblem: string;
    instructions: string[];
    checklist: ChecklistSection[];
    findings: { title: string; lines: string[] }[];
    materials: CaseMaterial[];
    learningObjectives: string[];
    debrief: { keyPoints: string[]; reflectionQuestions: string[] };
  };
}

export type PublicCase = Pick<OsceCase, 'id' | 'joinCode' | 'title' | 'specialty' | 'summary' | 'demo' | 'timer'>;
export type CandidateCase = PublicCase & Pick<OsceCase, 'candidate'>;
export type PatientCase = PublicCase & Pick<OsceCase, 'patient'>;
export type MasterCase = OsceCase;
