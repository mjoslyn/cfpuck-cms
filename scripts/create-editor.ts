// Create (or promote) an editor account.
//   npx tsx --env-file=.env scripts/create-editor.ts you@example.com 'password' [editor|admin]
import { siteDb } from '../src/lib/db/site';
import { createUser, setPassword, userByEmail } from '../src/lib/auth';

const [email, password, role = 'admin'] = process.argv.slice(2);
if (!email || !password) throw new Error('usage: create-editor.ts <email> <password> [editor|admin]');

const found = await userByEmail(email);
const user = found ?? (await createUser({ email, password, emailVerified: true }));
if (found) await setPassword(found.id, password);
const { error } = await siteDb().from('profiles').upsert({ id: user.id, role });
if (error) throw error;
console.log(`${email} is now ${role}`);
