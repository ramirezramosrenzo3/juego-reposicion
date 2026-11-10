-- =====================================================================
--  JUEGO DE REPOSICIÓN - BASE DE DATOS (versión 4.2.2: eventos aleatorios)
--  Pegar TODO este archivo en Supabase > SQL Editor > Run.
--  Se puede ejecutar más de una vez sin error y no borra partidas.
-- =====================================================================

-- ---------- TABLAS ----------
create table if not exists salas (
  codigo text primary key,
  estado text not null default 'espera',          -- espera | eleccion | jugando | terminado
  total_rondas int not null default 30,
  segundos int not null default 60,
  semilla int not null,
  anfitrion uuid not null,                        -- secreto: nunca se expone
  iniciada_en timestamptz,
  creada_en timestamptz not null default now()
);
alter table salas add column if not exists eleccion_fin timestamptz;

create table if not exists jugadores (
  sala text not null references salas(codigo) on delete cascade,
  id uuid not null,                               -- secreto: nunca se expone
  nombre text not null,
  equipo text,                                    -- A | B (lo elige cada jugador o se sortea)
  rol text,                                       -- fabrica | distribuidor | tienda
  es_anfitrion boolean not null default false,
  unido_en timestamptz not null default now(),
  primary key (sala, id)
);
alter table jugadores add column if not exists es_anfitrion boolean not null default false;
alter table jugadores add column if not exists es_bot boolean not null default false;
alter table jugadores add column if not exists avatar smallint;              -- 1 a 16
alter table jugadores add column if not exists confirmado_en timestamptz;    -- cuándo eligió su puesto (secreto)
-- Un puesto (equipo + rol) solo puede tenerlo un jugador por sala
create unique index if not exists puesto_unico on jugadores (sala, equipo, rol)
  where equipo is not null and rol is not null;

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

-- Tiempo extra de una semana (los 15 s de la presentación de un evento aleatorio)
create table if not exists extras (
  sala text not null references salas(codigo) on delete cascade,
  ronda int not null,
  segs int not null,
  primary key (sala, ronda)
);

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

-- Margen después del cronómetro: una decisión que llega justo al acabar el tiempo todavía cuenta
-- (así el envío automático de los últimos segundos no se pierde por la demora de internet)
create or replace function gracia_envio() returns interval
language sql immutable as $$ select interval '3 seconds' $$;

-- Momento en que termina una semana: inicio + segundos de la sala + tiempo extra (eventos)
create or replace function fin_ronda(p_codigo text, p_ronda int) returns timestamptz
language sql stable as $$
  select inicio_ronda(p_codigo, p_ronda)
         + make_interval(secs => (select segundos from salas where codigo = p_codigo)
                                 + coalesce((select segs from extras where sala = p_codigo and ronda = p_ronda), 0));
$$;

-- Un avatar libre de la sala (si el preferido está libre, ese)
create or replace function avatar_libre(p_codigo text, p_preferido int default null) returns int
language plpgsql stable set search_path = public as $$
declare a int;
begin
  if p_preferido between 1 and 16
     and not exists (select 1 from jugadores where sala = p_codigo and avatar = p_preferido) then
    return p_preferido;
  end if;
  select n into a from generate_series(1, 16) n
    where not exists (select 1 from jugadores where sala = p_codigo and avatar = n)
    order by random() limit 1;
  return a;
end $$;

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
  fin := fin_ronda(p_codigo, r);
  if now() >= fin + gracia_envio() then
    raise exception 'Se acabó el tiempo de esta semana';
  end if;
  return eq;
end $$;

-- ---------- FUNCIONES PÚBLICAS (las usa la app) ----------
drop function if exists crear_sala(text, uuid, int, int);
create or replace function crear_sala(p_nombre text, p_jugador uuid, p_rondas int, p_segundos int, p_avatar int default null)
returns text
language plpgsql security definer set search_path = public as $$
declare
  letras text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  c text;
  i int;
begin
  if trim(coalesce(p_nombre, '')) = '' then raise exception 'Escribe tu nombre'; end if;
  if length(trim(p_nombre)) > 20 then raise exception 'El nombre tiene más de 20 letras'; end if;
  if p_avatar is not null and (p_avatar < 1 or p_avatar > 16) then raise exception 'Avatar no válido'; end if;
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
  insert into jugadores (sala, id, nombre, es_anfitrion, avatar)
  values (c, p_jugador, trim(p_nombre), true, coalesce(p_avatar, 1 + floor(random() * 16)::int));
  return c;
end $$;

