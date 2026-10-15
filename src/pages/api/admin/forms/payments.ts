// Which payment providers have keys on this copy of the site, for the form builder's Payment tab.
import type { APIRoute } from 'astro';
import { providerStatus } from '../../../../lib/payments';

export const GET: APIRoute = () => Response.json(providerStatus());
