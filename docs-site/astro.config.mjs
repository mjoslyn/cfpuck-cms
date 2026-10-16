// The supapuck-cms documentation site (Starlight), published to GitHub Pages by
// .github/workflows/docs.yml.
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://mjoslyn.github.io',
  base: '/supapuck-cms',
  integrations: [
    starlight({
      title: 'supapuck-cms',
      description: 'A CMS for small business and organisation sites: Astro on Netlify, Supabase, the Puck editor and Compose.',
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/mjoslyn/supapuck-cms' }],
      editLink: { baseUrl: 'https://github.com/mjoslyn/supapuck-cms/edit/main/docs-site/' },
      lastUpdated: true,
      sidebar: [
        { label: 'Getting started', items: [{ autogenerate: { directory: 'start' } }] },
        { label: 'Building a site', items: [{ autogenerate: { directory: 'site' } }] },
        { label: 'Content', items: [{ autogenerate: { directory: 'content' } }] },
        { label: 'Features', items: [{ autogenerate: { directory: 'features' } }] },
        { label: 'Internals', items: [{ autogenerate: { directory: 'internals' } }] },
      ],
    }),
  ],
});
