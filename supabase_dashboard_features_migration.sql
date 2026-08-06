-- SQL migration for new dashboard features: Phonebooks, KnowledgeBases, and SIP Trunks

-- 1. Phonebooks Table
CREATE TABLE IF NOT EXISTS public.phonebooks (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
    name text NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Phonebook Contacts Table
CREATE TABLE IF NOT EXISTS public.phonebook_contacts (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    phonebook_id uuid REFERENCES public.phonebooks(id) ON DELETE CASCADE NOT NULL,
    name text NOT NULL,
    phone_number text NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. Knowledge Bases Table
CREATE TABLE IF NOT EXISTS public.knowledge_bases (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
    name text NOT NULL,
    description text,
    file_url text,
    status text NOT NULL DEFAULT 'completed', -- completed, parsing, failed
    parsed_text text,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 4. SIP Trunks Table
CREATE TABLE IF NOT EXISTS public.sip_trunks (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
    provider text NOT NULL,
    username text,
    password text,
    host text NOT NULL,
    prefix text,
    status text NOT NULL DEFAULT 'active', -- active, inactive
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 5. Indexes for performance
CREATE INDEX IF NOT EXISTS idx_phonebooks_org_id ON public.phonebooks(organization_id);
CREATE INDEX IF NOT EXISTS idx_phonebook_contacts_pb_id ON public.phonebook_contacts(phonebook_id);
CREATE INDEX IF NOT EXISTS idx_kb_org_id ON public.knowledge_bases(organization_id);
CREATE INDEX IF NOT EXISTS idx_sip_trunks_org_id ON public.sip_trunks(organization_id);

-- 6. Enable Row Level Security (RLS)
ALTER TABLE public.phonebooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.phonebook_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_bases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sip_trunks ENABLE ROW LEVEL SECURITY;

-- 7. Setup RLS Policies
-- Phonebooks
CREATE POLICY "Allow members to view their organization phonebooks"
    ON public.phonebooks FOR SELECT
    USING (public.is_org_member(organization_id));

CREATE POLICY "Allow members to manage their organization phonebooks"
    ON public.phonebooks FOR ALL
    USING (public.is_org_member(organization_id))
    WITH CHECK (public.is_org_member(organization_id));

-- Phonebook Contacts
CREATE POLICY "Allow members to view their organization phonebook contacts"
    ON public.phonebook_contacts FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM public.phonebooks 
        WHERE phonebooks.id = phonebook_contacts.phonebook_id 
          AND public.is_org_member(phonebooks.organization_id)
    ));

CREATE POLICY "Allow members to manage their organization phonebook contacts"
    ON public.phonebook_contacts FOR ALL
    USING (EXISTS (
        SELECT 1 FROM public.phonebooks 
        WHERE phonebooks.id = phonebook_contacts.phonebook_id 
          AND public.is_org_member(phonebooks.organization_id)
    ))
    WITH CHECK (EXISTS (
        SELECT 1 FROM public.phonebooks 
        WHERE phonebooks.id = phonebook_contacts.phonebook_id 
          AND public.is_org_member(phonebooks.organization_id)
    ));

-- Knowledge Bases
CREATE POLICY "Allow members to view their organization knowledge bases"
    ON public.knowledge_bases FOR SELECT
    USING (public.is_org_member(organization_id));

CREATE POLICY "Allow members to manage their organization knowledge bases"
    ON public.knowledge_bases FOR ALL
    USING (public.is_org_member(organization_id))
    WITH CHECK (public.is_org_member(organization_id));

-- SIP Trunks
CREATE POLICY "Allow members to view their organization sip trunks"
    ON public.sip_trunks FOR SELECT
    USING (public.is_org_member(organization_id));

CREATE POLICY "Allow members to manage their organization sip trunks"
    ON public.sip_trunks FOR ALL
    USING (public.is_org_member(organization_id))
    WITH CHECK (public.is_org_member(organization_id));

-- 8. Updated At Triggers
CREATE TRIGGER update_phonebooks_updated_at
    BEFORE UPDATE ON public.phonebooks
    FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at_column();

CREATE TRIGGER update_phonebook_contacts_updated_at
    BEFORE UPDATE ON public.phonebook_contacts
    FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at_column();

CREATE TRIGGER update_knowledge_bases_updated_at
    BEFORE UPDATE ON public.knowledge_bases
    FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at_column();

CREATE TRIGGER update_sip_trunks_updated_at
    BEFORE UPDATE ON public.sip_trunks
    FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at_column();
