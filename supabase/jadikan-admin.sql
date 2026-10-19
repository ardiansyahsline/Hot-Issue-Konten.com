-- Jalankan SETELAH kamu bikin akun sendiri di Authentication > Users > Add user.
-- Ganti email di bawah dengan email kamu.
update public.profiles
set role = 'admin', full_name = 'Nick'
where email = 'nickcllauss.yohanes@orovagroup.id';

-- (opsional) supaya role ikut tersimpan di metadata akun
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'
where email = 'nickcllauss.yohanes@orovagroup.id';

select id, email, full_name, role from public.profiles;
