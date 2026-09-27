# HyperHeart reference analysis

Inspected read-only reference files: `_reference/hyperheart-original/hyperheart.js`, `source.md`, `index.html`, and `HyperHeart_html5_atlas_1.png`. The local source page and the public institution page agree on CC BY-NC 4.0 and the HTML5 update credit to Quentin Roper (Massey University).

## Image relationships

`lib.ssMetadata` declares 28 atlas rectangles. Each `cjs.Sprite` symbol selects one atlas frame with `gotoAndStop(index)`. The seven `// tutorial N` groups in `lib.HyperHeart_html5` place the matching heart, Wiggers, ECG, and sound symbols together and activate them at frames 50–56 respectively. The source map below was recovered from those groups, not guessed from atlas position or anatomical appearance.

| Phase / tutorial frame | Heart index / symbol | Wiggers index / symbol | ECG index / symbol | Sounds index / symbol |
| --- | --- | --- | --- | --- |
| Atrial systole / 50 | 0 / `atrialheart5` | 3 / `atrsyswig2` | 1 / `atrsyselectro` | 2 / `atrsyssound1` |
| Isovolumetric contraction / 51 | 4 / `isocontrcthrt1` | 6 / `isovolcontrctwig1` | 5 / `isovolcelectro1` | 11 / `isovolsound1` |
| Rapid ejection / 52 | 13 / `rapejecheart1` | 14 / `rapejecwig1` | 12 / `rapejecelectro1` | 15 / `rapidejectsound1` |
| Reduced ejection / 53 | 21 / `redejectheart1` | 23 / `redejectwig1` | 20 / `redejectelectro1` | 22 / `redejectsound1` |
| Isovolumetric relaxation / 54 | 8 / `isovolrelheart1` | 10 / `isovolrelwig1` | 7 / `isovolrelelectro1` | 9 / `isovolrelsound1` |
| Rapid ventricular filling / 55 | 17 / `rapventfillheart1` | 19 / `rapventfillwig1` | 16 / `rapventfillelectro1` | 18 / `rapventfillsound1` |
| Reduced ventricular filling / 56 | 25 / `redventfillheart1` | 27 / `redventfillwig1` | 24 / `redventfillelectro1` | 26 / `redventfillsound1` |

Heart and Wiggers frames are 237 × 280 pixels; ECG and sound frames are 237 × 100. No extra crop or resampling is applied. All 28 output rectangles, original symbol names, removed-pixel counts, and file hashes are in `asset-manifest.json`.

Some source Wiggers rectangles already truncate the right-hand volume legend or last time-axis label. The complete source rectangle is preserved; no additional label clipping is introduced. Those source limitations are not repaired by inventing or reinterpreting chart content.

## Timeline and labels

The main clip labels are `start: 0`, `tut1: 50` through `tut7: 56`, and `help: 57`. Tutorial frames call `stop()`. Source controls play/pause, reset to `start`, or move one timeline frame at a time; tutorial next/previous navigate tutorial labels. These behaviours are replaced by phase navigation, not mechanically ported.

The animation is exported at **12 fps**. The phase highlight/pointer and synchronized graph bars use boundaries **0, 6, 10, 16, 24, 30, 38**, with the playback time-marker reaching the end at **49**. `frame_49` immediately calls `gotoAndPlay('start')`. The prototype therefore uses half-open ranges `[0,6)`, `[6,10)`, `[10,16)`, `[16,24)`, `[24,30)`, `[30,38)`, `[38,49)`: 6, 4, 6, 8, 6, 8, and 11 visible animation frames, approximately 4.083 seconds total at 1×.

**Source ambiguity:** some highlight/background layers continue to frame 50 (their final transition is 12 frames), but the main action resets at frame 49. The prototype follows the visible playback/reset path and documents this one-frame discrepancy instead of inventing physiological timing. The chart's own time axis remains unchanged. Exported playback time is not the medical duration of a cardiac cycle.

