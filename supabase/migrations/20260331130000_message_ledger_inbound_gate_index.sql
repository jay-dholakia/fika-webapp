-- Speed up "last inbound within 24h" lookups by phone.

create index if not exists message_ledger_peer_phone_direction_created_at
  on public.message_ledger (peer_phone, direction, created_at desc);

