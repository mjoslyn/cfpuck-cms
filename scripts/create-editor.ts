// Create (or promote) an editor account.
//   npx tsx --env-file=.env scripts/create-editor.ts you@example.com 'password' [editor|admin]
import { siteDb } from '../src/lib/supabase';

const [email, password, role = 'admin'] = process.argv.slice(2);
if (!email || !password) throw new Error('usage: create-editor.ts <email> <password> [editor|admin]');
const sb = siteDb();

let { data: list } = await sb.auth.admin.listUsers();
let user = list?.users.find((u) => u.email === email);
if (!user) {
  const { data, error } = await sb.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  user = data.user;
} else {
  const { error } = await sb.auth.admin.updateUserById(user.id, { password });
  if (error) throw error;
}
const { error } = await sb.from('profiles').upsert({ id: user.id, role });
if (error) throw error;
console.log(`${email} is now ${role}`);
