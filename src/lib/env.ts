// A setting from the environment (server only): the Worker's variables and secrets, which reach the
// code as process.env (nodejs_compat), or a script's (tsx --env-file). Under astro dev, Vite's
// import.meta.env carries .env as well. Only dev reads it: in a build, Vite writes into the bundle the
// .env value of every name the code reads from import.meta.env, and those would stand in for the
// Worker's own (the build machine's AUTH_SECRET, SMTP_URL or an empty SITE_URL, deployed as production's).
export function env(k: string): string | undefined {
  const value = globalThis.process?.env?.[k];
  if (value !== undefined) return value;
  return import.meta.env?.DEV ? (import.meta.env[k] as string | undefined) : undefined;
}
