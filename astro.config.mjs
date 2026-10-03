// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import icon from 'astro-icon';

// Starlight autogenerate cannot interleave direct articles and explicit subgroups.
// These Echo articles are drafts: omit their explicit slugs from production.
// When publishing an article, move its reference outside this draft-only helper.
/** @param {string[]} slugs */
function echoDraftItems(slugs) {
  return process.env.NODE_ENV === 'production'
    ? []
    : slugs.map((slug) => ({ slug: `meddocs/echokardiographie/${slug}` }));
}

// https://astro.build/config
export default defineConfig({
  site: 'https://mednerds.ch',
  redirects: {
    '/meddocs/echokardiographie/theorie-grundlagen/test/': '/meddocs/echokardiographie/grundlagen-technik/anatomie-des-herzens/',
  },
  
  integrations: [
    starlight({
      title: 'MedNerds',
      favicon: '/favicon-32.png',
      head: [
        { tag: 'link', attrs: { rel: 'icon', type: 'image/png', sizes: '16x16', href: '/favicon-16.png' } },
        { tag: 'link', attrs: { rel: 'icon', type: 'image/png', sizes: '32x32', href: '/favicon-32.png' } },
        { tag: 'link', attrs: { rel: 'icon', type: 'image/png', sizes: '64x64', href: '/favicon-64.png' } },
        { tag: 'link', attrs: { rel: 'apple-touch-icon', sizes: '180x180', href: '/apple-touch-icon.png' } },
      ],
      description: 'Freies medizinisches Wissen – verständlich, fundiert und offen zugänglich.',
      locales: {
        root: {
          label: 'Deutsch',
          lang: 'de',
        },
      },
      tableOfContents: {
        minHeadingLevel: 2,
        maxHeadingLevel: 3,
      },
      customCss: ['./src/styles/global.css'],
      components: {
        Header: './src/components/MedNerdsHeader.astro',
        ThemeSelect: './src/components/MedNerdsThemeSelect.astro',
        MobileMenuFooter: './src/components/MedNerdsMobileMenuFooter.astro',
        SiteTitle: './src/components/MedNerdsSiteTitle.astro',
        SocialIcons: './src/components/MedNerdsSocialIcons.astro',
        Hero: './src/components/MedNerdsHero.astro',
        Sidebar: './src/components/MedNerdsSidebar.astro',
        PageTitle: './src/components/MedNerdsPageTitle.astro',
        Pagination: './src/components/MedNerdsPagination.astro',
        Footer: './src/components/MedNerdsContentFooter.astro',
        PageFrame: './src/components/MedNerdsPageFrame.astro',
        PageSidebar: './src/components/MedNerdsPageSidebar.astro',
        TwoColumnContent: './src/components/MedNerdsTwoColumnContent.astro',
      },
      sidebar: [
        // Themenreihenfolge hier; Artikelreihenfolge über sidebar.order im Markdown.
        {
          label: 'Übersicht',
          link: '/meddocs/',
        },
        {
          label: 'Anästhesie',
          collapsed: true,
          items: [
            { label: 'Übersicht', link: '/meddocs/anaesthesie/' },
            { autogenerate: { directory: 'meddocs/anaesthesie' } },
          ],
        },
        {
          label: 'EKG',
          collapsed: true,
          items: [
            { label: 'Übersicht', link: '/meddocs/ekg/' },
            {
              label: 'Theorie & Elektrophysiologie',
              collapsed: true,
              items: [
                { autogenerate: { directory: 'meddocs/ekg/theorie-elektrophysiologie' } },
                { autogenerate: { directory: 'meddocs/ekg/theorie-grundlagen-ekg' } },
              ],
            },
            {
              label: 'Befundung & Systematik',
              collapsed: true,
              items: [{ autogenerate: { directory: 'meddocs/ekg/befundung-systematik' } }],
            },
            {
              label: 'Pathologische Muster',
              collapsed: true,
              items: [
                {
                  label: 'Rhythmusstörungen',
                  collapsed: true,
                  items: [{ autogenerate: { directory: 'meddocs/ekg/pathologische-muster/rhythmusstoerungen' } }],
                },
                {
                  label: 'Erregungsleitungsstörungen',
                  collapsed: true,
                  items: [{ autogenerate: { directory: 'meddocs/ekg/pathologische-muster/erregungsleitungsstoerungen' } }],
                },
                {
                  label: 'Ischämie & Myokardinfarkt',
                  collapsed: true,
                  items: [{ autogenerate: { directory: 'meddocs/ekg/pathologische-muster/ischaemie-myokardinfarkt' } }],
                },
                {
                  label: 'Hypertrophie & Herzbelastung',
                  collapsed: true,
                  items: [{ autogenerate: { directory: 'meddocs/ekg/pathologische-muster/hypertrophie-herzbelastung' } }],
                },
                {
                  label: 'Elektrolytstörungen',
                  collapsed: true,
                  items: [{ autogenerate: { directory: 'meddocs/ekg/pathologische-muster/elektrolytstoerungen' } }],
                },
                {
                  label: 'Medikamente & Intoxikationen',
                  collapsed: true,
                  items: [{ autogenerate: { directory: 'meddocs/ekg/pathologische-muster/medikamente-intoxikationen' } }],
                },
                {
                  label: 'Perikard & Myokard',
                  collapsed: true,
                  items: [{ autogenerate: { directory: 'meddocs/ekg/pathologische-muster/perikard-myokard' } }],
                },
                {
                  label: 'Pulmonale Erkrankungen',
                  collapsed: true,
                  items: [{ autogenerate: { directory: 'meddocs/ekg/pathologische-muster/pulmonale-erkrankungen' } }],
                },
                {
                  label: 'Kardiomyopathien',
                  collapsed: true,
                  items: [{ autogenerate: { directory: 'meddocs/ekg/pathologische-muster/kardiomyopathien' } }],
                },
                {
                  label: 'Kanalopathien',
                  collapsed: true,
                  items: [{ autogenerate: { directory: 'meddocs/ekg/pathologische-muster/kanalopathien' } }],
                },
                {
                  label: 'Schrittmacher & Devices',
                  collapsed: true,
                  items: [{ autogenerate: { directory: 'meddocs/ekg/pathologische-muster/schrittmacher-devices' } }],
                },
                {
                  label: 'Spezielle EKG-Muster',
                  collapsed: true,
                  items: [{ autogenerate: { directory: 'meddocs/ekg/pathologische-muster/spezielle-ekg-muster' } }],
                },
                {
                  label: 'Besondere Patientengruppen',
                  collapsed: true,
                  items: [{ autogenerate: { directory: 'meddocs/ekg/pathologische-muster/besondere-patientengruppen' } }],
                },
              ],
            },
          ],
        },
        {
          label: 'Echokardiographie',
          collapsed: true,
          items: [
            {
              label: 'Übersicht',
              link: '/meddocs/echokardiographie/',
            },
            {
              label: 'Grundlagen & Technik',
              collapsed: true,
              items: [
                { autogenerate: { directory: 'meddocs/echokardiographie/grundlagen-technik' } },
              ],
            },
            {
              label: 'Standardschnitte',
              collapsed: true,
              items: [
                ...echoDraftItems(['standardschnitte/schallfenster-standardschnitte']),
                {
                  label: 'Parasternale Schnitte',
                  collapsed: true,
                  items: [{ autogenerate: { directory: 'meddocs/echokardiographie/standardschnitte/parasternale-schnitte' } }],
                },
                {
                  label: 'Apikale Schnitte',
                  collapsed: true,
                  items: [{ autogenerate: { directory: 'meddocs/echokardiographie/standardschnitte/apikale-schnitte' } }],
                },
                {
                  label: 'Subkostale Schnitte',
                  collapsed: true,
                  items: [{ autogenerate: { directory: 'meddocs/echokardiographie/standardschnitte/subkostale-schnitte' } }],
                },
                {
                  label: 'Suprasternale Schnitte',
                  collapsed: true,
                  items: [{ autogenerate: { directory: 'meddocs/echokardiographie/standardschnitte/suprasternale-schnitte' } }],
                },
              ],
            },
            {
              label: 'Messungen & Quantifizierung',
              collapsed: true,
              items: [{ autogenerate: { directory: 'meddocs/echokardiographie/messungen-quantifizierung' } }],
            },
            {
              label: 'Pathologische Befunde & Erkrankungen',
              collapsed: true,
              items: [
                {
                  label: 'Ventrikuläre Dysfunktion',
                  collapsed: true,
                  items: [{ autogenerate: { directory: 'meddocs/echokardiographie/pathologische-befunde-erkrankungen/ventrikulaere-dysfunktion' } }],
                },
                {
                  label: 'Klappenerkrankungen',
                  collapsed: true,
                  items: [{ autogenerate: { directory: 'meddocs/echokardiographie/pathologische-befunde-erkrankungen/klappenerkrankungen' } }],
                },
                {
                  label: 'Perikarderkrankungen',
                  collapsed: true,
                  items: [{ autogenerate: { directory: 'meddocs/echokardiographie/pathologische-befunde-erkrankungen/perikarderkrankungen' } }],
                },
                {
                  label: 'Kardiomyopathien',
                  collapsed: true,
                  items: [{ autogenerate: { directory: 'meddocs/echokardiographie/pathologische-befunde-erkrankungen/kardiomyopathien' } }],
                },
                ...echoDraftItems([
                  'pathologische-befunde-erkrankungen/pulmonale-hypertonie-rechtsherzbelastung',
                  'pathologische-befunde-erkrankungen/aortenerkrankungen',
                  'pathologische-befunde-erkrankungen/endokarditis',
                  'pathologische-befunde-erkrankungen/intrakardiale-thromben-raumforderungen',
                  'pathologische-befunde-erkrankungen/shunts-angeborene-herzfehler',
                ]),
              ],
            },
            ...echoDraftItems(['formeln', 'echokardiographie-notfallmedizin']),
          ],
        },
        {
          label: 'Notfallmedizin',
          collapsed: true,
          items: [
            { label: 'Übersicht', link: '/meddocs/notfallmedizin/' },
            {
              label: 'X – Critical Bleeding',
              collapsed: true,
              items: [{ autogenerate: { directory: 'meddocs/notfallmedizin/x-critical-bleeding' } }],
            },
            {
              label: 'A – Airway',
              collapsed: true,
              items: [{ autogenerate: { directory: 'meddocs/notfallmedizin/a-airway' } }],
            },
            {
              label: 'B – Breathing',
              collapsed: true,
              items: [{ autogenerate: { directory: 'meddocs/notfallmedizin/b-breathing' } }],
            },
            {
              label: 'C – Circulation',
              collapsed: true,
              items: [{ autogenerate: { directory: 'meddocs/notfallmedizin/c-circulation' } }],
            },
            {
              label: 'D – Disability',
              collapsed: true,
              items: [{ autogenerate: { directory: 'meddocs/notfallmedizin/d-disability' } }],
            },
            {
              label: 'E – Exposure',
              collapsed: true,
              items: [{ autogenerate: { directory: 'meddocs/notfallmedizin/e-exposure' } }],
            },
            {
              label: 'Diverses',
              collapsed: true,
              items: [{ autogenerate: { directory: 'meddocs/notfallmedizin/diverses' } }],
            },
          ],
        },
        {
          label: 'Ultraschall',
          collapsed: true,
          items: [
            { label: 'Übersicht', link: '/meddocs/sonographie/' },
            {
              label: 'Grundlagen',
              collapsed: true,
              items: [{ autogenerate: { directory: 'meddocs/ultraschall/grundlagen' } }],
            },
            {
              label: 'Organe & Regionen',
              collapsed: true,
              items: [{ autogenerate: { directory: 'meddocs/ultraschall/organe-regionen' } }],
            },
            {
              label: 'Ultraschall in der Notfallmedizin',
              collapsed: true,
              items: [{ autogenerate: { directory: 'meddocs/ultraschall/notfallmedizin' } }],
            },
            // Drafts have no production routes. When publishing, move their
            // explicit references outside this draft-only condition.
            ...(process.env.NODE_ENV === 'production' ? [] : [
              { slug: 'meddocs/ultraschall/sgum-zertifikate' },
              { slug: 'meddocs/ultraschall/befunde-textvorlagen' },
            ]),
          ],
        },
        {
          label: 'Diverses',
          collapsed: true,
          items: [
            { label: 'Übersicht', link: '/meddocs/diverses/' },
            { autogenerate: { directory: 'meddocs/diverses' } },
          ],
        },
      ],
    }),
    react(),
    icon({ include: { tabler: ['*'], healthicons: ['*'], 'simple-icons': ['*'] } }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});
