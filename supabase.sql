-- =====================================================================
--  JUEGO DE REPOSICIÓN - BASE DE DATOS (versión 3.1: con bots)
--  Pegar TODO este archivo en Supabase > SQL Editor > Run.
--  Se puede ejecutar más de una vez sin error.
-- =====================================================================

-- ---------- TABLAS ----------
create table if not exists salas (
  codigo text primary key,
  estado text not null default 'espera',          -- espera | jugando | terminado
  total_rondas int not null default 30,
  segundos int not null default 60,
  semilla int not null,
  anfitrion uuid not null,                        -- secreto: nunca se expone
  iniciada_en timestamptz,
  creada_en timestamptz not null default now()
);

create table if not exists jugadores (
  sala text not null references salas(codigo) on delete cascade,
  id uuid not null,                               -- secreto: nunca se expone
  nombre text not null,
  equipo text,                                    -- A | B (se asigna al iniciar)
  rol text,                                       -- fabrica | distribuidor | tienda
  es_anfitrion boolean not null default false,
  unido_en timestamptz not null default now(),
  primary key (sala, id)
);
alter table jugadores add column if not exists es_anfitrion boolean not null default false;
alter table jugadores add column if not exists es_bot boolean not null default false;

create table if not exists rondas (
  sala text not null references salas(codigo) on delete cascade,
  numero int not null,
  cerrada_en timestamptz not null default now(),
  primary key (sala, numero)
);

create table if not exists decisiones (
  sala text not null references salas(codigo) on delete cascade,
  ronda int not null,
  jugador uuid not null,                          -- secreto: nunca se expone
  equipo text,
  rol text,
  payload jsonb not null,
  enviada_en timestamptz not null default now(),
  primary key (sala, ronda, jugador)
);
alter table decisiones add column if not exists equipo text;
alter table decisiones add column if not exists rol text;

-- Tabla de versiones anteriores (decisiones conjuntas), ya no se usa
drop table if exists conjuntas;
drop function if exists enviar_conjuntas(text, uuid, int, jsonb);

-- ---------- FUNCIONES AUXILIARES ----------
create or replace function ronda_actual(p_codigo text) returns int
language sql stable as $$
  select coalesce(max(numero), 0) + 1 from rondas where sala = p_codigo;
$$;

create or replace function inicio_ronda(p_codigo text, p_ronda int) returns timestamptz
language sql stable as $$
  select case when p_ronda = 1
              then (select iniciada_en from salas where codigo = p_codigo)
              else (select cerrada_en from rondas where sala = p_codigo and numero = p_ronda - 1)
         end;
$$;

-- Valida que el jugador pueda enviar en esta semana y devuelve su equipo
create or replace function validar_envio(p_codigo text, p_jugador uuid, p_ronda int) returns text
language plpgsql security definer set search_path = public as $$
declare
  s salas%rowtype;
  eq text;
  r int;
  fin timestamptz;
begin
  perform pg_advisory_xact_lock(hashtext(p_codigo));
  select * into s from salas where codigo = p_codigo;
  if not found or s.estado <> 'jugando' then
    raise exception 'La partida no está en curso';
  end if;
  select equipo into eq from jugadores
    where sala = p_codigo and id = p_jugador and rol is not null;
  if eq is null then
    raise exception 'No estás en esta partida';
  end if;
  r := ronda_actual(p_codigo);
  if r > s.total_rondas then
    raise exception 'La partida ya terminó';
  end if;
  if p_ronda <> r then
    raise exception 'La semana ya cambió, revisa la pantalla';
  end if;
  fin := inicio_ronda(p_codigo, r) + make_interval(secs => s.segundos);
  if now() >= fin then
    raise exception 'Se acabó el tiempo de esta semana';
  end if;
  return eq;
end $$;

-- ---------- FUNCIONES PÚBLICAS (las usa la app) ----------
create or replace function crear_sala(p_nombre text, p_jugador uuid, p_rondas int, p_segundos int)
returns text
language plpgsql security definer set search_path = public as $$
declare
  letras text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  c text;
  i int;
