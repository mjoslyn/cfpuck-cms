-- closed_api revoked these from public. On a hosted project, functions made before 0019's default
-- privileges were reachable by authenticated and service_role only through public, so editors lost
-- is_editor (every editor policy), saves lost entry_body_text, and the server lost not_found_hit and
-- redirect_hit. Grant them by name, as the local stack already does.
grant execute on function public.is_editor() to authenticated, service_role;
grant execute on function public.is_admin() to authenticated, service_role;
grant execute on function public.own_role() to authenticated, service_role;
grant execute on function public.entry_body_text(json) to authenticated, service_role;
grant execute on function public.not_found_hit(text, text) to service_role;
grant execute on function public.redirect_hit(bigint) to service_role;
grant execute on function public.ticket_order_status(text) to service_role;
grant execute on function public.entries_body_text() to service_role;
grant execute on function public.handle_new_user() to service_role;
grant execute on function public.touch_updated_at() to service_role;
grant execute on function public.sync_id_sequences() to service_role;
