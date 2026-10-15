// A form placed on a page: the sponsorship section and the Form block both render through here.
import type { Env } from '../env';
import type { FormResult, FormRow } from '../../lib/forms/types';
import { autop } from '../../lib/text/formatting';
import { renderForm, renderConfirmation, FORM_SCRIPT } from './form';

export function embedForm(env: Env, row: FormRow, opts: { title?: boolean; description?: boolean } = {}): string {
  if (!env.ctx.scripts.includes(FORM_SCRIPT)) env.ctx.scripts.push(FORM_SCRIPT);
  const result = env.ctx.data.get('form-result') as FormResult | undefined;
  const mine = result && result.formId === row.id ? result : undefined;
  if (mine?.ok) return renderConfirmation(row.definition, autop(mine.message));
  return renderForm(row.definition, {
    action: env.ctx.queried.url.pathname,
    title: opts.title,
    description: opts.description,
    state: mine && !mine.ok ? { values: mine.values, errors: mine.errors, notice: mine.notice } : undefined,
  });
}