drop function if exists unirse_sala(text, uuid, text);
create or replace function unirse_sala(p_codigo text, p_jugador uuid, p_nombre text, p_avatar int default null)
returns void
language plpgsql security definer set search_path = public as $$
declare s salas%rowtype;
begin
  if trim(coalesce(p_nombre, '')) = '' then raise exception 'Escribe tu nombre'; end if;
  if length(trim(p_nombre)) > 20 then raise exception 'El nombre tiene más de 20 letras'; end if;
  if p_avatar is not null and (p_avatar < 1 or p_avatar > 16) then raise exception 'Avatar no válido'; end if;
  select * into s from salas where codigo = upper(trim(p_codigo));
  if not found then raise exception 'La sala no existe'; end if;
  -- Un solo jugador a la vez por sala: evita que dos uniones entren en el último lugar
  perform pg_advisory_xact_lock(hashtext(s.codigo));
  if exists (select 1 from jugadores where sala = s.codigo and id = p_jugador) then
    return;
  end if;
  if s.estado <> 'espera' then raise exception 'La partida ya empezó'; end if;
  -- Una persona no puede repetir el avatar de otra persona
  if p_avatar is not null and exists (
       select 1 from jugadores where sala = s.codigo and avatar = p_avatar and not es_bot) then
    raise exception 'Ese avatar ya lo eligió otra persona en esta sala. Elige otro.';
  end if;
  if (select count(*) from jugadores where sala = s.codigo) >= 6 then
    -- Sala llena: una persona le quita el lugar a un bot (el último que se agregó)
    if exists (select 1 from jugadores where sala = s.codigo and es_bot) then
      delete from jugadores where sala = s.codigo and id = (
        select id from jugadores where sala = s.codigo and es_bot order by nombre desc limit 1);
    else
      raise exception 'La sala ya tiene 6 jugadores';
    end if;
  end if;
  -- Si un bot tiene ese avatar, el bot cambia a otro
  if p_avatar is not null then
    update jugadores b
    set avatar = (select n from generate_series(1, 16) n
                  where n <> p_avatar
                    and not exists (select 1 from jugadores x where x.sala = s.codigo and x.avatar = n)
                  order by random() limit 1)
    where b.sala = s.codigo and b.es_bot and b.avatar = p_avatar;
  end if;
  insert into jugadores (sala, id, nombre, avatar)
  values (s.codigo, p_jugador, trim(p_nombre), coalesce(p_avatar, avatar_libre(s.codigo)));
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
    insert into jugadores (sala, id, nombre, es_bot, unido_en, avatar)
    values (p_codigo, gen_random_uuid(),
            'Bot ' || ((select count(*) from jugadores where sala = p_codigo and es_bot) + 1),
            true, clock_timestamp(), avatar_libre(p_codigo));
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

