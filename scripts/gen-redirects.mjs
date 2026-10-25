// Netlify _redirects generated at build time: path prefixes the site moved 301 to their new paths
// (src/site/moved-paths.json). Media is served by the site's /media/ route.
import fs from 'node:fs';

const MOVES = JSON.parse(fs.readFileSync('src/site/moved-paths.json', 'utf8'));
const lines = MOVES.map(([from, to]) => (from.endsWith('/') ? `${from}*  ${to}:splat  301` : `${from}  ${to}  301`));
fs.writeFileSync('public/_redirects', lines.join('\n') + '\n');
console.log('public/_redirects written');
