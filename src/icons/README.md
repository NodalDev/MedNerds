# MedNerds icons

Use `src/components/MedNerdsIcon.astro` for UI symbols:

```astro
<MedNerdsIcon name="tabler:search" size="md" />
<MedNerdsIcon name="healthicons:cardiogram-outline" size="lg" />
<MedNerdsIcon name="tabler:info-circle" aria-label="Information" />
```

Sizes: `xs` (14), `sm` (16), `md` (20), `lg` (24), `xl` (32) at the default
root font size. CSS classes can override dimensions and inherited `currentColor`.
Icons next to visible labels are decorative by default. Give meaningful standalone
icons an `aria-label`; icon-only buttons still need a label on the button itself.

Tabler supplies general UI icons; Health Icons supply medical symbols. Both sets
are installed locally and rendered as inline SVG during the Astro build.
`src/data/sidebar-icons.ts` maps sidebar labels to their icons. The sidebar adds
these build-rendered icons to Starlight's labels without replacing its navigation.
Without JavaScript, the original text navigation remains available.

This directory is the local SVG directory expected by astro-icon. Add custom UI
symbols here only when neither set fits. Brand logos, favicons and medical
illustrations stay in their existing asset directories.

`MedNerdsCard.astro` and `MedNerdsPagination.astro` preserve the markup/styles of
Starlight 0.41.10 with the new icon source. Check them when upgrading Starlight.
Starlight-owned search, theme/menu controls and disclosure carets retain their
native icons. React's ArticleActions keeps its text symbols without another library.
