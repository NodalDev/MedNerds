// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  integrations: [
    starlight({
      title: 'MedNerds',
      favicon: '/favicon.svg',
      head: [
        { tag: 'link', attrs: { rel: 'icon', type: 'image/png', sizes: '16x16', href: '/favicon-16.png' } },
        { tag: 'link', attrs: { rel: 'icon', type: 'image/png', sizes: '32x32', href: '/favicon-32.png' } },
        { tag: 'link', attrs: { rel: 'icon', type: 'image/png', sizes: '64x64', href: '/favicon-64.png' } },
        { tag: 'link', attrs: { rel: 'apple-touch-icon', sizes: '180x180', href: '/apple-touch-icon.png' } },
      ],
      description: 'Freies medizinisches Wissen – verständlich, fundiert und offen zugänglich.',
      defaultLocale: 'de',
      customCss: ['./src/styles/global.css'],
      components: {
        Header: './src/components/MedNerdsHeader.astro',
        SiteTitle: './src/components/MedNerdsSiteTitle.astro',
        Sidebar: './src/components/MedNerdsSidebar.astro',
        PageTitle: './src/components/MedNerdsPageTitle.astro',
        Pagination: './src/components/MedNerdsPagination.astro',
        Footer: './src/components/MedNerdsContentFooter.astro',
        PageFrame: './src/components/MedNerdsPageFrame.astro',
        TwoColumnContent: './src/components/MedNerdsTwoColumnContent.astro',
      },
      sidebar: [
        // Themenreihenfolge hier; Artikelreihenfolge über sidebar.order im Markdown.
        {
          label: 'Übersicht',
          link: '/meddocs/',
        },
        {
          label: 'EKG',
          collapsed: true,
          items: [{ autogenerate: { directory: 'meddocs/ekg' } }],
        },
        {
          label: 'Echokardiographie',
          collapsed: true,
          items: [
            {
              label: 'Übersicht',
              link: 'meddocs/echokardiographie/',
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
          label: 'Sonographie',
          collapsed: true,
          items: [{ autogenerate: { directory: 'meddocs/sonographie' } }],
        },
        {
          label: 'Notfallmedizin',
          collapsed: true,
          items: [{ autogenerate: { directory: 'meddocs/notfallmedizin' } }],
        },
        {
          label: 'Diverses',
          collapsed: true,
          items: [{ autogenerate: { directory: 'meddocs/diverses' } }],
        },
      ],
    }),
    react(),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});
