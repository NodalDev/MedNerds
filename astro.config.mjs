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
      description: 'Freies medizinisches Wissen – verständlich, fundiert und offen zugänglich.',
      defaultLocale: 'de',
      customCss: ['./src/styles/global.css'],
      components: {
        Header: './src/components/MedNerdsHeader.astro',
      },
      sidebar: [
        {
          label: 'MedDocs',
          items: [
            {
              label: 'Übersicht',
              slug: 'meddocs',
            },
            {
              label: 'Kardiologie',
              items: [
                {
                  label: 'Anatomie des Herzens',
                  slug: 'meddocs/kardiologie/anatomie-des-herzens',
                },
              ],
            },
          ],
        },
      ],
    }),
    react(),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});
