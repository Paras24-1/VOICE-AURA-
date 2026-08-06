-- Database migration for Google Sheets Webhook, Lead Enrichment, and Script Versioning

-- 1. Add Columns to campaigns/campaign_contacts & phonebook_contacts
ALTER TABLE public.campaign_contacts 
    ADD COLUMN IF NOT EXISTS lead_type text,
    ADD COLUMN IF NOT EXISTS lead_source text,
    ADD COLUMN IF NOT EXISTS lead_temperature text,
    ADD COLUMN IF NOT EXISTS category text;

ALTER TABLE public.phonebook_contacts 
    ADD COLUMN IF NOT EXISTS lead_type text,
    ADD COLUMN IF NOT EXISTS lead_source text,
    ADD COLUMN IF NOT EXISTS lead_temperature text,
    ADD COLUMN IF NOT EXISTS category text;

-- 2. Add Columns to agents
ALTER TABLE public.agents 
    ADD COLUMN IF NOT EXISTS emotion_tone text DEFAULT 'professional';

-- 3. Add Google Sheets webhook URL to organizations
ALTER TABLE public.organizations
    ADD COLUMN IF NOT EXISTS google_sheets_webhook_url text;

-- 4. Create Script Versions Table
CREATE TABLE IF NOT EXISTS public.script_versions (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    agent_id uuid REFERENCES public.agents(id) ON DELETE CASCADE NOT NULL,
    version integer NOT NULL,
    system_prompt text NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 5. Enable RLS and setup policies for script_versions
ALTER TABLE public.script_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow members to view script versions"
    ON public.script_versions FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM public.agents 
        WHERE agents.id = script_versions.agent_id 
          AND public.is_org_member(agents.organization_id)
    ));

CREATE POLICY "Allow members to manage script versions"
    ON public.script_versions FOR ALL
    USING (EXISTS (
        SELECT 1 FROM public.agents 
        WHERE agents.id = script_versions.agent_id 
          AND public.is_org_member(agents.organization_id)
    ))
    WITH CHECK (EXISTS (
        SELECT 1 FROM public.agents 
        WHERE agents.id = script_versions.agent_id 
          AND public.is_org_member(agents.organization_id)
    ));

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_script_versions_agent_id ON public.script_versions(agent_id);
