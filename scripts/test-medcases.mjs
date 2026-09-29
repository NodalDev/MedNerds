import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { forCandidate, forPatient, osceCases, publicCases } from '../src/data/medcases/cases.ts';
import { formatTime, joinUrl, validTimerConfig } from '../src/lib/medcases/timer.ts';

const item = osceCases[0];
assert.match(item.id, /^case-[a-f0-9]{10}$/);
assert.equal(item.id, 'case-2bf98914ed');
assert.notEqual(item.id, item.joinCode);
assert.equal('sessionId' in item, false);
assert.equal(item.timer?.durationSeconds, 780);
assert.equal(item.timer?.warningRemainingSeconds, 120);
assert.match(item.joinCode, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
assert.equal(new Set(osceCases.map(({ id }) => id)).size, osceCases.length);
assert.equal(new Set(osceCases.map(({ joinCode }) => joinCode)).size, osceCases.length);
assert.equal(publicCases.length, osceCases.length);
assert.doesNotMatch(item.id, /thorax|schmerz|notfall|akut|patient/i);
assert.equal(forCandidate({ ...item, title: 'Anderer sichtbarer Titel' }).id, item.id);

const candidate = forCandidate(item);
const patient = forPatient(item);
for (const projection of [candidate, patient]) {
  assert.equal('examiner' in projection, false);
  assert.equal('timer' in projection, false);
  assert.equal('joinCode' in projection, false);
}
assert.equal('patient' in candidate, false);
assert.equal('candidate' in patient, false);
assert.ok(candidate.candidate.tasks.length > 0);
assert.ok(patient.patient.history.length > 0);

assert.equal(formatTime(780), '13:00');
assert.equal(formatTime(0), '00:00');
assert.equal(validTimerConfig({ durationSeconds: 60, warningRemainingSeconds: 0 }), true);
assert.equal(validTimerConfig({ durationSeconds: 1800, warningRemainingSeconds: 120 }), true);
assert.equal(validTimerConfig(undefined), false);
assert.equal(validTimerConfig({ durationSeconds: 0, warningRemainingSeconds: 0 }), false);
assert.equal(validTimerConfig({ durationSeconds: 1801, warningRemainingSeconds: 120 }), false);
assert.equal(validTimerConfig({ durationSeconds: 600, warningRemainingSeconds: 600 }), false);
assert.equal(joinUrl('https://mednerds.ch', item.joinCode), 'https://mednerds.ch/medcases/join/?case=K7P4MX');

const root = `dist/medcases/osce/${item.id}`;
const [landingHtml, publicHtml, candidateHtml, patientHtml, examinerHtml, joinHtml] = await Promise.all([
  readFile('dist/medcases/index.html', 'utf8'),
  readFile(`${root}/index.html`, 'utf8'),
  readFile(`${root}/candidate/index.html`, 'utf8'),
  readFile(`${root}/patient/index.html`, 'utf8'),
  readFile(`${root}/examiner/index.html`, 'utf8'),
  readFile('dist/medcases/join/index.html', 'utf8'),
]);
assert.match(landingHtml, /data-pagefind-body/);
assert.match(publicHtml, /data-pagefind-body/);
for (const html of [joinHtml, candidateHtml, patientHtml, examinerHtml]) {
  assert.match(html, /name="robots" content="noindex, nofollow"/);
  assert.doesNotMatch(html, /data-pagefind-body/);
}
assert.doesNotMatch(candidateHtml, /Kernproblem|Bluthochdruck|Checkliste|Ausstrahlung|osce-timer__display/);
assert.doesNotMatch(patientHtml, /Kernproblem|Checkliste|Gesamtscore|osce-timer__display/);
assert.doesNotMatch(candidateHtml, /OsceParticipant.*client:load/);
assert.match(examinerHtml, /Kernproblem|Checkliste|osce-timer__display/);
assert.doesNotMatch(examinerHtml, /duration=780|warning=120/);
assert.match(publicHtml, new RegExp(`/medcases/osce/${item.id}/examiner/`));
await assert.rejects(readFile('dist/medcases/osce/akuter-thoraxschmerz/index.html', 'utf8'), { code: 'ENOENT' });
await assert.rejects(readFile(`${root}/master/index.html`, 'utf8'), { code: 'ENOENT' });
await assert.rejects(readFile(`${root}/unknown/index.html`, 'utf8'), { code: 'ENOENT' });
console.log('MedCases IDs, role projections, timer configuration, static routes, spoiler isolation and indexing checks passed.');
