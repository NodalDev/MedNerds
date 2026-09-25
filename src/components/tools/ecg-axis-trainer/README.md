# EKG-Lagetyptrainer

`EcgAxisTrainer.tsx` is the canonical React component. Pure axis, lead, and quiz logic lives in `src/lib/tools/ecg-axis-trainer/`; canvas drawing and local styling live beside the component. `EcgAxisTrainer.astro` is the `client:visible` wrapper for Astro/MDX pages.

- Modes: `explore`, `quiz` (select with `initialMode` and `enabledModes`).
- Variants: `full`, `embedded`, `dialog`. Use `showModeSwitcher` and `showAttribution` as needed.
- MedTools uses the Astro wrapper at `/medtools/ekg/lagetyptrainer/`.
- Future MedDocs example: `<EcgAxisTrainer initialMode="explore" enabledModes={['explore', 'quiz']} variant="embedded" />` after importing the Astro wrapper in MDX.
- Future MedLearn example: `<EcgAxisTrainer initialMode="quiz" enabledModes={['quiz']} variant="dialog" onAnswer={handleAxisAnswer} />` after importing the React component into the course dialog. The parent owns dialog lifecycle, shortcuts, and progress.

Based on [ECG Axis Trainer by David Schaack](https://github.com/david-shrk/ecgaxistrainer), revision `27c77d1033f9b086965f290a395b4cffd28b1857`. Original MIT license and adaptation notice: `third_party/ecg-axis-trainer/`.
