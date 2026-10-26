-- Ticket orders: the buyer's address (an IPv6 address as its /64), which limits how many orders and
-- unpaid tickets one client takes for an event (ticket_order_create); a note for the attendee list (an
-- order paid after it was cancelled or expired); and the refund being made, whose idempotency key a
-- retry reuses only while its outcome is unknown (src/lib/tickets/orders.ts refundOrder).
ALTER TABLE ticket_orders ADD COLUMN ip TEXT NOT NULL DEFAULT '';
ALTER TABLE ticket_orders ADD COLUMN note TEXT NOT NULL DEFAULT '';
ALTER TABLE ticket_orders ADD COLUMN refund_attempt JSON_TEXT;
CREATE INDEX ticket_orders_entry_ip ON ticket_orders (entry_id, ip, created_at);
