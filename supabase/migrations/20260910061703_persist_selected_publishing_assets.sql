alter table public.assets
  add column selected_for_publishing boolean not null default true;

comment on column public.assets.selected_for_publishing is
  'Whether this task asset is included in the manual Xiaohongshu publishing package.';
