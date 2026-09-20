# MedNerds – Agent Instructions

## Project

MedNerds is an Astro/Starlight medical knowledge platform.

## Development

Run:

npm run build
npx astro check

## Rules

- Make minimal, targeted changes.
- Do not perform unrelated refactors.
- Do not install new dependencies unless explicitly requested.
- Preserve existing MedNerds design tokens and architecture.
- Do not modify Starlight internals such as `.content-panel`,
  `.sl-container`, or `.main-pane` without explicit instruction.
- Prefer existing components and shared data structures.
- Do not edit generated files in `dist/`.

## Astro check in Codex

If `npx astro check` fails only inside the Codex Windows sandbox with:

source-map-js/lib/source-map-generator.js
require is not defined

do not modify dependencies or Astro/Vite configuration because of this
error. Request permission to run the check outside the sandbox instead.