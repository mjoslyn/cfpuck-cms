// moonpuck.com: the home page (src/pages/index.astro) and the documentation (Starlight), served as
// static files by a Cloudflare Worker (wrangler.jsonc).
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightSidebarTopics from 'starlight-sidebar-topics';

const FONTS =
  'https://fonts.googleapis.com/css2?family=Roboto+Serif:ital,opsz,wdth,wght@0,8..144,50..150,300..700;1,8..144,50..150,300..700&family=Instrument+Sans:wght@400;500;600;700&display=swap';

export default defineConfig({
  site: 'https://moonpuck.com',
  // This folder's own tsconfig: the repository's root one extends a package only the CMS installs, and
  // a build of the site alone (Workers Builds clones the whole repository) would look for it.
  vite: { tsconfig: './tsconfig.json' },
  // The site guide was one guide at /guide/ until it split into the Editor and Admin guides. The
  // admin bar's ? button on sites not yet updated still links there.
  redirects: {
    '/guide/': '/editors/',
    ...Object.fromEntries(
      ['pages-and-posts', 'page-editor', 'saving-and-publishing', 'images-and-files', 'forms',
        'writing-with-claude', 'accessibility', 'events-and-tickets', 'stats', 'common-questions']
        .map((page) => [`/guide/${page}/`, `/editors/${page}/`]),
    ),
    '/guide/menu-and-settings/': '/admins/settings/',
    '/guide/people/': '/admins/people/',
    '/guide/popups-and-cookies/': '/admins/popups-and-cookies/',
  },
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
      // Three guides, each with a sidebar of its own and a switcher above it.
      plugins: [
        starlightSidebarTopics([
          {
            label: 'Editor guide',
            link: '/editors/',
            icon: 'pencil',
            items: [{ autogenerate: { directory: 'editors' } }],
          },
          {
            label: 'Admin guide',
            link: '/admins/',
            icon: 'setting',
            items: [{ autogenerate: { directory: 'admins' } }],
          },
          {
            label: 'Developers',
            link: '/start/local-setup/',
            icon: 'laptop',
            items: [
              { label: 'Getting started', items: [{ autogenerate: { directory: 'start' } }] },
              { label: 'Building a site', items: [{ autogenerate: { directory: 'site' } }] },
              { label: 'Content', items: [{ autogenerate: { directory: 'content' } }] },
              { label: 'Features', items: [{ autogenerate: { directory: 'features' } }] },
              { label: 'Internals', items: [{ autogenerate: { directory: 'internals' } }] },
            ],
          },
        ]),
      ],
    }),
  ],
});