-- Iniciar: abre 2 minutos para que cada jugador elija su equipo y su puesto
create or replace function iniciar_sala(p_codigo text, p_jugador uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare s salas%rowtype;
begin
  perform pg_advisory_xact_lock(hashtext(p_codigo));
  select * into s from salas where codigo = p_codigo;
  if not found then raise exception 'La sala no existe'; end if;
  if s.anfitrion <> p_jugador then raise exception 'Solo quien creó la sala puede iniciar'; end if;
  if s.estado <> 'espera' then raise exception 'La partida ya empezó'; end if;
  if (select count(*) from jugadores where sala = p_codigo) <> 6 then
    raise exception 'Se necesitan exactamente 6 jugadores';
  end if;
  update jugadores set equipo = null, rol = null, confirmado_en = null where sala = p_codigo;
  update salas set estado = 'eleccion', eleccion_fin = now() + interval '120 seconds'
  where codigo = p_codigo;
end $$;

-- Elegir (o cambiar) puesto. El primero en confirmar un puesto lo bloquea para los demás.
create or replace function elegir_puesto(p_codigo text, p_jugador uuid, p_equipo text, p_rol text)
returns void
language plpgsql security definer set search_path = public as $$
declare s salas%rowtype;
begin
  perform pg_advisory_xact_lock(hashtext(p_codigo));
  select * into s from salas where codigo = p_codigo;
  if not found or s.estado <> 'eleccion' then raise exception 'Ahora no se están eligiendo puestos'; end if;
  if now() >= s.eleccion_fin then raise exception 'Se acabó el tiempo para elegir'; end if;
  if p_equipo not in ('A', 'B') or p_rol not in ('fabrica', 'distribuidor', 'tienda') then
    raise exception 'Puesto no válido';
  end if;
  if not exists (select 1 from jugadores where sala = p_codigo and id = p_jugador and not es_bot) then
    raise exception 'No estás en esta sala';
  end if;
  if exists (select 1 from jugadores
             where sala = p_codigo and equipo = p_equipo and rol = p_rol and id <> p_jugador) then
    raise exception 'Ese puesto ya lo tomó otro jugador';
  end if;
  update jugadores set equipo = p_equipo, rol = p_rol, confirmado_en = clock_timestamp()
  where sala = p_codigo and id = p_jugador;
end $$;

-- Desbloquear el puesto propio para poder cambiar
create or replace function liberar_puesto(p_codigo text, p_jugador uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare s salas%rowtype;
begin
  perform pg_advisory_xact_lock(hashtext(p_codigo));
  select * into s from salas where codigo = p_codigo;
  if not found or s.estado <> 'eleccion' then raise exception 'Ahora no se están eligiendo puestos'; end if;
  update jugadores set equipo = null, rol = null, confirmado_en = null
  where sala = p_codigo and id = p_jugador and not es_bot;
end $$;

-- Cierra la elección: cuando se acaba el tiempo, o 4 segundos después de que todas las personas
-- eligieron. Quien no eligió y los bots reciben al azar los puestos que quedan. Empieza la semana 1.
create or replace function cerrar_eleccion(p_codigo text) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  s salas%rowtype;
  todos boolean;
  ultimo timestamptz;
begin
  perform pg_advisory_xact_lock(hashtext(p_codigo));
  select * into s from salas where codigo = p_codigo;
  if not found or s.estado <> 'eleccion' then return false; end if;
  select bool_and(equipo is not null), max(confirmado_en) into todos, ultimo
  from jugadores where sala = p_codigo and not es_bot;
  if not (now() >= s.eleccion_fin
          or (coalesce(todos, false) and now() >= ultimo + interval '4 seconds')) then
    return false;
  end if;
  with libres as (
    select e.equipo, r.rol, row_number() over (order by random()) as n
    from (values ('A'), ('B')) as e(equipo)
    cross join (values ('fabrica'), ('distribuidor'), ('tienda')) as r(rol)
    where not exists (select 1 from jugadores j
                      where j.sala = p_codigo and j.equipo = e.equipo and j.rol = r.rol)
  ), sin_puesto as (
    select id, row_number() over (order by random()) as n
    from jugadores where sala = p_codigo and equipo is null
  )
  update jugadores j
  set equipo = lb.equipo, rol = lb.rol
  from sin_puesto sp join libres lb on lb.n = sp.n
  where j.sala = p_codigo and j.id = sp.id;
  update salas set estado = 'jugando', iniciada_en = now() where codigo = p_codigo;
  return true;
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
  -- La decisión de un bot no se puede pisar: la primera que llega es la que vale
  if exists (select 1 from jugadores where sala = p_codigo and id = p_jugador and es_bot)
     and exists (select 1 from decisiones where sala = p_codigo and ronda = p_ronda and jugador = p_jugador) then
    return;
  end if;
  insert into decisiones (sala, ronda, jugador, equipo, rol, payload, enviada_en)
  values (p_codigo, p_ronda, p_jugador, eq, ro, p_payload, now())
  on conflict (sala, ronda, jugador)
  do update set payload = excluded.payload, enviada_en = now();
end $$;

-- Cierra la semana actual si los 6 ya decidieron o si se acabó el tiempo (más el pequeño margen).
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
  fin := fin_ronda(p_codigo, r);
  if votos < 6 and now() < fin + gracia_envio() then return false; end if;
  insert into rondas (sala, numero, cerrada_en) values (p_codigo, r, now());
  if r >= s.total_rondas then
    update salas set estado = 'terminado' where codigo = p_codigo;
  end if;
  return true;
end $$;

-- Datos propios del jugador (solo quien conoce su id puede pedirlos)
create or replace function mi_jugador(p_codigo text, p_jugador uuid) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object('nombre', nombre, 'equipo', equipo, 'rol', rol,
                           'es_anfitrion', es_anfitrion, 'avatar', avatar)
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

-- Un evento aleatorio da 15 segundos extra a la semana (para su presentación obligatoria).
-- Cualquier celular de la partida puede pedirlo; solo se aplica una vez por semana.
create or replace function extender_ronda(p_codigo text, p_jugador uuid, p_ronda int) returns void
language plpgsql security definer set search_path = public as $$
declare s salas%rowtype;
begin
  perform pg_advisory_xact_lock(hashtext(p_codigo));
  select * into s from salas where codigo = p_codigo;
  if not found or s.estado <> 'jugando' then return; end if;
  if not exists (select 1 from jugadores where sala = p_codigo and id = p_jugador and rol is not null and not es_bot) then return; end if;
  if p_ronda <> ronda_actual(p_codigo) or p_ronda > s.total_rondas then return; end if;
  insert into extras (sala, ronda, segs) values (p_codigo, p_ronda, 15) on conflict do nothing;
end $$;

-- Estado de la semana en curso: número, cuántos decidieron (y quiénes: solo "equipo:rol"),
-- cuándo termina y la hora del servidor (para que el cronómetro de todos coincida)
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
    'inicio', inicio_ronda(p_codigo, r),
    'fin', fin_ronda(p_codigo, r),
    'extra', coalesce((select segs from extras where sala = p_codigo and ronda = r), 0),
    'ahora', clock_timestamp(),
    'listos', coalesce((select json_agg(d.equipo || ':' || d.rol)
                        from decisiones d
                        where d.sala = p_codigo and d.ronda = r and d.equipo is not null), '[]'::json)
  );
end $$;

-- ---------- SEGURIDAD ----------
-- Nadie escribe directamente en las tablas: solo las funciones de arriba.
-- La lectura es por columnas: los ids y el anfitrión nunca salen al público.
alter table salas enable row level security;
alter table jugadores enable row level security;
alter table rondas enable row level security;
alter table decisiones enable row level security;
alter table extras enable row level security;

revoke all on salas, jugadores, rondas, decisiones, extras from anon, authenticated;
grant select (codigo, estado, total_rondas, segundos, semilla, iniciada_en, creada_en, eleccion_fin)
  on salas to anon, authenticated;
grant select (sala, nombre, equipo, rol, unido_en, es_anfitrion, es_bot, avatar)
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
