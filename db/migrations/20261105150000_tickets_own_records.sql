-- Tickets become their own records (entries of the hidden `ticket` type), which events attach to
-- (`fields.ticket`). Each event that sold tickets gets a ticket named after it holding its setup, and is
-- attached to it; an event that shared another's tickets (`fields.tickets_from`) is attached to that
-- event's ticket. Orders, waitlist places and the event's own emails move to the ticket (an event that
-- shared another's but had orders of its own from before gets a ticket for them, attached to nothing).
-- The events keep their updated_at.
DROP TRIGGER IF EXISTS entries_touch;

INSERT INTO entries (type, slug, title, status, fields, content)
SELECT 'ticket', 'ticket-e' || id, title, 'publish',
       json_object('tickets', json_extract(fields, '$.tickets'), 'from_event', id),
       '{"content":[],"root":{"props":{}}}'
FROM entries
WHERE type = 'event'
  AND ((json_extract(fields, '$.tickets_from') IS NULL AND json_array_length(json_extract(fields, '$.tickets.types')) > 0)
    OR EXISTS (SELECT 1 FROM ticket_orders o WHERE o.entry_id = entries.id)
    OR EXISTS (SELECT 1 FROM ticket_waitlist w WHERE w.entry_id = entries.id)
    OR EXISTS (SELECT 1 FROM ticket_emails m WHERE m.entry_id = entries.id));

UPDATE ticket_orders SET entry_id = (SELECT t.id FROM entries t WHERE t.type = 'ticket' AND json_extract(t.fields, '$.from_event') = ticket_orders.entry_id)
WHERE entry_id IN (SELECT json_extract(fields, '$.from_event') FROM entries WHERE type = 'ticket' AND json_extract(fields, '$.from_event') IS NOT NULL);
UPDATE ticket_waitlist SET entry_id = (SELECT t.id FROM entries t WHERE t.type = 'ticket' AND json_extract(t.fields, '$.from_event') = ticket_waitlist.entry_id)
WHERE entry_id IN (SELECT json_extract(fields, '$.from_event') FROM entries WHERE type = 'ticket' AND json_extract(fields, '$.from_event') IS NOT NULL);
UPDATE ticket_emails SET entry_id = (SELECT t.id FROM entries t WHERE t.type = 'ticket' AND json_extract(t.fields, '$.from_event') = ticket_emails.entry_id)
WHERE entry_id IN (SELECT json_extract(fields, '$.from_event') FROM entries WHERE type = 'ticket' AND json_extract(fields, '$.from_event') IS NOT NULL);

-- Events that shared another's tickets: that event's ticket.
UPDATE entries SET fields = json_set(json_remove(fields, '$.tickets_from', '$.tickets'), '$.ticket',
  (SELECT t.id FROM entries t WHERE t.type = 'ticket' AND json_extract(t.fields, '$.from_event') = json_extract(entries.fields, '$.tickets_from')))
WHERE type = 'event' AND json_extract(fields, '$.tickets_from') IS NOT NULL
  AND EXISTS (SELECT 1 FROM entries t WHERE t.type = 'ticket' AND json_extract(t.fields, '$.from_event') = json_extract(entries.fields, '$.tickets_from'));
UPDATE entries SET fields = json_remove(fields, '$.tickets_from') WHERE type = 'event' AND json_extract(fields, '$.tickets_from') IS NOT NULL;

-- Events with tickets of their own: their ticket.
UPDATE entries SET fields = json_set(json_remove(fields, '$.tickets'), '$.ticket',
  (SELECT t.id FROM entries t WHERE t.type = 'ticket' AND json_extract(t.fields, '$.from_event') = entries.id))
WHERE type = 'event' AND json_extract(fields, '$.ticket') IS NULL
  AND json_array_length(json_extract(fields, '$.tickets.types')) > 0
  AND EXISTS (SELECT 1 FROM entries t WHERE t.type = 'ticket' AND json_extract(t.fields, '$.from_event') = entries.id);
UPDATE entries SET fields = json_remove(fields, '$.tickets') WHERE type = 'event' AND json_extract(fields, '$.tickets') IS NOT NULL;

UPDATE entries SET fields = json_remove(fields, '$.from_event') WHERE type = 'ticket';

CREATE TRIGGER entries_touch AFTER UPDATE ON entries FOR EACH ROW WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE entries SET updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) WHERE rowid = NEW.rowid;
END;