begin
  if trim(coalesce(p_nombre, '')) = '' then raise exception 'Escribe tu nombre'; end if;
  if length(trim(p_nombre)) > 20 then raise exception 'El nombre tiene más de 20 letras'; end if;
  if p_rondas < 5 or p_rondas > 60 then raise exception 'Las semanas deben estar entre 5 y 60'; end if;
  if p_segundos < 20 or p_segundos > 180 then raise exception 'Los segundos deben estar entre 20 y 180'; end if;
  loop
    c := '';
    for i in 1..4 loop
      c := c || substr(letras, 1 + floor(random() * length(letras))::int, 1);
    end loop;
    exit when not exists (select 1 from salas where codigo = c);
  end loop;
  insert into salas (codigo, total_rondas, segundos, semilla, anfitrion)
  values (c, p_rondas, p_segundos, floor(random() * 2000000000)::int, p_jugador);
  insert into jugadores (sala, id, nombre, es_anfitrion) values (c, p_jugador, trim(p_nombre), true);
  return c;
end $$;

create or replace function unirse_sala(p_codigo text, p_jugador uuid, p_nombre text)
returns void
language plpgsql security definer set search_path = public as $$
declare s salas%rowtype;
begin
  if trim(coalesce(p_nombre, '')) = '' then raise exception 'Escribe tu nombre'; end if;
  if length(trim(p_nombre)) > 20 then raise exception 'El nombre tiene más de 20 letras'; end if;
  select * into s from salas where codigo = upper(trim(p_codigo));
  if not found then raise exception 'La sala no existe'; end if;
  -- Un solo jugador a la vez por sala: evita que dos uniones entren en el último lugar
  perform pg_advisory_xact_lock(hashtext(s.codigo));
  if exists (select 1 from jugadores where sala = s.codigo and id = p_jugador) then
    return;
  end if;
  if s.estado <> 'espera' then raise exception 'La partida ya empezó'; end if;
  if (select count(*) from jugadores where sala = s.codigo) >= 6 then
    -- Sala llena: una persona le quita el lugar a un bot (el último que se agregó)
    if exists (select 1 from jugadores where sala = s.codigo and es_bot) then
      delete from jugadores where sala = s.codigo and id = (
        select id from jugadores where sala = s.codigo and es_bot order by nombre desc limit 1);
    else
      raise exception 'La sala ya tiene 6 jugadores';
    end if;
  end if;
  insert into jugadores (sala, id, nombre) values (s.codigo, p_jugador, trim(p_nombre));
end $$;

-- BOTS: el anfitrión llena con bots los lugares vacíos (mientras la sala está en espera).
-- Los bots son jugadores con id secreto; las decisiones las envían los celulares de las personas.
create or replace function completar_bots(p_codigo text, p_jugador uuid)
returns int
language plpgsql security definer set search_path = public as $$
declare
  s salas%rowtype;
  falta int;
  k int;
begin
  perform pg_advisory_xact_lock(hashtext(p_codigo));
  select * into s from salas where codigo = p_codigo;
  if not found then raise exception 'La sala no existe'; end if;
  if s.anfitrion <> p_jugador then raise exception 'Solo quien creó la sala puede agregar bots'; end if;
  if s.estado <> 'espera' then raise exception 'La partida ya empezó'; end if;
  falta := 6 - (select count(*) from jugadores where sala = p_codigo);
  if falta <= 0 then return 0; end if;
  for k in 1..falta loop
    insert into jugadores (sala, id, nombre, es_bot, unido_en)
    values (p_codigo, gen_random_uuid(),
            'Bot ' || ((select count(*) from jugadores where sala = p_codigo and es_bot) + 1),
            true, clock_timestamp());
  end loop;
  return falta;
end $$;