The moving heart, pressure curves, and many labels in the original main animation are encoded as thousands of CreateJS vector shapes. The atlas is a set of **tutorial snapshots**, not a sequence of animation frames. Those snapshots remain backgrounds, but the corrected implementation reconstructs continuous blood-flow and cursor motion from the source timelines. English source labels and German phase translations are unchanged. No new physiological explanation, audio, curve data, valve calculations or phase definitions are added.

## Continuous motion reconstruction

`scripts/extract-hyperheart-motion.mjs` uses the existing TypeScript parser to read only literal source data. It collects initial `setTransform`, `alpha`, `_off`, and the ordered `to`/`wait` segments. It fails on unsupported expressions/easing instead of inventing a fallback. It does not evaluate the export. Generated `motion-data.ts` records the source checksum and a concise original-instance comment per element. The 138 quadratic motion guides are numeric arrays outside JSX. Fourteen symbol paths are decoded to ordinary SVG path data, preserving source fills and local shape offsets.

| Original stage instances | Reconstructed elements |
| --- | --- |
| `instance_31–32` | Two yellow lower flow indicators: position, scale, skew and opacity |
| `instance_33–42` | Two blue ejection streams, each with four dots/circles and one arrow |
| `instance_44–46`, `48–50` | Six yellow atrial flow arrows, with original rotation/skew and opacity windows |
| `instance_52–71` | Four blue streams, each with four dots/circles and one arrow |
| `instance_72–81` | Two red ejection streams, each with four dots/circles and one arrow |
| `instance_82–91` | Two red filling streams, each with four dots/circles and one arrow |
| `instance_92` | Original Wiggers time-marker track retained for traceability |
| `instance_100` | Canonical cursor for Wiggers, ECG and heart sounds |

Total: **58 moving flow instances**, 24 blue circles/dots, 16 red circles/dots, six blue arrows, four red arrows and eight yellow arrows. All activation/deactivation and alpha windows are recovered; visibility changes at the source tween endpoint. Source quadratic paths are sampled by distance, using ten length samples per quadratic like the source guide, with actual positions and tangent angles evaluated on the curve. Numeric transforms interpolate linearly; `orient: 'fixed'` follows the path tangent relative to the segment's initial rotation, overriding the explicit end rotation. This follows the [documented source guide semantics](https://createjs.com/docs/tweenjs/classes/MotionGuidePlugin.html) using independent native TypeScript math, without a plugin/runtime dependency.

One instance-local `requestAnimationFrame` loop advances fractional source frames using elapsed milliseconds × playback rate × 12 fps. Rendering is not restricted to 12 updates per second. The images change only at phase boundaries. Everything else samples the exact same frame, including pause/resume and arbitrary seeks. Phase controls never run playback timers. Controls/navigation and raster images are memoized; animation state remains inside the React tool island. No original stage or export is loaded in production.

The canonical cursor uses `instance_100` positions `(frame, source x)`: **(0, 644.95), (6, 698.25), (10, 719.85), (16, 763.95), (24, 822.75), (30, 862.35), (38, 917.85), (49, 1013.55)**. Interpolation preserves the source's non-uniform timing. Each diagram projects that same normalized source cursor onto its visible plot rectangle. `instance_92` differs slightly (e.g. its intermediate breakpoint is frame 23 rather than 24); its data is retained, but the common `instance_100` track takes precedence to meet exact synchronization. This is an explicit source discrepancy, not an invented clinical timing rule.

The heart SVG uses a **237 × 280 viewBox** matching the existing PNG. Source stage positions are projected as **x′ = 0.618x − 65; y′ = 0.618y − 13**. Calibration compared existing source contours `shape_6627` / `shape_6722` with atlas left-wall, venous-entry and right/apical landmarks. Symbols retain their source registration, rotation, scale and skew inside this affine projection. The image and SVG share one responsive wrapper, including mobile size limits. All overlays are decorative, hidden from assistive technology and pointer-transparent; there are no global SVG IDs or document queries.

## Deliberate limits and comparison

