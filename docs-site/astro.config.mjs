// The moonpuck documentation site (Starlight), published to GitHub Pages by
// .github/workflows/docs.yml.
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://mjoslyn.github.io',
  base: '/moonpuck',
  integrations: [
    starlight({
      title: 'moonpuck',
      description: 'A CMS for small business and organisation sites: Astro on a Cloudflare Worker, D1 and R2, the Puck editor and Compose.',
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/mjoslyn/moonpuck' }],
      editLink: { baseUrl: 'https://github.com/mjoslyn/moonpuck/edit/main/docs-site/' },
      lastUpdated: true,
      sidebar: [
        { label: 'Site guide (editors and admins)', items: [{ autogenerate: { directory: 'guide' } }] },
        { label: 'Getting started', items: [{ autogenerate: { directory: 'start' } }] },
        { label: 'Building a site', items: [{ autogenerate: { directory: 'site' } }] },
        { label: 'Content', items: [{ autogenerate: { directory: 'content' } }] },
        { label: 'Features', items: [{ autogenerate: { directory: 'features' } }] },
        { label: 'Internals', items: [{ autogenerate: { directory: 'internals' } }] },
      ],
    }),
  ],
});
