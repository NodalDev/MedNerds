// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import icon from 'astro-icon';

// https://astro.build/config
export default defineConfig({
  site: 'https://mednerds.ch',
  
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
            { autogenerate: { directory: 'meddocs/ekg' } },
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
              label: 'Theorie & Grundlagen',
              collapsed: true,
              items: [
                {
                  autogenerate: {
                    directory: 'meddocs/echokardiographie/theorie-grundlagen',
                  },
                },
              ],
            },
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
            { autogenerate: { directory: 'meddocs/sonographie' } },
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