- The unmodified tutorial PNGs already contain frozen flow dots/arrows and phase shading, so these remain under the moving overlays. Removing them without changing anatomy needs a separate asset/redraw task.
- The original continuously deforms chamber/valve vectors; the prototype retains instant phase-based anatomical snapshots, as requested. A single calibrated projection cannot exactly match every deforming contour at every fractional frame.
- Wiggers tutorial snapshots differ in plot framing and some axes/legends are already cropped. Cursor projection spans the visible plot area; it is temporally synchronized but does not claim exact alignment with every raster curve/tick in every phase. ECG/sound waveforms remain unchanged.
- One-frame ghost arrowheads (`instance_29–30`), static ghost arrow groups (`47`, `51`) and frame-by-frame vector fill/trail decorations are not independent moving elements and are not reconstructed. No new trails, valve morphing, sound audio, tutorials or quiz are introduced.
- Frame-49 reset versus frame-50 decorative endpoints remains the one-frame timing ambiguity described above. There is no technical or physiological timing fallback.
- The supplied directory contains only JS, HTML, atlas and source notes. The two videos mentioned in the correction request were not available; comparison therefore uses the read-only export, recovered transforms/paths and browser playback, without executing the old application.

Verification: five focused Node test groups cover normalization, all phase boundaries, next/previous seeking, elapsed time and rates, loop/end behaviour, path endpoints/distance/tangents, opacity/visibility, source orientation, repeatable arbitrary seeks and the canonical cursor. Browser checks cover continuous within-phase motion, pause/resume, all seven phase seeks, fractional and keyboard scrubbing, mobile phase selection, speed, loop/reset/end, synchronized markers, reduced-motion autoplay suppression, two independent instances, parent-controlled phase seeking/callback acknowledgements without rewinding, and image/overlay alignment at 1440, 1024, 820, 390 and 320 px in both themes. No runtime exceptions or horizontal overflow were observed. `npx astro check` passed with 0 errors, warnings or hints; `npm run build` built all 23 pages successfully. Both required sandbox escalation after the known `source-map-js / require is not defined` error; no dependencies or configuration were changed.

## Files changed by this correction

- `src/components/tools/hyperheart/HyperHeart.tsx`
- `src/components/tools/hyperheart/HyperHeartPanels.tsx`
- `src/components/tools/hyperheart/hyperheart.css`
- `src/components/tools/hyperheart/useHyperHeartTimeline.ts` (new)
- `src/components/tools/hyperheart/HeartFlowOverlay.tsx` (new)
- `src/components/tools/hyperheart/HyperHeartTimeMarker.tsx` (new)
- `src/lib/tools/hyperheart/playback.ts`
- `src/lib/tools/hyperheart/timeline.ts` (new)
- `src/lib/tools/hyperheart/motion-types.ts` (new)
- `src/lib/tools/hyperheart/motion-data.ts` (generated, new)
- `src/lib/tools/hyperheart/interpolation.ts` (new)
- `src/lib/tools/hyperheart/motion.ts` (new)
- `src/lib/tools/hyperheart/source-mapping.ts` (new)
- `scripts/extract-hyperheart-motion.mjs` (new)
- `scripts/test-hyperheart-timeline.mjs` (new)
- `src/components/tools/hyperheart/README.md`
- `third_party/hyperheart/SOURCE_ANALYSIS.md`
- `third_party/hyperheart/NOTICE.md`

The route, MedTools overview, existing PNGs, general layout, dependencies/configuration and `_reference/` were not changed by this correction. `dist/` was only regenerated by the requested build, never edited manually.

## Extraction and background

The script reads frame metadata and sprite definitions as text; it never evaluates the legacy code. It removes only exact RGB `(0,102,102)` pixels that are four-connected to an image edge, changing alpha only. Enclosed regions and all other RGB values are retained, including original blue plot surfaces and white labels. Antialiased edges can retain traces of the original background colour; neutral dark local backing keeps labels readable and these edges unobtrusive in both site themes rather than risking anatomical damage with colour tolerance or smoothing.

Regenerate with `node --experimental-strip-types scripts/extract-hyperheart-assets.mjs`; verify committed outputs without writing with the same command plus `--verify`. Requires Node 22.6+ and the already installed `sharp`; no added dependencies. `_reference/` is development input only and is never imported into the deployed application.
