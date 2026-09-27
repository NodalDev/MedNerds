# Interaktiver Herzzyklus / HyperHeart

MedTools prototype at `/medtools/kardiologie/herzzyklus/`, based on [HyperHeart](https://library.med.utah.edu/kw/pharm/hyperheart/). Original educational assets: **CC BY-NC 4.0**, separate from MedNerds' MIT license. See `third_party/hyperheart/LICENSE.md`, `NOTICE.md`, `SOURCE_ANALYSIS.md`, and `asset-manifest.json`.

## Architecture

- `src/lib/tools/hyperheart/types.ts`: stable English phase IDs and public domain/image types.
- `phases.ts`: single ordered phase model, German/source labels, original animation frame ranges and tutorial frames.
- `asset-source.ts`: development-only sprite relationships; `asset-map.ts`: generated, typed production image mapping.
- `playback.ts`: phase lookup and rate normalization; the phase slideshow functions have been removed.
- `timeline.ts`: fractional source-frame/progress conversion, phase resolution, boundary seeking and elapsed-time playback.
- `motion-types.ts`, generated `motion-data.ts`: source transforms, visibility/opacity windows, 138 quadratic guides, 58 moving flow instances and 14 original SVG symbol shapes.
- `interpolation.ts`, `motion.ts`: framework-independent distance sampling, tween interpolation, source orientation and transform composition; cached preparation supports arbitrary seeking.
- `source-mapping.ts`: calibrated heart-image coordinates and one canonical chart-position mapping.
- `useHyperHeartTimeline.ts`: one instance-local `requestAnimationFrame` clock, elapsed real time, pause/resume, cleanup and reduced-motion handling.
- `HyperHeart.tsx`: local timeline consumer, boundary-only phase callbacks, stable/memoized controls and a continuous native range input. The surrounding Astro page does not rerender.
- `HyperHeartControls.tsx`, `HyperHeartPhaseNav.tsx`: accessible controls and responsive stepper/select.
- `HyperHeartPanels.tsx`: four visual panels receiving the same `{ phase, sourceFrame }`; phase images are memoized and cached before playback boundaries.
- `HeartFlowOverlay.tsx`, `HyperHeartTimeMarker.tsx`: decorative, responsive SVG overlays with no IDs, document queries or independent timers.
- `HyperHeart.astro`: thin `client:visible` wrapper; no callbacks cross the Astro hydration boundary.
- `hyperheart.css`: every selector scoped to `.mn-hyperheart`; existing MedTools/theme tokens.

No CreateJS, original stage, iframe, reference-directory runtime access, backend, storage, quiz, tutorial engine, or global shortcuts/listeners. The normal site footer and medical disclaimer remain supplied by the existing page frame.

## Source and regeneration

The source groups seven tutorial image sets at frames 50–56. Those remain the raster backgrounds; motion now comes from source-derived vector overlays on a continuous master timeline. Background transparency and all 28 PNGs are unchanged. Original labels remain English and low-resolution. The rasters already contain frozen dots/arrows and phase highlights; these remain beneath the reconstructed motion. Some Wiggers legends/axes are truncated and phase snapshots differ in plot framing. The shared cursor projects onto the visible plot area, rather than claiming pixel-perfect alignment with every original curve landmark. See the source analysis for these limitations.

```sh
node --experimental-strip-types scripts/extract-hyperheart-assets.mjs
node --experimental-strip-types scripts/extract-hyperheart-assets.mjs --verify
node scripts/extract-hyperheart-motion.mjs
node scripts/extract-hyperheart-motion.mjs --verify
node scripts/test-hyperheart-timeline.mjs
```

Requires Node 22.6+ and the existing `sharp` and TypeScript installations. Asset extraction accepts the supplied flat atlas path or `images/` and regenerates the 28 PNGs, asset map, checksummed manifest and icon subset. Motion extraction statically parses the original stage using TypeScript's parser and converts source symbol paths to SVG; unsupported easing or motion fields fail extraction. Neither script evaluates legacy code or writes to `_reference/`. Focused tests use Node's built-in runner and compile pure modules in memory; no test dependency or configuration change is needed.

The 28 stable filenames are the cross-product of directories `heart/`, `wiggers/`, `ecg/`, `sounds/` and:

- `atrial-systole.png`
- `isovolumetric-contraction.png`
- `rapid-ejection.png`
- `reduced-ejection.png`
- `isovolumetric-relaxation.png`
- `rapid-ventricular-filling.png`
- `reduced-ventricular-filling.png`

## API and playback

`HyperHeartProps`: `initialPhase`, optional controlled `phase`, `autoPlay=false`, `loop=true`, `playbackRate=1`, `variant='full' | 'embedded' | 'dialog'`, `showControls=true`, `showPhaseNavigation=true`, and React-only `onPhaseChange(id)`.

Supported rates: 0.5, 1, 1.5, 2; unsupported/non-finite values fall back to 1. Unknown phase IDs fall back to Vorhofsystole. Phase selection seeks to its source boundary and pauses. Previous seeks to the current start, or the previous phase when within 0.2 source frames of that start. Next seeks to the next phase; boundary navigation wraps. Restart pauses at frame zero. Scrubbing seeks to any fractional frame and pauses. Changing tempo preserves the position. Non-loop playback stops at frame 49; starting again restarts at zero. Loop playback preserves fractional overshoot.

One elapsed-time clock advances 0–49 fractional source frames at the original 12 fps, rendering at browser refresh rate. Phase boundaries are 0, 6, 10, 16, 24, 30, 38, 49, **not physiological time**. All flow transforms, chart markers and current phase derive from that same frame. The canonical non-uniform cursor is the source `instance_100`. Autoplay is opt-in and suppressed by reduced motion; switching to reduced motion pauses playback. Explicit user-requested playback and paused seeking remain available. No crossfades or automatic decorative motion. Status is announced on manual selection, without playback live-region chatter.

`phase` is an optional external phase seek command. A different requested phase pauses and seeks; a parent acknowledging an emitted `onPhaseChange` does not rewind the clock. Initial callbacks are not emitted. Callbacks occur only when the derived phase changes. Instances use local state and React `useId`, so multiple tools can coexist. Attribution is always visible.

Astro wrapper accepts the same serializable props except `onPhaseChange`.

Future MedDocs example (not integrated in this task):

```astro
import HyperHeart from '.../HyperHeart.astro';
<HyperHeart variant="embedded" initialPhase="isovolumetric-contraction"
  showControls={false} showPhaseNavigation={false} />
```

Future MedLearn example inside a parent-owned React dialog:

```tsx
<HyperHeart variant="dialog" phase={lessonPhase} onPhaseChange={setLessonPhase}
  showControls={false} />
```

## Migration

Replace a panel's raster layer in a future task while retaining its `{ phase, sourceFrame }` API and the shared clock. The heart and Wiggers diagram need a separate medically reviewed redraw/data-model task; the current correction does not morph anatomy, redraw curves, generate ECG or play audio.
