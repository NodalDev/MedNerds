import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { forCandidate, forPatient, osceCases, publicCases } from '../src/data/medcases/cases.ts';
import { formatTime, joinUrl, timerFromQuery, validTimerConfig } from '../src/lib/medcases/timer.ts';

const item = osceCases[0];
assert.equal(item.id, 'akuter-thoraxschmerz');
assert.equal(item.timer.durationSeconds, 780);
assert.equal(item.timer.warningRemainingSeconds, 120);
assert.match(item.joinCode, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
assert.equal(new Set(osceCases.map(({ joinCode }) => joinCode)).size, osceCases.length);
assert.equal(publicCases.length, osceCases.length);

const candidate = forCandidate(item);
const patient = forPatient(item);
assert.equal('examiner' in candidate, false);
assert.equal('patient' in candidate, false);
assert.equal('examiner' in patient, false);
assert.equal('candidate' in patient, false);
assert.equal(candidate.candidate.tasks.length > 0, true);
assert.equal(patient.patient.history.length > 0, true);

assert.equal(formatTime(780), '13:00');
assert.equal(formatTime(0), '00:00');
assert.equal(validTimerConfig({ durationSeconds: 60, warningRemainingSeconds: 0 }), true);
assert.equal(validTimerConfig({ durationSeconds: 1800, warningRemainingSeconds: 120 }), true);
assert.equal(validTimerConfig({ durationSeconds: 0, warningRemainingSeconds: 0 }), false);
assert.equal(validTimerConfig({ durationSeconds: 1801, warningRemainingSeconds: 120 }), false);
assert.equal(validTimerConfig({ durationSeconds: 600, warningRemainingSeconds: 600 }), false);
assert.deepEqual(timerFromQuery('?duration=600&warning=180', item.timer), { durationSeconds: 600, warningRemainingSeconds: 180 });
assert.deepEqual(timerFromQuery('?duration=600&warning=0', item.timer), { durationSeconds: 600, warningRemainingSeconds: 0 });
assert.deepEqual(timerFromQuery('?duration=abc&warning=180', item.timer), item.timer);
assert.deepEqual(timerFromQuery('?duration=600&warning=600', item.timer), item.timer);
assert.equal(joinUrl('https://mednerds.ch', item.joinCode, item.timer), 'https://mednerds.ch/medcases/join/?case=K7P4MX&duration=780&warning=120');

const root = 'dist/medcases/osce/akuter-thoraxschmerz';
const [landingHtml, publicHtml, candidateHtml, patientHtml, masterHtml, joinHtml] = await Promise.all([
  readFile('dist/medcases/index.html', 'utf8'),
  readFile(`${root}/index.html`, 'utf8'),
  readFile(`${root}/candidate/index.html`, 'utf8'),
  readFile(`${root}/patient/index.html`, 'utf8'),
  readFile(`${root}/master/index.html`, 'utf8'),
  readFile('dist/medcases/join/index.html', 'utf8'),
]);
assert.match(landingHtml, /data-pagefind-body/);
assert.match(publicHtml, /data-pagefind-body/);
for (const html of [joinHtml, candidateHtml, patientHtml, masterHtml]) {
  assert.match(html, /noindex, nofollow/);
  assert.doesNotMatch(html, /data-pagefind-body/);
}
assert.doesNotMatch(candidateHtml, /Kernproblem|Bluthochdruck|Checkliste|Ausstrahlung/);
assert.doesNotMatch(patientHtml, /Kernproblem|Checkliste|Gesamtscore/);
assert.match(masterHtml, /Kernproblem|Checkliste/);
console.log('MedCases data, timer configuration, role separation, search and SEO checks passed.');
