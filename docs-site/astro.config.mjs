// moonpuck.com: the home page (src/pages/index.astro) and the documentation (Starlight), served as
// static files by a Cloudflare Worker (wrangler.jsonc).
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

const FONTS =
  'https://fonts.googleapis.com/css2?family=Roboto+Serif:ital,opsz,wdth,wght@0,8..144,50..150,300..700;1,8..144,50..150,300..700&family=Instrument+Sans:wght@400;500;600;700&display=swap';

export default defineConfig({
  site: 'https://moonpuck.com',
  // This folder's own tsconfig: the repository's root one extends a package only the CMS installs, and
  // a build of the site alone (Workers Builds clones the whole repository) would look for it.
  vite: { tsconfig: './tsconfig.json' },
  integrations: [
    starlight({
      title: 'moonpuck',
      description: 'An open source website builder for small organisations: Astro on a Cloudflare Worker, D1 and R2, the Puck editor and Compose.',
      logo: { src: './src/assets/logo.svg' },
      customCss: ['./src/styles/moonpuck.css'],
      head: [
        { tag: 'link', attrs: { rel: 'preconnect', href: 'https://fonts.googleapis.com' } },
        { tag: 'link', attrs: { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: true } },
        { tag: 'link', attrs: { rel: 'stylesheet', href: FONTS } },
      ],
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
