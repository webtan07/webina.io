-- Capacity-aware double-booking protection.
--
-- 0000 stopped two confirmed bookings sharing a start time, which is right for
-- a barber (capacity 1) and wrong for a car wash with two bays. A booking now
-- carries its position in the slot (`slot_seq`, assigned inside the
-- transaction that also takes a per-slot advisory lock), and the unique index
-- covers the slot position instead of the bare start time. The overlap check
-- beyond that is done in `insertBookingAtomic`, under the same lock.

ALTER TABLE bookings ADD COLUMN slot_seq smallint NOT NULL DEFAULT 0;

ALTER TABLE bookings
  ADD CONSTRAINT bookings_slot_seq_check CHECK (slot_seq >= 0 AND slot_seq < 20);

DROP INDEX IF EXISTS bookings_business_start_confirmed_key;

CREATE UNIQUE INDEX bookings_business_start_slot_confirmed_key
  ON bookings (business_id, start_at, slot_seq)
  WHERE status = 'confirmed';
