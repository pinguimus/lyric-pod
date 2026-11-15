-- Lyric Pod: configuración de Supabase
-- Pégalo completo en Supabase › SQL Editor › New query y pulsa Run.
-- Es seguro ejecutarlo más de una vez.

-- ============ Tabla de canciones ============
create table if not exists public.songs (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  owner      uuid not null default auth.uid(),
  title      text not null check (char_length(title) between 1 and 120),
  artist     text not null default 'Artista desconocido' check (char_length(artist) between 1 and 120),
  audio_path text not null,
  cover_path text,
  lyrics     text not null default '' check (char_length(lyrics) <= 20000),
  duration   numeric,
  reports    int not null default 0,
  hidden     boolean not null default false
);
create index if not exists songs_created_idx on public.songs (created_at desc);
alter table public.songs enable row level security;

-- Permisos: cualquiera lee; solo quien sube puede borrar lo suyo.
revoke all on public.songs from anon, authenticated;
grant select on public.songs to anon, authenticated;
grant insert (title, artist, audio_path, cover_path, lyrics, duration) on public.songs to authenticated;
grant delete on public.songs to authenticated;

drop policy if exists "ver canciones" on public.songs;
create policy "ver canciones" on public.songs
  for select using (hidden = false or owner = auth.uid());

drop policy if exists "subir canciones" on public.songs;
create policy "subir canciones" on public.songs
  for insert to authenticated with check (owner = auth.uid());

drop policy if exists "borrar las propias" on public.songs;
create policy "borrar las propias" on public.songs
  for delete to authenticated using (owner = auth.uid());

-- ============ Límite de subidas por usuario (10) ============
create or replace function public.limit_uploads() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.songs where owner = new.owner) >= 10 then
    raise exception 'Límite de 10 canciones por usuario';
  end if;
  return new;
end $$;

drop trigger if exists songs_limit on public.songs;
create trigger songs_limit before insert on public.songs
  for each row execute function public.limit_uploads();

-- ============ Reportes: con 5 reportes la canción se oculta ============
-- Tú puedes volver a mostrarla desde Table Editor (hidden = false).
create or replace function public.report_song(song_id uuid) returns void
language sql security definer set search_path = public as $$
  update public.songs
     set reports = reports + 1,
         hidden  = hidden or (reports + 1 >= 5)
   where id = song_id;
$$;
revoke all on function public.report_song(uuid) from public;
grant execute on function public.report_song(uuid) to anon, authenticated;

-- ============ Almacenamiento (archivos) ============
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('songs',  'songs',  true, 20971520,
    array['audio/mpeg','audio/mp4','audio/aac','audio/wav','audio/ogg','audio/opus','audio/flac','audio/webm']),
  ('covers', 'covers', true, 2097152,
    array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Cada persona solo escribe y borra dentro de su propia carpeta (su id).
drop policy if exists "lyricpod subir a su carpeta" on storage.objects;
create policy "lyricpod subir a su carpeta" on storage.objects
  for insert to authenticated
  with check (bucket_id in ('songs','covers') and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "lyricpod borrar de su carpeta" on storage.objects;
create policy "lyricpod borrar de su carpeta" on storage.objects
  for delete to authenticated
  using (bucket_id in ('songs','covers') and (storage.foldername(name))[1] = auth.uid()::text);
