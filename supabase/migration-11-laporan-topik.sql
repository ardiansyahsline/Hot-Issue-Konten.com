-- =====================================================================
-- UPDATE 12 — Laporan clipper per topik Hot Issue
-- Satu Hot Issue = satu topik. Kasus yang sama dari clipper lain ditambahkan sebagai "laporan"
-- (kontak, keterangan, dan bukti sendiri). Makin banyak laporan, makin HOT (otomatis mulai 3 laporan).
-- Jalankan SEKALI di Supabase SQL Editor SETELAH migration-10. Aman dijalankan ulang.
-- =====================================================================

-- ---------- 1. Tabel laporan ----------
create table if not exists public.issue_reports (
  id          bigint generated always as identity primary key,
  issue_id    bigint not null references public.issues (id) on delete cascade,
  note        text not null default '' check (char_length(note) <= 4000),
  created_by  uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now()
);
create index if not exists issue_reports_issue_idx on public.issue_reports (issue_id, created_at);
create index if not exists issue_reports_created_idx on public.issue_reports (created_at);

grant select, insert, update, delete on public.issue_reports to authenticated;
alter table public.issue_reports enable row level security;
drop policy if exists "reports_select" on public.issue_reports;
create policy "reports_select" on public.issue_reports for select to authenticated using (true);
-- semua role boleh menambah laporan (atas nama sendiri)
drop policy if exists "reports_insert" on public.issue_reports;
create policy "reports_insert" on public.issue_reports for insert to authenticated with check (created_by = auth.uid());
drop policy if exists "reports_update" on public.issue_reports;
create policy "reports_update" on public.issue_reports for update to authenticated
  using (created_by = auth.uid() or public.is_admin()) with check (created_by = auth.uid() or public.is_admin());
drop policy if exists "reports_delete" on public.issue_reports;
create policy "reports_delete" on public.issue_reports for delete to authenticated
  using (created_by = auth.uid() or public.is_admin());

-- laporan baru = topik ikut "terakhir update"
create or replace function public.issue_reports_touch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.issues set updated_at = now() where id = coalesce(new.issue_id, old.issue_id);
  return null;
end;
$$;
drop trigger if exists issue_reports_touch on public.issue_reports;
create trigger issue_reports_touch after insert or delete on public.issue_reports
  for each row execute function public.issue_reports_touch();

-- ---------- 2. Kontak per laporan ----------
alter table public.issue_contacts add column if not exists report_id bigint references public.issue_reports (id) on delete cascade;
create index if not exists issue_contacts_report_idx on public.issue_contacts (report_id);

-- role yang bukan penulis issue tetap boleh menambah kontak, asal untuk laporan miliknya sendiri
drop policy if exists "contacts_insert" on public.issue_contacts;
create policy "contacts_insert" on public.issue_contacts for insert to authenticated
  with check (
    public.can_write_issues()
    or (report_id is not null and exists (
      select 1 from public.issue_reports r
      where r.id = report_id and r.issue_id = issue_contacts.issue_id and r.created_by = auth.uid()))
  );

-- ---------- 3. Lampiran per laporan ----------
alter table public.attachments add column if not exists issue_report_id bigint references public.issue_reports (id) on delete cascade;
create index if not exists attachments_report_idx on public.attachments (issue_report_id);
alter table public.attachments drop constraint if exists attachments_one_parent;
alter table public.attachments add constraint attachments_one_parent
  check (num_nonnulls(issue_id, issue_note_id, suggestion_id, suggestion_comment_id, chat_message_id, issue_report_id) = 1);

drop policy if exists "attachments_insert" on public.attachments;
create policy "attachments_insert" on public.attachments
  for insert to authenticated
  with check (
    split_part(path, '/', 1) = auth.uid()::text
    and case
      when issue_report_id is not null then exists (
        select 1 from public.issue_reports r
        where r.id = issue_report_id and (r.created_by = auth.uid() or public.is_admin()))
      else public.can_attach(issue_id, issue_note_id, suggestion_id, suggestion_comment_id, chat_message_id)
    end
  );

-- ---------- 4. View list issue: jumlah laporan (laporan awal + laporan tambahan) ----------
create or replace view public.issue_list
with (security_invoker = on) as
select
  i.*,
  pic.full_name  as pic_name,
  cr.full_name   as created_by_name,
  up.full_name   as updated_by_name,
  coalesce(c.contacts, '[]'::jsonb)   as contacts,
  coalesce(c.contacts_text, '')       as contacts_text,
  coalesce(c.max_reports_30d, 0)      as max_contact_reports_30d,
  1 + coalesce(rp.n, 0)               as report_count,
  coalesce(rp.last_at, i.created_at)  as last_report_at
from public.issues i
left join public.profiles pic on pic.id = i.pic_id
left join public.profiles cr  on cr.id  = i.created_by
left join public.profiles up  on up.id  = i.updated_by
left join lateral (
  select
    jsonb_agg(
      jsonb_build_object(
        'id', ic.id,
        'type', ic.type,
        'value', ic.value,
        'normalized_value', ic.normalized_value,
        'report_id', ic.report_id,
        'issue_count', cs.issue_count,
        'issue_count_30d', cs.issue_count_30d
      ) order by ic.created_at
    )                                                as contacts,
    string_agg(ic.value || ' ' || ic.normalized_value, ' ') as contacts_text,
    max(cs.issue_count_30d)                          as max_reports_30d
  from public.issue_contacts ic
  join public.contact_stats cs
    on cs.type = ic.type and cs.normalized_value = ic.normalized_value
  where ic.issue_id = i.id
) c on true
left join lateral (
  select count(*)::int as n, max(r.created_at) as last_at
  from public.issue_reports r
  where r.issue_id = i.id
) rp on true;

-- ---------- 5. Kartu dashboard: HOT juga dihitung dari jumlah laporan ----------
drop function if exists public.dashboard_counts(int, timestamptz);
create or replace function public.dashboard_counts(p_hot_threshold int, p_today_start timestamptz, p_report_threshold int default 3)
returns json
language sql
stable
security invoker
set search_path = public
as $$
  select json_build_object(
    'open',           (select count(*) from public.issues where status = 'open'),
    'in_progress',    (select count(*) from public.issues where status = 'in_progress'),
    'urgent',         (select count(*) from public.issues where status <> 'resolved' and priority = 'urgent'),
    'hot',            (select count(*) from public.issue_list
                        where status <> 'resolved'
                          and (is_hot or max_contact_reports_30d >= p_hot_threshold or report_count >= p_report_threshold)),
    'resolved_today', (select count(*) from public.issues where status = 'resolved' and resolved_at >= p_today_start)
  );
$$;
grant execute on function public.dashboard_counts(int, timestamptz, int) to authenticated;

notify pgrst, 'reload schema';