-- Quita todos los bots de la sala (mientras está en espera)
create or replace function quitar_bots(p_codigo text, p_jugador uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare s salas%rowtype;
begin
  perform pg_advisory_xact_lock(hashtext(p_codigo));
  select * into s from salas where codigo = p_codigo;
  if not found then raise exception 'La sala no existe'; end if;
  if s.anfitrion <> p_jugador then raise exception 'Solo quien creó la sala puede quitar bots'; end if;
  if s.estado <> 'espera' then raise exception 'La partida ya empezó'; end if;
  delete from jugadores where sala = p_codigo and es_bot;
end $$;

-- Salir de la sala mientras está en espera. Si sale el anfitrión, se cierra la sala.
create or replace function salir_sala(p_codigo text, p_jugador uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare s salas%rowtype;
begin
  perform pg_advisory_xact_lock(hashtext(p_codigo));
  select * into s from salas where codigo = p_codigo;
  if not found then return; end if;
  if s.estado <> 'espera' then raise exception 'La partida ya empezó; no se puede salir'; end if;
  if s.anfitrion = p_jugador then
    delete from salas where codigo = p_codigo;
  else
    delete from jugadores where sala = p_codigo and id = p_jugador;
  end if;
end $$;

create or replace function iniciar_sala(p_codigo text, p_jugador uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare s salas%rowtype;
begin
  select * into s from salas where codigo = p_codigo;
  if not found then raise exception 'La sala no existe'; end if;
  if s.anfitrion <> p_jugador then raise exception 'Solo quien creó la sala puede iniciar'; end if;
  if s.estado <> 'espera' then raise exception 'La partida ya empezó'; end if;
  if (select count(*) from jugadores where sala = p_codigo) <> 6 then
    raise exception 'Se necesitan exactamente 6 jugadores';
  end if;
  -- Sortea equipos (3 y 3) y roles dentro de cada equipo
  with base as (
    select id, row_number() over (order by random()) as n
    from jugadores where sala = p_codigo
  ), con_equipo as (
    select id, case when n <= 3 then 'A' else 'B' end as equipo from base
  ), con_rol as (
    select id, equipo, row_number() over (partition by equipo order by random()) as k
    from con_equipo
  )
  update jugadores j
  set equipo = c.equipo,
      rol = case c.k when 1 then 'fabrica' when 2 then 'distribuidor' else 'tienda' end
  from con_rol c
  where j.sala = p_codigo and j.id = c.id;

  update salas set estado = 'jugando', iniciada_en = now() where codigo = p_codigo;
end $$;

create or replace function enviar_decision(p_codigo text, p_jugador uuid, p_ronda int, p_payload jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare
  eq text;
  ro text;
begin
  if octet_length(p_payload::text) > 20000 then raise exception 'La decisión es demasiado grande'; end if;
  perform validar_envio(p_codigo, p_jugador, p_ronda);
  select equipo, rol into eq, ro from jugadores where sala = p_codigo and id = p_jugador;
  insert into decisiones (sala, ronda, jugador, equipo, rol, payload, enviada_en)
  values (p_codigo, p_ronda, p_jugador, eq, ro, p_payload, now())
  on conflict (sala, ronda, jugador)
  do update set payload = excluded.payload, enviada_en = now();
end $$;

-- Cierra la semana actual si los 6 ya decidieron o si se acabó el tiempo.
-- Cualquier celular puede llamarla; la primera que cumple la condición gana.
create or replace function cerrar_ronda(p_codigo text) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  s salas%rowtype;
  r int;
  votos int;
  fin timestamptz;
begin
  perform pg_advisory_xact_lock(hashtext(p_codigo));
  select * into s from salas where codigo = p_codigo;
  if not found or s.estado <> 'jugando' then return false; end if;
  r := ronda_actual(p_codigo);
  if r > s.total_rondas then return false; end if;
  select count(*) into votos from decisiones where sala = p_codigo and ronda = r;
  fin := inicio_ronda(p_codigo, r) + make_interval(secs => s.segundos);
  if votos < 6 and now() < fin then return false; end if;
  insert into rondas (sala, numero, cerrada_en) values (p_codigo, r, now());
  if r >= s.total_rondas then
    update salas set estado = 'terminado' where codigo = p_codigo;
  end if;
  return true;
end $$;

-- Datos propios del jugador (solo quien conoce su id puede pedirlos)
create or replace function mi_jugador(p_codigo text, p_jugador uuid) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object('nombre', nombre, 'equipo', equipo, 'rol', rol, 'es_anfitrion', es_anfitrion)
  from jugadores where sala = p_codigo and id = p_jugador;
$$;

-- Decisión propia de una semana (la de la semana en curso sigue oculta para los demás)
create or replace function mi_decision(p_codigo text, p_jugador uuid, p_ronda int) returns jsonb
language sql stable security definer set search_path = public as $$
  select payload from decisiones where sala = p_codigo and jugador = p_jugador and ronda = p_ronda;
$$;

-- Bots que todavía no decidieron esta semana. Solo la piden las personas de la partida;
-- cada celular calcula la decisión del bot (siempre la misma) y la envía con enviar_decision.
create or replace function bots_pendientes(p_codigo text, p_jugador uuid) returns json
language plpgsql stable security definer set search_path = public as $$
declare
  s salas%rowtype;
  r int;
begin
  select * into s from salas where codigo = p_codigo;
  if not found or s.estado <> 'jugando' then return '[]'::json; end if;
  if not exists (select 1 from jugadores
                 where sala = p_codigo and id = p_jugador and rol is not null and not es_bot) then
    return '[]'::json;
  end if;
  r := ronda_actual(p_codigo);
  if r > s.total_rondas then return '[]'::json; end if;
  return coalesce((
    select json_agg(json_build_object('id', j.id, 'equipo', j.equipo, 'rol', j.rol, 'ronda', r))
    from jugadores j
    where j.sala = p_codigo and j.es_bot and j.rol is not null
      and not exists (select 1 from decisiones d
                      where d.sala = p_codigo and d.ronda = r and d.jugador = j.id)
  ), '[]'::json);
end $$;

-- Estado de la semana en curso: número, cuántos decidieron, cuándo termina
create or replace function estado_semana(p_codigo text) returns json
language plpgsql stable security definer set search_path = public as $$
declare
  s salas%rowtype;
  r int;
  v int;
begin
  select * into s from salas where codigo = p_codigo;
  if not found then return null; end if;
  r := ronda_actual(p_codigo);
  select count(*) into v from decisiones where sala = p_codigo and ronda = r;
  return json_build_object(
    'ronda', r,
    'total', s.total_rondas,
    'votos', v,
    'fin', inicio_ronda(p_codigo, r) + make_interval(secs => s.segundos)
  );
end $$;

-- ---------- SEGURIDAD ----------
-- Nadie escribe directamente en las tablas: solo las funciones de arriba.
-- La lectura es por columnas: los ids y el anfitrión nunca salen al público.
alter table salas enable row level security;
alter table jugadores enable row level security;
alter table rondas enable row level security;
alter table decisiones enable row level security;

revoke all on salas, jugadores, rondas, decisiones from anon, authenticated;
grant select (codigo, estado, total_rondas, segundos, semilla, iniciada_en, creada_en)
  on salas to anon, authenticated;
grant select (sala, nombre, equipo, rol, unido_en, es_anfitrion, es_bot)
  on jugadores to anon, authenticated;
grant select (sala, numero, cerrada_en)
  on rondas to anon, authenticated;
grant select (sala, ronda, equipo, rol, payload, enviada_en)
  on decisiones to anon, authenticated;

drop policy if exists "lectura salas" on salas;
drop policy if exists "lectura jugadores" on jugadores;
drop policy if exists "lectura rondas" on rondas;
drop policy if exists "lectura decisiones" on decisiones;
drop policy if exists "lectura decisiones cerradas" on decisiones;

create policy "lectura salas" on salas for select using (true);
create policy "lectura jugadores" on jugadores for select using (true);
create policy "lectura rondas" on rondas for select using (true);
-- Las decisiones solo se pueden leer cuando su semana ya cerró (pujas secretas)
create policy "lectura decisiones cerradas" on decisiones for select
  using (ronda < ronda_actual(sala));
