import { useEffect, useState } from 'react';
import { axisLabels, classifyAxis, normalizeAngle } from '../../../lib/tools/ecg-axis-trainer/axis';
import { gradeQuizAnswer, quizAnswers, randomQuizAngle, type AxisQuizAnswerResult } from '../../../lib/tools/ecg-axis-trainer/quiz';
import type { AxisTypeId } from '../../../lib/tools/ecg-axis-trainer/axis';
import EcgAxisCircle from './EcgAxisCircle';
import EcgAxisDisplay from './EcgAxisDisplay';
import './ecg-axis-trainer.css';

export type TrainerMode = 'explore' | 'quiz';
export type TrainerVariant = 'full' | 'embedded' | 'dialog';

export interface EcgAxisTrainerProps {
  initialMode?: TrainerMode;
  enabledModes?: readonly TrainerMode[];
  variant?: TrainerVariant;
  showModeSwitcher?: boolean;
  showAttribution?: boolean;
  initialAngle?: number;
  onAnswer?: (result: AxisQuizAnswerResult) => void;
  onAngleChange?: (angle: number) => void;
}

const defaultModes: readonly TrainerMode[] = ['explore', 'quiz'];

export default function EcgAxisTrainer({
  initialMode = 'explore',
  enabledModes = defaultModes,
  variant = 'full',
  showModeSwitcher = true,
  showAttribution = true,
  initialAngle = 45,
  onAnswer,
  onAngleChange,
}: EcgAxisTrainerProps) {
  const modes = [...new Set(enabledModes)];
  const startingMode = modes.includes(initialMode) ? initialMode : (modes[0] ?? 'explore');
  const [mode, setMode] = useState<TrainerMode>(startingMode);
  const [exploreAngle, setExploreAngle] = useState(() => normalizeAngle(initialAngle));
  const [quizAngle, setQuizAngle] = useState(45);
  const [correctCount, setCorrectCount] = useState(0);
  const [wrongCount, setWrongCount] = useState(0);
  const [feedback, setFeedback] = useState<{ correct: boolean; text: string } | null>(null);

  // Generate only after hydration so SSR and the first client render agree.
  useEffect(() => {
    if (startingMode === 'quiz') setQuizAngle(randomQuizAngle());
  }, [startingMode]);

  function chooseMode(nextMode: TrainerMode) {
    if (mode === nextMode) return;
    setMode(nextMode);
    setFeedback(null);
    if (nextMode === 'quiz') setQuizAngle(randomQuizAngle());
  }

  function changeAngle(nextAngle: number) {
    const normalized = normalizeAngle(nextAngle);
    setExploreAngle(normalized);
    onAngleChange?.(normalized);
  }

  function nextCase() {
    setQuizAngle(randomQuizAngle());
    setFeedback(null);
  }

  function answerQuiz(answer: AxisTypeId) {
    const result = gradeQuizAnswer(quizAngle, answer);
    onAnswer?.(result);
    if (result.correct) {
      setCorrectCount((count) => count + 1);
      setQuizAngle(randomQuizAngle());
      setFeedback({ correct: true, text: 'Richtig! Ein neuer Fall ist bereit.' });
    } else {
      setWrongCount((count) => count + 1);
      setFeedback({ correct: false, text: 'Falsch. Versuche es mit demselben EKG noch einmal.' });
    }
  }

  const currentType = classifyAxis(exploreAngle);
  const displayAngle = mode === 'explore' ? exploreAngle : quizAngle;
  const ecgPanel = (
    <section className="axis-ecg-panel" aria-label="Simuliertes EKG">
      <div className="axis-panel-heading">
        <h3>Extremitätenableitungen</h3>
        <p>I · II · III · aVR · aVL · aVF</p>
      </div>
      <EcgAxisDisplay angle={displayAngle} />
    </section>
  );

  return (
    <div className="ecg-axis-trainer not-content" data-variant={variant} data-mode={mode}>
      <div className="axis-tool-head">
        <div>
          <p className="axis-tool-kicker">Elektrische Herzachse</p>
          <h2>Erkunden & üben</h2>
        </div>
        {showModeSwitcher && modes.length > 1 && (
          <div className="axis-mode-switch" role="group" aria-label="Trainermodus">
            {modes.map((item) => (
              <button
                key={item}
                type="button"
                aria-pressed={mode === item}
                onClick={() => chooseMode(item)}
              >
                {item === 'explore' ? 'Erkunden' : 'Quiz'}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="axis-panel-grid">
        {mode === 'quiz' && ecgPanel}
        <section className="axis-control-panel" aria-label={mode === 'explore' ? 'Lagetyp erkunden' : 'Lagetyp bestimmen'}>
          {mode === 'explore' ? (
            <>
              <div className="axis-panel-heading">
                <h3>Cabrera-Kreis</h3>
                <p>Ziehe den Pfeil oder nutze die Pfeiltasten.</p>
              </div>
              <EcgAxisCircle angle={exploreAngle} onChange={changeAngle} />
              <div className="axis-current-value" aria-live="off">
                <span>Lagetyp</span>
                <strong>{axisLabels[currentType]}</strong>
                <span className="axis-angle">{exploreAngle.toFixed(1)}°</span>
              </div>
            </>
          ) : (
            <>
              <div className="axis-panel-heading">
                <h3>Welcher Lagetyp liegt vor?</h3>
                <p>Beurteile die Extremitätenableitungen und wähle eine Antwort.</p>
              </div>
              <div className="axis-answers">
                {quizAnswers.map((answer) => (
                  <button key={answer} type="button" onClick={() => answerQuiz(answer)}>
                    {axisLabels[answer]}
                  </button>
                ))}
              </div>
              <div className="axis-quiz-footer">
                <div className="axis-counters" aria-label="Quizstand">
                  <span>Richtig <strong>{correctCount}</strong></span>
                  <span>Falsch <strong>{wrongCount}</strong></span>
                </div>
                <button className="axis-next" type="button" onClick={nextCase}>Neuer Fall</button>
              </div>
              <p className="axis-feedback" data-correct={feedback?.correct} role="status" aria-live="polite">
                {feedback?.text ?? 'Wähle den passenden Lagetyp.'}
              </p>
            </>
          )}
        </section>

        {mode === 'explore' && ecgPanel}
      </div>

      {showAttribution && (
        <p className="axis-attribution">
          Basierend auf dem <a href="https://github.com/david-shrk/ecgaxistrainer">ECG Axis Trainer von David Schaack</a> · MIT-Lizenz
        </p>
      )}
    </div>
  );
}
