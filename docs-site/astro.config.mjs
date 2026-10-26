// The cfpuck-cms documentation site (Starlight), published to GitHub Pages by
// .github/workflows/docs.yml.
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://mjoslyn.github.io',
  base: '/cfpuck-cms',
  integrations: [
    starlight({
      title: 'cfpuck-cms',
      description: 'A CMS for small business and organisation sites: Astro on a Cloudflare Worker, D1 and R2, the Puck editor and Compose.',
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/mjoslyn/cfpuck-cms' }],
      editLink: { baseUrl: 'https://github.com/mjoslyn/cfpuck-cms/edit/main/docs-site/' },
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
