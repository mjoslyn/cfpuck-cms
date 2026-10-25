import type { APIRoute } from 'astro';
import { redirectWith, signOut } from '../../../lib/auth';

export const POST: APIRoute = async ({ request }) => redirectWith('/admin/login/', await signOut(request), 302);
