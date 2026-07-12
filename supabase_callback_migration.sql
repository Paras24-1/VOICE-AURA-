-- Supabase migration to add scheduled callback columns
ALTER TABLE public.campaign_contacts 
ADD COLUMN IF NOT EXISTS scheduled_at timestamp with time zone;

CREATE INDEX IF NOT EXISTS idx_campaign_contacts_scheduled_at 
ON public.campaign_contacts(scheduled_at) 
WHERE status = 'scheduled';
