-- ─── Photos des factures fournisseur (achats Lavage / Cafétéria) ──────────────
-- Bucket public `purchase-invoices` : l'achat ne garde que l'URL de l'image.
-- Les images arrivent déjà compressées par l'application (WebP/JPEG, ~2000 px,
-- < 450 Ko) ; la limite de 5 Mo n'est qu'un garde-fou côté serveur.
-- Rejouable sans risque.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('purchase-invoices', 'purchase-invoices', true, 5242880,
        array['image/webp', 'image/jpeg', 'image/png', 'image/heic', 'image/heif'])
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists pi_public_read  on storage.objects;
drop policy if exists pi_auth_insert  on storage.objects;
drop policy if exists pi_auth_update  on storage.objects;
drop policy if exists pi_auth_delete  on storage.objects;

create policy pi_public_read on storage.objects for select to public
  using (bucket_id = 'purchase-invoices');
create policy pi_auth_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'purchase-invoices');
create policy pi_auth_update on storage.objects for update to authenticated
  using (bucket_id = 'purchase-invoices');
create policy pi_auth_delete on storage.objects for delete to authenticated
  using (bucket_id = 'purchase-invoices');
