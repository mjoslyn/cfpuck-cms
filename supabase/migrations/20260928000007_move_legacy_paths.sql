-- URLs inherited from WordPress moved (src/lib/paths.json): rewrite them in stored content.
-- Old URLs keep working through 301s; this keeps pages from linking through them.

create or replace function public.move_legacy_paths(t text)
returns text
language sql
immutable
set search_path = ''
as $$
  select replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(t, '/wp-content/uploads/', '/media/'), '\/wp-content\/uploads\/', '\/media\/'), '/wp-content/plugins/the-events-calendar/', '/assets/vendor/events/'), '\/wp-content\/plugins\/the-events-calendar\/', '\/assets\/vendor\/events\/'), '/wp-content/plugins/event-tickets/', '/assets/vendor/tickets/'), '\/wp-content\/plugins\/event-tickets\/', '\/assets\/vendor\/tickets\/'), '/wp-content/plugins/gravityforms/', '/assets/vendor/forms/'), '\/wp-content\/plugins\/gravityforms\/', '\/assets\/vendor\/forms\/'), '/wp-content/plugins/loop-builder/', '/assets/vendor/loop-builder/'), '\/wp-content\/plugins\/loop-builder\/', '\/assets\/vendor\/loop-builder\/'), '/wp-includes/', '/assets/vendor/core/'), '\/wp-includes\/', '\/assets\/vendor\/core\/'), '/assets/wp/', '/assets/css/'), '\/assets\/wp\/', '\/assets\/css\/'), '/wp-json/tribe/views/v2/html', '/api/events/view'), '\/wp-json\/tribe\/views\/v2\/html', '\/api\/events\/view'), '/wp-json/loop-builder/v1/more', '/api/loop/more'), '\/wp-json\/loop-builder\/v1\/more', '\/api\/loop\/more');
$$;

-- A path rewrite isn't an edit: keep updated_at.
alter table public.entries disable trigger entries_touch;
alter table public.templates disable trigger templates_touch;
alter table public.forms disable trigger forms_touch;
alter table public.settings disable trigger settings_touch;

update public.entries set
  content = public.move_legacy_paths(content::text)::json,
  legacy_html = public.move_legacy_paths(legacy_html),
  fields = public.move_legacy_paths(fields::text)::jsonb,
  excerpt_rendered = public.move_legacy_paths(excerpt_rendered),
  title_rendered = public.move_legacy_paths(title_rendered);
update public.revisions set content = public.move_legacy_paths(content::text)::json, fields = public.move_legacy_paths(fields::text)::jsonb;
update public.templates set content = public.move_legacy_paths(content::text)::json, legacy_html = public.move_legacy_paths(legacy_html);
update public.settings set value = public.move_legacy_paths(value::text)::jsonb;
update public.forms set definition = public.move_legacy_paths(definition::text)::jsonb;

alter table public.entries enable trigger entries_touch;
alter table public.templates enable trigger templates_touch;
alter table public.forms enable trigger forms_touch;
alter table public.settings enable trigger settings_touch;

drop function public.move_legacy_paths(text);
