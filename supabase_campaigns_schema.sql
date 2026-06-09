-- Supabase Outbound campaigns schema migration

-- Campaigns Table (scoped to organizations and voice agents)
create table if not exists public.campaigns (
    id uuid default gen_random_uuid() primary key,
    organization_id uuid references public.organizations(id) on delete cascade not null,
    agent_id uuid references public.agents(id) on delete cascade not null,
    name text not null,
    status text not null default 'draft', -- draft, running, paused, completed
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Campaign Contacts (the numbers to call for each campaign)
create table if not exists public.campaign_contacts (
    id uuid default gen_random_uuid() primary key,
    campaign_id uuid references public.campaigns(id) on delete cascade not null,
    name text not null,
    phone_number text not null,
    status text not null default 'pending', -- pending, dialing, answered, completed, failed, busy, no-answer
    call_sid text, -- to track session ID
    duration_seconds integer default 0,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Indexes for performance
create index if not exists idx_campaigns_org_id on public.campaigns(organization_id);
create index if not exists idx_campaigns_agent_id on public.campaigns(agent_id);
create index if not exists idx_campaign_contacts_campaign_id on public.campaign_contacts(campaign_id);
create index if not exists idx_campaign_contacts_status on public.campaign_contacts(status);

-- Enable RLS
alter table public.campaigns enable row level security;
alter table public.campaign_contacts enable row level security;

-- Setup RLS Policies

-- --- Campaigns Policies ---
create policy "Allow members to view their organization campaigns"
    on public.campaigns for select
    using (public.is_org_member(organization_id));

create policy "Allow members to manage their organization campaigns"
    on public.campaigns for all
    using (public.is_org_member(organization_id))
    with check (public.is_org_member(organization_id));

-- --- Campaign Contacts Policies ---
create policy "Allow members to view their organization campaign contacts"
    on public.campaign_contacts for select
    using (exists (
        select 1 from public.campaigns 
        where campaigns.id = campaign_contacts.campaign_id 
          and public.is_org_member(campaigns.organization_id)
    ));

create policy "Allow members to manage their organization campaign contacts"
    on public.campaign_contacts for all
    using (exists (
        select 1 from public.campaigns 
        where campaigns.id = campaign_contacts.campaign_id 
          and public.is_org_member(campaigns.organization_id)
    ))
    with check (exists (
        select 1 from public.campaigns 
        where campaigns.id = campaign_contacts.campaign_id 
          and public.is_org_member(campaigns.organization_id)
    ));

-- Add automatic updated_at column triggers
create trigger update_campaigns_updated_at
    before update on public.campaigns
    for each row execute procedure public.update_updated_at_column();

create trigger update_campaign_contacts_updated_at
    before update on public.campaign_contacts
    for each row execute procedure public.update_updated_at_column();
