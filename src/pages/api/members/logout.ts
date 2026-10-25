import type { APIRoute } from 'astro';
import { redirectWith, signOut } from '../../../lib/auth';
import { accountUrl } from '../../../lib/members/account';

export const POST: APIRoute = async ({ request }) => redirectWith(accountUrl({ m: 'signed-out' }), await signOut(request));
