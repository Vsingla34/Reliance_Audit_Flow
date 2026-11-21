-- =============================================================================
-- MULTI-TENANT ASSIGNMENT ARCHITECTURE MIGRATION
-- Run this script in your Supabase SQL Editor
-- =============================================================================

BEGIN;

-- 1. Create the `assignments` table
CREATE TABLE IF NOT EXISTS public.assignments (
  id text NOT NULL,
  name text NOT NULL,
  company_name text NOT NULL DEFAULT 'Reliance',
  description text DEFAULT '',
  active boolean DEFAULT true,
  created_by text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT assignments_pkey PRIMARY KEY (id)
);

-- Configure Row-Level Security (RLS) policies on `assignments` so authenticated/anon clients can read and admins can create/update/delete
ALTER TABLE public.assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all access to assignments" ON public.assignments;
CREATE POLICY "Allow all access to assignments"
  ON public.assignments
  FOR ALL
  TO public
  USING (true)
  WITH CHECK (true);

GRANT ALL ON TABLE public.assignments TO anon, authenticated, service_role;

-- Enable Realtime for `assignments` (safe if already enabled or publication exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.assignments;
    EXCEPTION WHEN duplicate_object THEN
      NULL;
    END;
  END IF;
END $$;

-- 2. Insert the default "Assignment 1" for all historical data up to today
INSERT INTO public.assignments (id, name, company_name, description, active, created_at, updated_at)
VALUES (
  'assignment-1',
  'Assignment 1',
  'Reliance Consumer Products',
  'Historical & current audit data till today',
  true,
  now(),
  now()
)
ON CONFLICT (id) DO NOTHING;

-- 3. Add `assignment_id` column to all tenant-scoped tables (defaulting to 'assignment-1')
ALTER TABLE public.distributors
  ADD COLUMN IF NOT EXISTS assignment_id text NOT NULL DEFAULT 'assignment-1';

ALTER TABLE public."auditTickets"
  ADD COLUMN IF NOT EXISTS assignment_id text NOT NULL DEFAULT 'assignment-1';

ALTER TABLE public."auditLineItems"
  ADD COLUMN IF NOT EXISTS assignment_id text NOT NULL DEFAULT 'assignment-1';

ALTER TABLE public."salesDump"
  ADD COLUMN IF NOT EXISTS assignment_id text NOT NULL DEFAULT 'assignment-1';

ALTER TABLE public."itemMaster"
  ADD COLUMN IF NOT EXISTS assignment_id text NOT NULL DEFAULT 'assignment-1';

ALTER TABLE public."activityLogs"
  ADD COLUMN IF NOT EXISTS assignment_id text DEFAULT 'assignment-1';

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS assignment_id text DEFAULT 'assignment-1';

-- 4. Backfill any existing NULL records to 'assignment-1'
UPDATE public.distributors     SET assignment_id = 'assignment-1' WHERE assignment_id IS NULL;
UPDATE public."auditTickets"   SET assignment_id = 'assignment-1' WHERE assignment_id IS NULL;
UPDATE public."auditLineItems" SET assignment_id = 'assignment-1' WHERE assignment_id IS NULL;
UPDATE public."salesDump"      SET assignment_id = 'assignment-1' WHERE assignment_id IS NULL;
UPDATE public."itemMaster"     SET assignment_id = 'assignment-1' WHERE assignment_id IS NULL;
UPDATE public."activityLogs"   SET assignment_id = 'assignment-1' WHERE assignment_id IS NULL;
UPDATE public.notifications    SET assignment_id = 'assignment-1' WHERE assignment_id IS NULL;

-- 5. Add Foreign Key constraints linking to `public.assignments(id)`
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'distributors_assignment_id_fkey') THEN
    ALTER TABLE public.distributors
      ADD CONSTRAINT distributors_assignment_id_fkey
      FOREIGN KEY (assignment_id) REFERENCES public.assignments(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auditTickets_assignment_id_fkey') THEN
    ALTER TABLE public."auditTickets"
      ADD CONSTRAINT "auditTickets_assignment_id_fkey"
      FOREIGN KEY (assignment_id) REFERENCES public.assignments(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auditLineItems_assignment_id_fkey') THEN
    ALTER TABLE public."auditLineItems"
      ADD CONSTRAINT "auditLineItems_assignment_id_fkey"
      FOREIGN KEY (assignment_id) REFERENCES public.assignments(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'salesDump_assignment_id_fkey') THEN
    ALTER TABLE public."salesDump"
      ADD CONSTRAINT "salesDump_assignment_id_fkey"
      FOREIGN KEY (assignment_id) REFERENCES public.assignments(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'itemMaster_assignment_id_fkey') THEN
    ALTER TABLE public."itemMaster"
      ADD CONSTRAINT "itemMaster_assignment_id_fkey"
      FOREIGN KEY (assignment_id) REFERENCES public.assignments(id) ON DELETE CASCADE;
  END IF;
END $$;

-- 6. Update `itemMaster` unique constraint so different assignments/companies
--    can each have their own item catalog (composite unique on assignment_id + itemCode)
ALTER TABLE public."itemMaster" DROP CONSTRAINT IF EXISTS "itemMaster_itemCode_key";
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'itemMaster_assignment_id_itemCode_key') THEN
    ALTER TABLE public."itemMaster"
      ADD CONSTRAINT "itemMaster_assignment_id_itemCode_key" UNIQUE (assignment_id, "itemCode");
  END IF;
END $$;

-- 7. Create performance indexes on `assignment_id` and composite lookups
CREATE INDEX IF NOT EXISTS idx_distributors_assignment_id
  ON public.distributors (assignment_id);

CREATE INDEX IF NOT EXISTS idx_distributors_assignment_code
  ON public.distributors (assignment_id, code);

CREATE INDEX IF NOT EXISTS idx_auditTickets_assignment_id
  ON public."auditTickets" (assignment_id);

CREATE INDEX IF NOT EXISTS idx_auditTickets_assignment_status
  ON public."auditTickets" (assignment_id, status);

CREATE INDEX IF NOT EXISTS idx_auditTickets_assignment_dist
  ON public."auditTickets" (assignment_id, "distributorId");

CREATE INDEX IF NOT EXISTS idx_auditLineItems_assignment_id
  ON public."auditLineItems" (assignment_id);

CREATE INDEX IF NOT EXISTS idx_auditLineItems_assignment_ticket
  ON public."auditLineItems" (assignment_id, "ticketId");

CREATE INDEX IF NOT EXISTS idx_salesDump_assignment_id
  ON public."salesDump" (assignment_id);

CREATE INDEX IF NOT EXISTS idx_salesDump_assignment_distCode
  ON public."salesDump" (assignment_id, "distributorCode");

CREATE INDEX IF NOT EXISTS idx_itemMaster_assignment_id
  ON public."itemMaster" (assignment_id);

CREATE INDEX IF NOT EXISTS idx_itemMaster_assignment_itemCode
  ON public."itemMaster" (assignment_id, "itemCode");

CREATE INDEX IF NOT EXISTS idx_activityLogs_assignment_id
  ON public."activityLogs" (assignment_id);

CREATE INDEX IF NOT EXISTS idx_notifications_assignment_id
  ON public.notifications (assignment_id);

COMMIT;
