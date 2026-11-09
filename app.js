/*
  INTERFAZ DEL JUEGO (versión 3.2: avatares, elección de puesto, cronómetro fijo, camiones)
  Se conecta a Supabase (salas y decisiones) y usa game.js (las reglas) y avatares.js (los 16 avatares).
  Cada celular refresca cada 1.2 segundos y recalcula el estado completo.
*/
(function () {
  'use strict';

  if (!window.supabase || !window.CONFIG_SUPABASE || !window.JuegoReposicion) {
    document.getElementById('app').innerHTML =
      '<section class="card"><h1>No se pudo cargar el juego</h1>' +
      '<p class="ayuda">Revisa tu conexión a internet y que config.js tenga tus claves de Supabase.</p></section>';
    return;
  }

  const JR = window.JuegoReposicion;
  const C = window.CONFIG_SUPABASE;
  const { PRODUCTOS, CALIDADES, INFLUENCERS, INF_KEYS, CONFIG } = JR;
  const AVATARES = window.AVATARES || [];
  const sb = window.supabase.createClient(C.url, C.anonKey);
  const app = document.getElementById('app');

  const EQ = { A: "G'sertte", B: 'Gallecolors' };
  const ROLES = ['fabrica', 'distribuidor', 'tienda'];
  const ROLN = { fabrica: 'Fábrica', distribuidor: 'Distribuidor', tienda: 'Tienda final' };
  const ROLI = { fabrica: '🏭', distribuidor: '🏬', tienda: '🛍️' };
  const RES = {
    gano: '<span class="pos">✔ Ganaste</span>',
    perdio: '<span class="neg">✖ Perdiste</span>',
    ocupado: 'Estaba ocupado esa semana',
    sin_puja: 'No pujaste',
  };
  // Solo las columnas que la base permite leer (los ids y el anfitrión son secretos)
  const COLS_SALA = 'codigo,estado,total_rondas,segundos,semilla,iniciada_en,creada_en,eleccion_fin';
  const COLS_JUG = 'sala,nombre,equipo,rol,unido_en,es_anfitrion,es_bot,avatar';
  const COLS_RON = 'sala,numero,cerrada_en';
  const COLS_DEC = 'sala,ronda,equipo,rol,payload,enviada_en';
  const SEG_ELECCION = 120;

  // ---------- ESTADO LOCAL ----------
  const guardado = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const guardar = (k, v) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* sin almacenamiento */ } };
  let jugadorId = guardado('jugadorId');
  if (!jugadorId) {
    jugadorId = crypto.randomUUID();
    guardar('jugadorId', jugadorId);
  }
  let nombre = guardado('nombre') || '';
  let avatarSel = Number(guardado('avatar')) || 0;
  let sala = guardado('sala') || null;
  const codigoUrl = (new URLSearchParams(location.search).get('sala') || '').toUpperCase();
  // Si el link trae otra sala, esa sala reemplaza a la guardada
  if (codigoUrl && codigoUrl !== sala) {
    sala = null;
    guardar('sala', null);
  }

  let vista = null;     // copia COMPLETA de los datos (solo la usa el cronómetro, así nunca ve datos a medias)
  let datos = null;     // filas de la base + datos propios del jugador
  let estado = null;    // estado del juego calculado por game.js
  let actual = 0;       // número de la semana que se está jugando
  let pantalla = '';    // 'inicio' | 'lobby' | 'eleccion' | 'juego' | 'fin'
  let ocupado = false;
  let ocupadoDesde = 0;
  let desfase = 0;      // hora del servidor − hora de este celular (para que el cronómetro coincida)
  let autoRonda = 0;    // semana en la que ya se envió automáticamente
  let semanaVista = 0;  // última semana que se pintó (para animar el cambio de semana)
  let semanaCadena = 0;
  const camiones = new Map();

  // ---------- UTILIDADES ----------
  const $ = (id) => document.getElementById(id);
  const val = (id) => { const el = $(id); return el ? el.value : ''; };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => (n < 0 ? '−' : '') + '$' + Math.abs(Math.round(n)).toLocaleString('es-PE');
  const dinero2 = (n) => '$' + Number(n).toFixed(2);
  const num = (n) => Math.round(n).toLocaleString('es-PE');
  const pct = (x) => Math.round(x * 100) + '%';
  const suma = (arr) => arr.reduce((a, b) => a + b, 0);
  const ahoraServidor = () => Date.now() + desfase;
  const chip = (p) => `<img class="gal" src="img/galleta${PRODUCTOS.indexOf(p) + 1}.png" alt="">${esc(p.nombre)}`;
  const ic = (n) => `<img class="ic-s" src="img/${n}.png" alt="">`;
  const ESC = { fabrica: 'fabrica', distribuidor: 'distribucion', tienda: 'tienda' };
  const escena = (rol, cls = 'esc-rol') => `<img class="${cls}" src="img/${ESC[rol]}.png" alt="${ROLN[rol]}">`;
  const render = (el, html) => {
    if (!el) return;
    if (el._h !== html) { el.innerHTML = html; el._h = html; }
  };
  const aviso = (t) => { const el = $('aviso'); if (el) el.textContent = t || ''; };
  const mensajeError = (e) => {
    const m = String((e && e.message) || e || '');
    if (/failed to fetch|networkerror|load failed|network/i.test(m)) {
      return 'Sin conexión, reintentando… (revisa tu internet y config.js)';
    }
    // Se subieron los archivos nuevos pero falta pegar el supabase.sql nuevo en Supabase
    if (/could not find the function|schema cache|column [\w."]+ does not exist|es_bot/i.test(m)) {
      return 'Falta actualizar la base de datos: pega de nuevo todo supabase.sql en Supabase > SQL Editor > Run (ver GUIA.md).';
    }
    return m;
  };
  const tabla = (cab, filas, clase = '') =>
    `<div class="scroll"><table class="${clase}"><thead><tr>${cab.map((h) => `<th>${h}</th>`).join('')}</tr></thead>` +
    `<tbody>${filas.map((f) => `<tr>${f.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;

  // Avatar: cara + número (o imagen si en avatares.js se puso una)
  function avatar(id, tam = '') {
    const a = AVATARES.find((x) => x.id === Number(id));
    if (!a) return `<span class="av ${tam}">?</span>`;
    if (a.img) {
      return `<span class="av con-img ${tam}"><img src="${esc(a.img)}" alt="Avatar ${a.id}" loading="eager" ` +
        `onerror="this.parentNode.classList.remove('con-img');this.parentNode.innerHTML='${a.cara}<i>${a.id}</i>'"></span>`;
    }
    return `<span class="av ${tam}">${a.cara}<i>${a.id}</i></span>`;
  }
  const quienHtml = (j) => `${avatar(j.avatar, 'peq')} <b>${esc(j.nombre)}</b>${j.es_bot ? ' 🤖' : ''}`;

  // ---------- PANTALLAS ----------
  const PLANTILLAS = {
    home: () => `
      <section class="home">
        <img class="deco" style="left:6%;top:7%" src="img/galleta1.png" alt="">
        <img class="deco" style="right:8%;top:11%;animation-delay:.6s" src="img/galleta4.png" alt="">
        <img class="deco" style="left:10%;bottom:17%;animation-delay:1.2s" src="img/galleta3.png" alt="">
        <img class="deco" style="right:7%;bottom:21%;animation-delay:1.8s" src="img/galleta5.png" alt="">
        <img class="logo" src="img/logo.png" alt="Cookie Production Fight!">
        <p class="lema">Produce, distribuye y vende. ¡Supera a tu rival!</p>
        <div class="escenas"><img src="img/fabrica.png" alt=""><img src="img/distribucion.png" alt=""><img src="img/tienda.png" alt=""></div>
        <button class="principal btn-iniciar" data-accion="iniciar-juego">INICIAR</button>
        <p class="pie">Versión ${esc(JR.VERSION)}</p>
      </section>`,
    inicio: () => `
      <section class="card">
        <img class="logo-mini" src="img/logo.png" alt="Cookie Production Fight!">
        <p class="ayuda">Fábrica, distribuidor y tienda, en 2 equipos de 3. Gana quien tenga más utilidad al final.</p>
        <h2>1. Elige tu avatar</h2>
        <div class="grid-av" id="grid-av">
          ${AVATARES.map((a) => `<button type="button" class="av-btn ${a.id === avatarSel ? 'sel' : ''}" data-accion="avatar" data-id="${a.id}" aria-label="Avatar ${a.id}">${avatar(a.id)}</button>`).join('')}
        </div>
        <div id="perfil" class="perfil" ${avatarSel ? '' : 'hidden'}>
          <div id="av-grande">${avatarSel ? avatar(avatarSel, 'grande') : ''}</div>
          <label>Tu nombre
            <input id="nombre" value="${esc(nombre)}" maxlength="20" autocomplete="off" placeholder="Escribe tu nombre">
          </label>
        </div>
        <p class="ayuda" id="pide-av" ${avatarSel ? 'hidden' : ''}>Toca uno de los 16 avatares para empezar.</p>
        <h2>2. Crea una sala o únete</h2>
        <div class="fila">
          <label>Semanas (5 a 60)
            <input id="rondas" type="number" value="30" min="5" max="60" inputmode="numeric">
          </label>
          <label>Segundos por decisión
            <input id="segundos" type="number" value="60" min="20" max="180" inputmode="numeric">
          </label>
        </div>
        <button class="principal" data-accion="crear">Crear sala</button>
        <button class="secundario" data-accion="solo">🤖 Probar solo con 5 bots</button>
        <label>Código de sala (4 letras o números)
          <input id="codigo" value="${esc(codigoUrl)}" maxlength="4" autocapitalize="characters" autocomplete="off">
        </label>
        <button class="principal" data-accion="unirse">Unirme</button>
        <p id="aviso" class="aviso"></p>
      </section>`,
    lobby: () => `
      <section class="card">
        <h1>Sala de espera</h1>
        <div id="lobby"></div>
        <p id="aviso" class="aviso"></p>
      </section>`,
    eleccion: () => `
      <section class="card">
        <h1>Elige tu equipo y tu puesto</h1>
        <div id="elec"></div>
        <p id="aviso" class="aviso"></p>
      </section>`,
    juego: () => `
      <p id="aviso" class="aviso"></p>
      <section class="card" id="dinero"></section>
      <section class="card">
        <h2><img class="ic-s" src="img/camion.png" alt="">Tu cadena</h2>
        <div class="cadena" id="cadena">
          <div class="nodo"><img class="ic-g" src="img/engranaje.png" alt=""><div class="ni"><b>Producción</b> <small id="t-prod"></small></div></div>
          <div class="lane" id="lane-prod"></div>
          <div class="nodo" id="n-fabrica"><img class="esc-rol" src="img/fabrica.png" alt="Fábrica"><div class="ni" id="i-fabrica"></div></div>
          <div class="lane" id="lane-fd"></div>
          <div class="nodo" id="n-distribuidor"><img class="esc-rol" src="img/distribucion.png" alt="Distribuidor"><div class="ni" id="i-distribuidor"></div></div>
          <div class="lane" id="lane-dt"></div>
          <div class="nodo" id="n-tienda"><img class="esc-rol" src="img/tienda.png" alt="Tienda"><div class="ni" id="i-tienda"></div></div>
          <div class="lane fija"><span id="t-ventas"></span></div>
          <div class="nodo"><span class="ic">🙋</span><div class="ni"><b>Clientes</b></div></div>
        </div>
        <p class="ayuda" id="rival-est"></p>
      </section>
      <section class="card" id="mi"></section>
      <section class="card" id="inf"></section>
      <section class="card" id="ult"></section>
      <section class="card" id="marc"></section>`,
    fin: () => `<section class="card" id="fin"></section>`,
  };

  function construir(p) {
    pantalla = p;
    app.innerHTML = PLANTILLAS[p]();
    camiones.clear();
    semanaCadena = 0;
  }

  // ---------- ACCIONES ----------
  function entrar(codigo) {
    sala = codigo;
    guardar('sala', codigo);
    guardar('nombre', nombre);
    datos = null;
    pantalla = '';
    refrescar();
  }

  function salir() {
    sala = null;
    datos = null;
    estado = null;
    vista = null;
    guardar('sala', null);
    pantalla = '';
    semanaVista = 0;
    construir('inicio');
  }

  // Lee y comprueba el avatar y el nombre de la pantalla de inicio
  function perfilListo() {
    nombre = val('nombre').trim();
    if (!avatarSel) { aviso('Primero elige tu avatar'); return false; }
    if (!nombre) { aviso('Escribe tu nombre'); return false; }
    guardar('nombre', nombre);
    return true;
  }

  function elegirAvatar(id) {
    avatarSel = id;
    guardar('avatar', String(id));
    document.querySelectorAll('#grid-av .av-btn').forEach((b) => b.classList.toggle('sel', Number(b.dataset.id) === id));
    const g = $('av-grande'); if (g) g.innerHTML = avatar(id, 'grande');
    const p = $('perfil'); if (p) p.hidden = false;
    const m = $('pide-av'); if (m) m.hidden = true;
    aviso('');
    const n = $('nombre'); if (n && !n.value) n.focus();
  }

  async function crearSala() {
    if (!perfilListo()) return;
    const { data, error } = await sb.rpc('crear_sala', {
      p_nombre: nombre, p_jugador: jugadorId, p_rondas: Number(val('rondas')), p_segundos: Number(val('segundos')),
      p_avatar: avatarSel,
    });
    if (error) return aviso(mensajeError(error));
    entrar(data);
  }

  // Crea una sala, la llena con 5 bots y abre la elección de puesto (para probar sin otras personas)
  async function jugarSolo() {
    if (!perfilListo()) return;
    const crear = await sb.rpc('crear_sala', {
      p_nombre: nombre, p_jugador: jugadorId, p_rondas: Number(val('rondas')), p_segundos: Number(val('segundos')),
      p_avatar: avatarSel,
    });
    if (crear.error) return aviso(mensajeError(crear.error));
    const codigo = crear.data;
    const bots = await sb.rpc('completar_bots', { p_codigo: codigo, p_jugador: jugadorId });
    if (bots.error) {
      await sb.rpc('salir_sala', { p_codigo: codigo, p_jugador: jugadorId });   // no deja una sala a medias
      return aviso(mensajeError(bots.error));
    }
    const ini = await sb.rpc('iniciar_sala', { p_codigo: codigo, p_jugador: jugadorId });
    if (ini.error) {
      await sb.rpc('salir_sala', { p_codigo: codigo, p_jugador: jugadorId });
      return aviso(mensajeError(ini.error));
    }
    entrar(codigo);
  }

  async function completarBots() {
    const { error } = await sb.rpc('completar_bots', { p_codigo: sala, p_jugador: jugadorId });
    if (error) return aviso(mensajeError(error));
    refrescar();
  }

  async function quitarBots() {
    const { error } = await sb.rpc('quitar_bots', { p_codigo: sala, p_jugador: jugadorId });
    if (error) return aviso(mensajeError(error));
    refrescar();
  }

  async function unirse() {
    if (!perfilListo()) return;
    const codigo = val('codigo').trim().toUpperCase();
    if (!codigo) return aviso('Escribe el código de la sala');
    const { error } = await sb.rpc('unirse_sala', { p_codigo: codigo, p_jugador: jugadorId, p_nombre: nombre, p_avatar: avatarSel });
    if (error) return aviso(mensajeError(error));
    entrar(codigo);
  }

  async function iniciar() {
    const { error } = await sb.rpc('iniciar_sala', { p_codigo: sala, p_jugador: jugadorId });
    if (error) return aviso(mensajeError(error));
    refrescar();
  }

  async function elegirPuesto(equipo, rol) {
    const { error } = await sb.rpc('elegir_puesto', { p_codigo: sala, p_jugador: jugadorId, p_equipo: equipo, p_rol: rol });
    aviso(error ? mensajeError(error) : '');
    refrescar();
  }

  async function liberarPuesto() {
    const { error } = await sb.rpc('liberar_puesto', { p_codigo: sala, p_jugador: jugadorId });
    if (error) aviso(mensajeError(error));
    refrescar();
  }

  async function salirDeSala() {
    const { error } = await sb.rpc('salir_sala', { p_codigo: sala, p_jugador: jugadorId });
    if (error) return aviso(mensajeError(error));
    salir();
  }

  // Lee el formulario de la pantalla según el rol de este jugador
  function porIndice(sel) {
    const arr = PRODUCTOS.map(() => null);
    document.querySelectorAll(sel).forEach((el) => { arr[Number(el.dataset.i)] = el.value; });
    return arr;
  }
  const enteros = (arr) => arr.map((v) => {
    const n = Math.floor(Number(v));
    return Number.isFinite(n) && n > 0 ? n : 0;
  });
  function leerFormulario(rol) {
    if (rol === 'fabrica') {
      return { calidad: porIndice('#mi .cal'), produccion: enteros(porIndice('#mi .prod')) };
    }
    if (rol === 'distribuidor') {
      const pujas = INF_KEYS.map((k, idx) => {
        const inf = estado.inf[k];
        if (actual < inf.ocupadoHasta) return null;           // influencer ocupado: no se puja
        const el = document.querySelector(`#mi .pm[data-k="${idx}"]`);
        const monto = el ? Math.floor(Number(el.value)) : 0;
        if (!(monto > 0)) return null;                        // 0 = no pujó
        return { monto };
      });
      return { pedido: enteros(porIndice('#mi .ped')), pujas };
    }
    // tienda
    return {
      precio: porIndice('#mi .pre').map((v) => (v === null || v === '' ? null : Number(v))),
      pedido: enteros(porIndice('#mi .ped')),
    };
  }

  async function enviarDec(auto) {
    const yo = datos && datos.yo;
    if (!yo || !yo.rol || !estado || !document.querySelector('#mi [data-accion="enviar-dec"]')) return false;
    const { error } = await sb.rpc('enviar_decision', {
      p_codigo: sala, p_jugador: jugadorId, p_ronda: actual, p_payload: leerFormulario(yo.rol),
    });
    if (error) { aviso(mensajeError(error)); return false; }
    aviso(auto ? '⏱ Se acabó el tiempo: enviamos automáticamente lo que tenías en pantalla.' : '✔ Decisión enviada');
    refrescar();
    return true;
  }

  document.addEventListener('click', async (ev) => {
    const b = ev.target.closest('[data-accion]');
    if (!b) return;
    try {
      const a = b.dataset.accion;
      if (a === 'iniciar-juego') construir('inicio');
      else if (a === 'avatar') elegirAvatar(Number(b.dataset.id));
      else if (a === 'crear') await crearSala();
      else if (a === 'solo') await jugarSolo();
      else if (a === 'bots') await completarBots();
      else if (a === 'sin-bots') await quitarBots();
      else if (a === 'unirse') await unirse();
      else if (a === 'iniciar') await iniciar();
      else if (a === 'puesto') await elegirPuesto(b.dataset.eq, b.dataset.rol);
      else if (a === 'liberar') await liberarPuesto();
      else if (a === 'enviar-dec') await enviarDec(false);
      else if (a === 'salir-sala') await salirDeSala();
      else if (a === 'salir') salir();
    } catch (e) {
      aviso(mensajeError(e));
    }
  });

  // Estimaciones en vivo mientras se escribe en el formulario
  document.addEventListener('input', (ev) => {
    if (ev.target.closest && ev.target.closest('#mi')) actualizarEstimado();
  });

  // ---------- LECTURA Y CIERRE DE SEMANAS ----------
  async function refrescar() {
    if (!sala) return;
    // Si una lectura se queda colgada más de 10 s, se libera para no congelar la pantalla
    if (ocupado && Date.now() - ocupadoDesde < 10000) return;
    ocupado = true;
    ocupadoDesde = Date.now();
    try {
      // Las semanas cerradas se leen ANTES que las decisiones: así toda semana cerrada ya trae
      // sus decisiones completas y el cálculo nunca queda a medias (los bots dependen de eso).
      const r = await sb.from('rondas').select(COLS_RON).eq('sala', sala).order('numero');
      const [s, j, d, yo] = await Promise.all([
        sb.from('salas').select(COLS_SALA).eq('codigo', sala).maybeSingle(),
        sb.from('jugadores').select(COLS_JUG).eq('sala', sala).order('unido_en'),
        sb.from('decisiones').select(COLS_DEC).eq('sala', sala),
        sb.rpc('mi_jugador', { p_codigo: sala, p_jugador: jugadorId }),
      ]);
      const err = s.error || j.error || r.error || d.error || yo.error;
      if (err) throw new Error(err.message);
      if (!s.data) { salir(); return; }

      datos = {
        sala: s.data, jugadores: j.data, rondas: r.data, decisiones: d.data,
        yo: yo.data || null, miDec: null, semana: null,
      };
      const sem = await sb.rpc('estado_semana', { p_codigo: sala });
      if (sem.error) throw new Error(sem.error.message);
      datos.semana = sem.data;
      if (sem.data && sem.data.ahora) {
        const t = Date.parse(sem.data.ahora);
        if (!isNaN(t)) desfase = t - Date.now();
      }
      if (datos.sala.estado === 'eleccion') await intentarCerrarEleccion();
      else await intentarCerrar(sem.data);

      if (datos.sala.estado === 'jugando' && sem.data) {
        const md = await sb.rpc('mi_decision', { p_codigo: sala, p_jugador: jugadorId, p_ronda: sem.data.ronda });
        if (md.error) throw new Error(md.error.message);
        datos.miDec = md.data ?? null;   // null si todavía no decide esta semana
      }
      vista = datos;
      calcular();
      pintar();
      await conducirBots();
    } catch (e) {
      aviso(mensajeError(e));
    } finally {
      ocupado = false;
    }
  }

  // Si ya decidieron los 6 o se acabó el tiempo, pide cerrar la semana.
  // El servidor decide de verdad; si el reloj de este celular se adelanta, no pasa nada.
  async function intentarCerrar(sem) {
    if (!sem || datos.sala.estado !== 'jugando') return;
    if (sem.ronda > sem.total) return;
    const fin = sem.fin ? new Date(sem.fin).getTime() : null;
    if (sem.votos >= 6 || (fin && ahoraServidor() >= fin)) {
      await sb.rpc('cerrar_ronda', { p_codigo: sala });
    }
  }

  // Cierra la elección de puestos al acabar los 2 minutos o cuando todas las personas ya eligieron
  async function intentarCerrarEleccion() {
    const fin = datos.sala.eleccion_fin ? new Date(datos.sala.eleccion_fin).getTime() : null;
    const personas = datos.jugadores.filter((j) => !j.es_bot);
    const todas = personas.length > 0 && personas.every((j) => j.equipo && j.rol);
    if (todas || (fin && ahoraServidor() >= fin)) {
      await sb.rpc('cerrar_eleccion', { p_codigo: sala });
    }
  }

  // Envía las decisiones de esta semana de los bots que aún no decidieron.
  // Lo hace el celular de cada persona de la sala: la decisión de un bot es una función del estado
  // de la partida (sin azar), así que da igual cuál llegue primero. Si la semana ya cerró, se ignora.
  async function conducirBots() {
    if (!datos || !estado || datos.sala.estado !== 'jugando' || !datos.yo) return;
    if (!datos.jugadores.some((j) => j.es_bot)) return;
    const sem = datos.semana;
    // Si lo leído quedó a medias (la semana cambió mientras se leía), se espera al próximo ciclo
    if (!sem || sem.ronda !== actual || actual > datos.sala.total_rondas) return;
    // Con un game.js viejo guardado en la memoria del navegador no existe la función de los bots
    if (typeof JR.decisionBot !== 'function') {
      aviso('Recarga la página (Ctrl+F5): el navegador mezcló versiones distintas del juego.');
      return;
    }
    const p = await sb.rpc('bots_pendientes', { p_codigo: sala, p_jugador: jugadorId });
    if (p.error || !Array.isArray(p.data)) return;
    await Promise.all(p.data.filter((b) => b.ronda === actual).map((b) =>
      sb.rpc('enviar_decision', {
        p_codigo: sala, p_jugador: b.id, p_ronda: actual,
        p_payload: JR.decisionBot(estado, b.equipo, b.rol, actual),
      })));
  }

  function calcular() {
    const s = datos.sala;
    const porRonda = JR.armarDecisiones(datos.decisiones, s.total_rondas);
    const cerradas = datos.rondas.length;
    estado = JR.reproducir(s.semilla, porRonda.slice(0, cerradas));
    actual = cerradas + 1;
  }

  function pintar() {
    const s = datos.sala;
    if (s.estado === 'espera') return pintarLobby();
    if (s.estado === 'eleccion') return pintarEleccion();
    if (s.estado === 'terminado') return pintarFin();
    return pintarJuego();
  }

  // ---------- LOBBY ----------
  function pintarLobby() {
    if (pantalla !== 'lobby') construir('lobby');
    const s = datos.sala;
    const soyAnfitrion = !!(datos.yo && datos.yo.es_anfitrion);
    const listo = datos.jugadores.length === 6;
    const link = `${location.origin}${location.pathname}?sala=${s.codigo}`;
    const lista = datos.jugadores.map((j) =>
      `<li>${quienHtml(j)}${j.es_anfitrion ? ' 👑' : ''}</li>`
    ).join('');
    const hayBots = datos.jugadores.some((j) => j.es_bot);
    const personas = datos.jugadores.filter((j) => !j.es_bot).length;
    render($('lobby'), `
      <p>Código de sala: <strong class="codigo">${esc(s.codigo)}</strong></p>
      <p class="ayuda">Comparte este link con tus amigos (ya trae el código):</p>
      <input class="link" readonly value="${esc(link)}" onclick="this.select()">
      <p>Semanas: <b>${s.total_rondas}</b> · Segundos por decisión: <b>${s.segundos}</b></p>
      <p>Jugadores: <b>${datos.jugadores.length}/6</b> (${personas} ${personas === 1 ? 'persona' : 'personas'}${hayBots ? `, ${datos.jugadores.length - personas} ${datos.jugadores.length - personas === 1 ? 'bot' : 'bots'}` : ''})</p>
      <ul class="lista sin-punto">${lista}</ul>
      ${soyAnfitrion
        ? `<button class="principal" data-accion="iniciar" ${listo ? '' : 'disabled'}>
             ${listo ? 'Iniciar: elegir puestos (2 min)' : 'Esperando a 6 jugadores…'}</button>
           ${listo ? '' : '<button class="secundario" data-accion="bots">🤖 Completar con bots los lugares vacíos</button>'}
           ${hayBots ? '<button class="secundario" data-accion="sin-bots">Quitar los bots</button>' : ''}
           <p class="ayuda">Al iniciar, cada persona tendrá 2 minutos para elegir su equipo (${esc(EQ.A)} o ${esc(EQ.B)}) y su puesto. Quien no elija recibe uno al azar.</p>`
        : '<p class="ayuda">Esperando a que quien creó la sala inicie la partida…</p>'}
      <button class="secundario" data-accion="salir-sala">Salir de la sala</button>
      <details class="reglas" open>
        <summary>Reglas en 1 minuto</summary>
        <ul>
          <li>Cada equipo tiene fábrica → distribuidor → tienda. Cada rol decide su área.</li>
          <li>Los bots 🤖 ocupan los lugares vacíos y deciden solos cada semana; no hacen falta 6 personas.</li>
          <li>Fábrica: calidad y producción. Distribuidor: pedidos a fábrica y pujas por influencers. Tienda: precio y pedidos al distribuidor.</li>
          <li>Hay 5 sabores. La demanda es del mercado y la comparten los dos equipos; cambia cada semana.</li>
          <li>Ganancia del equipo = ventas − costo de lo vendido − mantenimiento del stock − pujas pagadas.</li>
          <li>Si no envías tu decisión antes de que acabe el tiempo, se envía sola lo que tengas en pantalla.</li>
          <li>Influencers (opcionales): suben la demanda de todos los sabores de su equipo. Las pujas son secretas: gana el monto más alto y paga ese monto. Si hay empate, gana el equipo con mejor calidad.</li>
        </ul>
      </details>
      <p class="ayuda">Versión del juego: ${esc(JR.VERSION)}</p>
    `);
  }

  // ---------- ELECCIÓN DE PUESTO ----------
  function pintarEleccion() {
    if (pantalla !== 'eleccion') construir('eleccion');
    const yo = datos.yo;
    const miEq = yo && yo.equipo;
    const columnas = ['A', 'B'].map((X) => {
      const filas = ROLES.map((rol) => {
        const j = datos.jugadores.find((x) => x.equipo === X && x.rol === rol);
        const mio = !!(yo && yo.equipo === X && yo.rol === rol);
        let cuerpo;
        if (mio) {
          cuerpo = `${avatar(yo.avatar, 'peq')} <b>${esc(yo.nombre)}</b> (tú) 🔒
            <button class="mini sec" data-accion="liberar">Desbloquear para cambiar</button>`;
        } else if (j) {
          cuerpo = miEq === X ? `${avatar(j.avatar, 'peq')} ${esc(j.nombre)} 🔒` : '🔒 Ocupado';
        } else {
          cuerpo = `<button class="mini" data-accion="puesto" data-eq="${X}" data-rol="${rol}">Elegir este puesto</button>`;
        }
        return `<div class="slot ${mio ? 'mio' : ''} ${j ? 'ocup' : ''}"><span class="rolnom">${escena(rol, '')}${ROLN[rol]}</span><div>${cuerpo}</div></div>`;
      }).join('');
      return `<div class="colEq ${miEq === X ? 'miEq' : ''}"><h3>${esc(EQ[X])}${miEq === X ? ' (tu equipo)' : ''}</h3>${filas}</div>`;
    }).join('');
    const sinElegir = datos.jugadores.filter((j) => !j.es_bot && !j.equipo);
    const bots = datos.jugadores.filter((j) => j.es_bot).length;
    render($('elec'), `
      <p class="ayuda">Elige tu equipo y tu puesto. <b>El primero en confirmar un puesto lo bloquea</b> para los demás, pero puedes desbloquearlo para cambiar.
      Si se acaba el tiempo y no elegiste, te toca un puesto al azar.</p>
      <div class="dos-col">${columnas}</div>
      <p>${sinElegir.length
        ? `Faltan por elegir: ${sinElegir.map((j) => `${avatar(j.avatar, 'peq')} ${esc(j.nombre)}`).join(', ')}`
        : '✔ Todas las personas ya eligieron. La partida empieza en unos segundos…'}</p>
      ${bots ? `<p class="ayuda">🤖 ${bots} ${bots === 1 ? 'bot recibirá' : 'bots recibirán'} al azar los puestos que queden libres.</p>` : ''}
    `);
    tick();
  }

  // ---------- JUEGO ----------
  function pintarJuego() {
    if (pantalla !== 'juego') construir('juego');
    const s = datos.sala;
    const yo = datos.yo;
    if (!yo || !yo.rol) {
      render($('mi'), '<p>No apareces en esta sala.</p><button class="secundario" data-accion="salir">Volver al inicio</button>');
      return;
    }
    const nueva = semanaVista > 0 && actual > semanaVista;
    semanaVista = actual;
    const ult = estado.historial[estado.historial.length - 1];
    const rep = ult ? ult.equipos[yo.equipo] : null;
    render($('dinero'), htmlDinero(yo, ult));
    actualizarCadena(yo, ult, nueva);
    render($('mi'), htmlMi(yo, rep));
    actualizarEstimado();
    render($('inf'), htmlInf());
    render($('ult'), htmlUlt(yo, ult));
    render($('marc'), htmlMarc(yo, ult));
    if (nueva) {
      aviso('');
      avisoSemana(`📅 Semana ${actual} · los camiones avanzan`);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    tick();
  }

  function avisoSemana(texto) {
    const t = $('toast');
    if (!t) return;
    t.textContent = texto;
    t.classList.add('ver');
    clearTimeout(avisoSemana.h);
    avisoSemana.h = setTimeout(() => t.classList.remove('ver'), 2600);
  }

  // 💰 Cuánto dinero tiene el equipo y de dónde sale
  function htmlDinero(yo, ult) {
    const X = yo.equipo;
    const R = X === 'A' ? 'B' : 'A';
    const u = estado.equipos[X].utilidad;
    const total = JR.sumaUtil(u);
    const totalR = JR.sumaUtil(estado.equipos[R].utilidad);
    const semana = ult ? ult.equipos[X].utilidadRonda : null;
    const dif = total - totalR;
    return `
      <h2>💰 Dinero de ${esc(EQ[X])}</h2>
      <div class="dinero">
        <span class="gran ${total >= 0 ? 'pos' : 'neg'}">${money(total)}</span>
        <small>ganancia acumulada de tu equipo</small>
      </div>
      <p>${semana
        ? `Última semana: <b class="${semana.total >= 0 ? 'pos' : 'neg'}">${money(semana.total)}</b> <small>(ventas ${money(semana.ventas)} − mantenimiento ${money(semana.mantenimiento)} − pujas ${money(semana.influencers)})</small>`
        : 'Todavía no se cerró ninguna semana: empiezan en $0.'}</p>
      <p>${esc(EQ[R])}: <b>${money(totalR)}</b> · ${dif === 0 ? 'van empatados' : dif > 0 ? `<span class="pos">vas ganando por ${money(dif)}</span>` : `<span class="neg">vas perdiendo por ${money(-dif)}</span>`}</p>
      <details class="reglas">
        <summary>¿Cómo funciona el dinero?</summary>
        <ul>
          <li>Empiezan en $0 y <b>no hay límite de caja</b>: puedes pedir y producir lo que quieras.</li>
          <li><b>Producir o pedir no cuesta en el momento.</b> El costo de cada galleta se descuenta cuando se vende.</li>
          <li>Lo que se vende suma: precio − costo de la galleta (es el "margen de ventas").</li>
          <li>Lo guardado en almacén paga mantenimiento: 3% de su valor por semana (por eso conviene no acumular de más).</li>
          <li>Las pujas por influencers solo se pagan si ganas, y se descuentan de tu ganancia.</li>
          <li>Gana el equipo con más ganancia acumulada al final.</li>
        </ul>
      </details>`;
  }

  // ---------- CADENA ANIMADA ----------
  const remDe = (e) => Math.min(1, Math.max(0, e.llega - actual));

  function actualizarCadena(yo, ult, animar) {
    const X = yo.equipo;
    const eq = estado.equipos[X];
    const listos = new Set((datos.semana && datos.semana.listos) || []);
    const rep = ult ? ult.equipos[X] : null;

    // Quién es quién en MI equipo (nombre y avatar). Del rival no se muestra el puesto.
    ROLES.forEach((rol) => {
      const j = datos.jugadores.find((x) => x.equipo === X && x.rol === rol);
      const decidio = listos.has(`${X}:${rol}`);
      const stk = suma(eq.stock[rol].map((L) => L.q));
      render($('i-' + rol), `
        <b>${ROLN[rol]}</b> ${j ? quienHtml(j) : ''}${rol === yo.rol ? ' <span class="tu">TÚ</span>' : ''}
        <br><small>Almacén: <b>${num(stk)}</b> galletas · ${decidio ? `<span class="pos">${ic('checklist')}ya decidió</span>` : '⏳ decidiendo…'}</small>`);
      const n = $('n-' + rol);
      if (n) n.classList.toggle('mio', rol === yo.rol);
    });
    const enProd = suma(eq.enTransito.prod.map((e) => e.q));
    const t1 = $('t-prod'); if (t1) t1.textContent = `${num(enProd)} galletas en proceso`;
    const t2 = $('t-ventas');
    if (t2) t2.textContent = rep ? `🛒 Semana pasada: vendió ${num(suma(rep.vendido))} de ${num(suma(rep.demanda))} pedidas` : '🛒 Aquí verás las ventas';
    const R = X === 'A' ? 'B' : 'A';
    const rivalListos = [...listos].filter((k) => k.startsWith(R + ':')).length;
    const r = $('rival-est');
    if (r) r.textContent = `${EQ[R]}: ${rivalListos} de 3 ya decidieron esta semana.`;

    // Camiones: uno por cada envío (agrupados por semana de llegada)
    const vistos = new Set();
    [['prod', 'lane-prod'], ['fd', 'lane-fd'], ['dt', 'lane-dt']].forEach(([clave, laneId]) => {
      const lane = $(laneId);
      if (!lane) return;
      const grupos = {};
      eq.enTransito[clave].forEach((e) => {
        if (e.q <= 0) return;
        const k = `${clave}|${e.llega}`;
        grupos[k] = grupos[k] || { q: 0, r: remDe(e) };
        grupos[k].q += e.q;
      });
      Object.keys(grupos).forEach((k) => {
        const g = grupos[k];
        const pos = g.r === 0 ? 72 : 30;
        vistos.add(k);
        let el = camiones.get(k);
        if (!el) {
          el = document.createElement('div');
          el.className = 'camion';
          el.innerHTML = '<span class="cm"><img src="img/camion.png" alt=""></span><small></small>';
          el.style.top = (animar ? 0 : pos) + '%';
          if (animar) el.style.opacity = '0';
          lane.appendChild(el);
          camiones.set(k, el);
          if (animar) {
            void el.offsetWidth;
            el.style.top = pos + '%';
            el.style.opacity = '1';
          }
        } else {
          el.style.top = pos + '%';
        }
        el.querySelector('small').textContent =
          `${num(g.q)} · ${g.r === 0 ? 'llega al cerrar esta semana' : 'llega al cerrar la próxima'}`;
      });
    });
    [...camiones.keys()].forEach((k) => {
      if (vistos.has(k)) return;
      const el = camiones.get(k);
      camiones.delete(k);
      if (animar) {
        el.style.top = '100%';
        el.style.opacity = '0';
        setTimeout(() => el.remove(), 1500);
      } else {
        el.remove();
      }
    });
  }

  // ---------- TU DECISIÓN ----------
  function htmlMi(yo, rep) {
    const eq = estado.equipos[yo.equipo];
    const pl = datos.miDec || {};
    const enviada = datos.miDec !== null;
    // Valores ya limpiados por el motor, para mostrar lo que realmente se usará
    const lim = JR.leerDecision({ [yo.rol]: pl });
    const cam = (clave, i, r) => suma(eq.enTransito[clave].filter((e) => e.p === i && remDe(e) === r).map((e) => e.q));
    const camTot = (clave, i) => cam(clave, i, 0) + cam(clave, i, 1);
    const dosSemanas = (clave, i) => `${num(cam(clave, i, 0))} <small>al cerrar esta semana</small><br>${num(cam(clave, i, 1))} <small>al cerrar la próxima</small>`;
    const stock = eq.stock[yo.rol].map((L) => L.q);
    const boton = `<button class="principal" data-accion="enviar-dec">${enviada ? 'Actualizar decisión' : 'Enviar decisión'}</button>`;
    const estadoEnvio = `<p class="estado">${enviada
      ? '✔ Decisión enviada. Puedes cambiarla mientras la semana siga abierta (se cierra cuando deciden los 6 o se acaba el tiempo).'
      : 'Aún no envías tu decisión. Si se acaba el tiempo, se enviará sola lo que tengas aquí.'}</p>`;
    const estim = '<p class="estim" id="estim"></p>';

    if (yo.rol === 'fabrica') {
      const sugerido = (i) => (rep ? rep.pedidoFab[i] : Math.round(PRODUCTOS[i].demMedia));
      const pCal = (i) => lim.calidad[i] || eq.calidad[i];
      const pProd = (i) => (pl.produccion !== undefined ? lim.produccion[i] : sugerido(i));
      const situacion = tabla(
        ['Sabor', ic('paquete') + 'En almacén', ic('engranaje') + 'Produciendo', ic('camion') + 'Entregando al distribuidor'],
        PRODUCTOS.map((p, i) => [chip(p), num(stock[i]), dosSemanas('prod', i), dosSemanas('fd', i)])
      );
      const formulario = tabla(
        ['Sabor', 'Calidad', 'Producir (llega en 2 semanas)'],
        PRODUCTOS.map((p, i) => [
          chip(p),
          `<select class="cal" data-i="${i}">${Object.entries(CALIDADES).map(([k, v]) =>
            `<option value="${k}" ${pCal(i) === k ? 'selected' : ''}>${v.nombre} (${dinero2(CONFIG.costoBase * v.costo)} por galleta)</option>`).join('')}</select>`,
          `<input type="number" class="prod" data-i="${i}" min="0" max="${p.capProd}" inputmode="numeric" value="${pProd(i)}">`,
        ]),
        'form'
      );
      const ultima = rep
        ? `<h3>🤝 Con el distribuidor (semana pasada)</h3>` + tabla(
            ['Sabor', 'Te pidió', 'Despachaste', 'Produjiste'],
            PRODUCTOS.map((p, i) => [chip(p), num(rep.pedidoFab[i]), num(rep.despFD[i]), num(rep.produccion[i])]))
        : '<p class="ayuda">Aquí verás lo que pidió el distribuidor cuando termine la primera semana.</p>';
      return `
        <div class="banner-rol">${escena('fabrica', '')}<div><h2>Tu decisión · Fábrica de galletas</h2><p class="ayuda">Decides la calidad de cada sabor y cuánto producir. Lo que produces llega a tu almacén en 2 semanas.</p></div></div>
        <h3>Tu situación ahora</h3>
        ${situacion}
        ${ultima}
        <h3>Decide esta semana</h3>
        <p class="ayuda">Te sugerimos producir lo que pidió el distribuidor la semana pasada. Puedes cambiarlo.</p>
        ${formulario}
        ${estim}
        ${boton}${estadoEnvio}`;
    }

    if (yo.rol === 'distribuidor') {
      const sugerido = (i) => (rep ? rep.pedidoDist[i] : Math.round(PRODUCTOS[i].demMedia));
      const pPed = (i) => (pl.pedido !== undefined ? lim.pedidoFab[i] : sugerido(i));
      const situacion = tabla(
        ['Sabor', ic('paquete') + 'En almacén', ic('camion') + 'Esperando de fábrica', ic('camion') + 'Entregando a la tienda'],
        PRODUCTOS.map((p, i) => [chip(p), num(stock[i]), dosSemanas('fd', i), dosSemanas('dt', i)])
      );
      const formulario = tabla(
        ['Sabor', 'Pedir a fábrica (llega en 2 semanas)'],
        PRODUCTOS.map((p, i) => [
          chip(p),
          `<input type="number" class="ped" data-i="${i}" min="0" max="${CONFIG.tope}" inputmode="numeric" value="${pPed(i)}">`,
        ]),
        'form'
      );
      const ultima = rep
        ? `<h3>🤝 Con la tienda y la fábrica (semana pasada)</h3>` + tabla(
            ['Sabor', 'La tienda te pidió', 'Le despachaste', 'Tú pediste a fábrica', 'Fábrica despachó'],
            PRODUCTOS.map((p, i) => [chip(p), num(rep.pedidoDist[i]), num(rep.despDT[i]), num(rep.pedidoFab[i]), num(rep.despFD[i])]))
        : '';
      return `
        <div class="banner-rol">${escena('distribuidor', '')}<div><h2>Tu decisión · Centro de distribución</h2><p class="ayuda">Decides cuánto pedir a fábrica y pujas por los influencers. Lo que pida la tienda sale de tu almacén.</p></div></div>
        <h3>Tu situación ahora</h3>
        ${situacion}
        ${ultima}
        <h3>Pedido a fábrica</h3>
        ${formulario}
        ${htmlSubasta(lim)}
        ${estim}
        ${boton}${estadoEnvio}`;
    }

    // tienda
    const pPre = (i) => (lim.precio[i] !== null ? lim.precio[i] : eq.precio[i]);
    const pPedT = (i) => (pl.pedido !== undefined ? lim.pedidoDist[i] : (rep ? rep.demanda[i] : Math.round(PRODUCTOS[i].demMedia)));
    const situacion = tabla(
      ['Sabor', ic('paquete') + 'En almacén', ic('camion') + 'Esperando del distribuidor', 'Precio actual'],
      PRODUCTOS.map((p, i) => [chip(p), num(stock[i]), dosSemanas('dt', i), dinero2(eq.precio[i])])
    );
    const formulario = tabla(
      ['Sabor', 'Precio al cliente ($2.50 a $8.00)', 'Pedir al distribuidor (llega en 2 semanas)'],
      PRODUCTOS.map((p, i) => [
        chip(p),
        `<input type="number" class="pre" data-i="${i}" min="${CONFIG.precioMin}" max="${CONFIG.precioMax}" step="0.1" inputmode="decimal" value="${pPre(i).toFixed(2)}">`,
        `<input type="number" class="ped" data-i="${i}" min="0" max="${CONFIG.tope}" inputmode="numeric" value="${pPedT(i)}">`,
      ]),
      'form'
    );
    const ultima = rep
      ? `<h3>🤝 Con el distribuidor y los clientes (semana pasada)</h3>` + tabla(
          ['Sabor', 'Tú pediste', 'Distribuidor despachó', 'Demanda', 'Vendido', 'Perdido'],
          PRODUCTOS.map((p, i) => [chip(p), num(rep.pedidoDist[i]), num(rep.despDT[i]), num(rep.demanda[i]),
            num(rep.vendido[i]), num(rep.perdidoFinal[i])]))
      : '<p class="ayuda">Aquí verás lo que pasó cuando termine la primera semana.</p>';
    return `
      <div class="banner-rol">${escena('tienda', '')}<div><h2>Tu decisión · Tienda minorista</h2><p class="ayuda">Decides el precio de cada sabor y cuánto pedir al distribuidor. Vendes a los clientes desde tu almacén.</p></div></div>
      <h3>Tu situación ahora</h3>
      ${situacion}
      ${ultima}
      <h3>Precio y pedido</h3>
      <p class="ayuda">Un precio más alto baja tu parte de la demanda y la pasa a la otra tienda. Te sugerimos pedir lo que se demandó la semana pasada.</p>
      ${formulario}
      ${estim}
      ${boton}${estadoEnvio}`;
  }

  // Resumen en vivo de lo que estás escribiendo (no se guarda: solo ayuda a decidir)
  function actualizarEstimado() {
    const el = $('estim');
    const yo = datos && datos.yo;
    if (!el || !yo || !estado) return;
    const v = (sel) => Array.from(document.querySelectorAll(sel)).map((x) => Number(x.value) || 0);
    let txt = '';
    if (yo.rol === 'fabrica') {
      const cal = Array.from(document.querySelectorAll('#mi .cal')).map((x) => CALIDADES[x.value] ? CALIDADES[x.value].costo : 1);
      const prod = v('#mi .prod');
      const costo = suma(prod.map((q, i) => q * CONFIG.costoBase * (cal[i] || 1)));
      txt = `Vas a producir <b>${num(suma(prod))}</b> galletas. Costo total: <b>${money(costo)}</b> (se descuenta de la ganancia cuando se vendan, no ahora).`;
    } else if (yo.rol === 'distribuidor') {
      const ped = v('#mi .ped');
      const pujas = v('#mi .pm');
      const maxPuja = suma(pujas);
      txt = `Pedirás <b>${num(suma(ped))}</b> galletas a fábrica.` +
        (maxPuja > 0 ? ` Tus pujas suman <b>${money(maxPuja)}</b>: solo pagas las que ganes.` : ' No estás pujando.');
    } else {
      const ped = v('#mi .ped');
      txt = `Pedirás <b>${num(suma(ped))}</b> galletas al distribuidor. Guardar una galleta en tu almacén cuesta ${dinero2(CONFIG.precioDist * CONFIG.tasaMantenimiento)} por semana.`;
    }
    el.innerHTML = txt;
  }

  // Pujas secretas por los influencers (solo distribuidores). Solo se pide un monto.
  function htmlSubasta(lim) {
    const filas = INF_KEYS.map((k, idx) => {
      const inf = estado.inf[k];
      const info = INFLUENCERS[k];
      const ocup = actual < inf.ocupadoHasta;
      const monto = lim.pujas[idx] ? lim.pujas[idx].monto : 0;
      const estadoTxt = ocup
        ? `<span class="neg">Ocupado</span><br><small>${esc(EQ[inf.dueno])} · +${pct(inf.uplift)} en todos los sabores · hasta la semana ${inf.hasta}</small>`
        : `<span class="pos">Libre</span><br><small>sube la demanda ${pct(info.min)} a ${pct(info.max)}</small>`;
      return [
        `<b>Influencer ${k}</b>`,
        estadoTxt,
        ocup ? '—' : `<input type="number" class="pm" data-k="${idx}" min="0" max="${CONFIG.topeMonto}" step="1" inputmode="numeric" value="${monto}">`,
      ];
    });
    return `
      <h3>Subasta de influencers</h3>
      <p class="ayuda">Pujas secretas: gana el monto más alto y paga ese monto. Si hay empate en el monto, gana el equipo con mejor calidad promedio; si también empatan en calidad, gana al azar. Pon 0 si no quieres pujar. Solo puedes pujar por los influencers libres.</p>
      ${tabla(['Influencer', 'Estado', 'Tu monto ($)'], filas, 'form')}`;
  }

  // Estado público de los influencers (lo ve todo el mundo)
  function htmlInf() {
    const filas = INF_KEYS.map((k) => {
      const inf = estado.inf[k];
      const info = INFLUENCERS[k];
      const ocup = actual < inf.ocupadoHasta;
      const estadoTxt = ocup
        ? `<span class="neg">Ocupado</span> · ${esc(EQ[inf.dueno])} · +${pct(inf.uplift)} · hasta la semana ${inf.hasta}`
        : '<span class="pos">Libre</span> · se subasta esta semana';
      return [`<b>Influencer ${k}</b>`, `${pct(info.min)} a ${pct(info.max)}`, estadoTxt];
    });
    return `
      <h2>Influencers</h2>
      ${tabla(['Influencer', 'Sube la demanda', 'Estado'], filas)}
      <p class="ayuda">Un influencer sube la demanda de todos los sabores de su equipo y dura 2 semanas.</p>`;
  }

  function htmlUlt(yo, ult) {
    if (!ult) {
      return '<h2>Resultados</h2><p class="ayuda">Aquí verás los resultados de tu equipo al terminar la primera semana.</p>';
    }
    const r = ult.equipos[yo.equipo];
    const u = r.utilidadRonda;
    let html = `
      <h2>Última semana (${ult.ronda}) · ${esc(EQ[yo.equipo])}</h2>
      <p>Ganancia del equipo esta semana: <b class="${u.total >= 0 ? 'pos' : 'neg'}">${money(u.total)}</b></p>
      <p class="ayuda">Margen de ventas ${money(u.ventas)} − mantenimiento ${money(u.mantenimiento)} − pujas pagadas ${money(u.influencers)}</p>`;

    if (yo.rol === 'distribuidor') {
      const prev = datos.decisiones.find((x) => x.ronda === ult.ronda && x.equipo === yo.equipo && x.rol === 'distribuidor');
      const pb = prev && prev.payload && Array.isArray(prev.payload.pujas) ? prev.payload.pujas : [];
      const filas = INF_KEYS.map((k, idx) => {
        const b = pb[idx];
        const txt = b && Number(b.monto) > 0 ? money(Number(b.monto)) : '—';
        return [`Influencer ${k}`, txt, RES[r.pujas[idx]] || esc(r.pujas[idx])];
      });
      html += `<h3>Tus pujas de la semana pasada</h3>` + tabla(['Influencer', 'Tu puja', 'Resultado'], filas);
    }

    html += `<h3>Ventas de la tienda</h3>` + tabla(
      ['Sabor', 'Demanda', 'Vendido', 'Perdido', 'Clientes de la otra tienda', 'Clientes que se fueron'],
      PRODUCTOS.map((p, i) => [chip(p), num(r.demanda[i]), num(r.vendido[i]), num(r.perdidoFinal[i]),
        num(r.desvRec[i]), num(r.desvEnv[i])]));
    return html;
  }

  function htmlMarc(yo, ult) {
    const filas = JR.EQUIPOS.map((X) => {
      const u = estado.equipos[X].utilidad;
      const semana = ult ? ult.equipos[X].utilidadRonda.total : 0;
      return [
        `${esc(EQ[X])}${yo && X === yo.equipo ? ' (tú)' : ''}`,
        money(u.ventas), money(u.mantenimiento), money(u.influencers),
        `<b>${money(JR.sumaUtil(u))}</b>`, money(semana),
      ];
    });
    return `
      <h2>Marcador</h2>
      ${tabla(['Equipo', 'Margen de ventas', 'Mantenimiento', 'Pujas pagadas', 'Total', 'Última semana'], filas)}
      <p class="ayuda">Gana el equipo con más total al terminar la partida.</p>`;
  }

  // ---------- CRONÓMETRO FIJO ----------
  // Siempre visible (barra fija arriba, no se mueve al hacer scroll). Rojo y parpadeando en los últimos 10 s.
  function tick() {
    const rl = $('reloj');
    if (!rl) return;
    const s = vista && vista.sala;
    let fin = null;
    let total = 0;
    let etiqueta = '';
    if (s && s.estado === 'eleccion' && s.eleccion_fin) {
      fin = Date.parse(s.eleccion_fin);
      total = SEG_ELECCION;
      etiqueta = 'Elige tu puesto';
    } else if (s && s.estado === 'jugando' && vista.semana && vista.semana.fin && vista.yo && vista.yo.rol) {
      fin = Date.parse(vista.semana.fin);
      total = s.segundos;
      etiqueta = `Semana ${Math.min(vista.semana.ronda, s.total_rondas)} de ${s.total_rondas} · ${EQ[vista.yo.equipo]} · ${ROLN[vista.yo.rol]}`;
    }
    if (!fin || isNaN(fin)) { rl.hidden = true; document.body.classList.remove('con-reloj'); return; }
    rl.hidden = false;
    document.body.classList.add('con-reloj');
    const ms = fin - ahoraServidor();
    const seg = Math.max(0, Math.ceil(ms / 1000));
    $('cab').textContent = etiqueta;
    $('rl-seg').textContent = ms <= 0 && s.estado === 'jugando' ? 'Cerrando…' : `⏱ ${Math.floor(seg / 60)}:${String(seg % 60).padStart(2, '0')}`;
    $('rl-prog').style.transform = `scaleX(${Math.max(0, Math.min(1, ms / (total * 1000)))})`;
    rl.classList.toggle('rojo', seg <= 10);

    // Si se acaba el tiempo y no enviaste nada, se envía automáticamente lo que tienes en pantalla
    if (s.estado === 'jugando' && ms <= 2000 && ms > -2500 && vista.miDec === null
        && vista.semana.ronda === actual && autoRonda !== actual && pantalla === 'juego') {
      autoRonda = actual;
      enviarDec(true).catch(() => {});   // un solo intento por semana
    }
  }

  // ---------- FIN ----------
  function pintarFin() {
    if (pantalla !== 'fin') construir('fin');
    const total = JR.puntajes(estado);
    const ganador = total.A > total.B ? 'A' : total.B > total.A ? 'B' : null;
    const ult = estado.historial[estado.historial.length - 1];
    const yo = datos.yo;
    const equipos = (ganador ? [ganador, ganador === 'A' ? 'B' : 'A'] : ['A', 'B']).map((X) => {
      const integrantes = ROLES.map((rol) => datos.jugadores.find((j) => j.equipo === X && j.rol === rol)).filter(Boolean)
        .map((j) => `<div class="int">${avatar(j.avatar, 'med')} <div><b>${esc(j.nombre)}</b>${j.es_bot ? ' 🤖' : ''}<br><small>${escena(j.rol, '')}${ROLN[j.rol]}</small></div></div>`).join('');
      const etiqueta = !ganador ? 'Empate' : X === ganador ? '🏆 Ganadores' : 'Perdedores';
      return `<div class="equipo ${ganador && X === ganador ? 'gana' : ''}"><h3>${esc(EQ[X])} · ${etiqueta}</h3>
        <p class="${total[X] >= 0 ? 'pos' : 'neg'}"><b>${money(total[X])}</b></p>${integrantes}</div>`;
    }).join('');
    render($('fin'), `
      <h1>Partida terminada</h1>
      <p class="ganador">${ganador
        ? `🏆 Gana ${esc(EQ[ganador])}${yo && yo.equipo === ganador ? ' (¡tu equipo!)' : ''}`
        : 'Empate'}</p>
      <div class="fila">${equipos}</div>
      ${htmlMarc(yo, ult)}
      <button class="principal" data-accion="salir">Nueva partida</button>
      <p class="ayuda">Versión del juego: ${esc(JR.VERSION)}</p>`);
    tick();
  }

  // ---------- ARRANQUE ----------
  if (sala) {
    refrescar();
  } else {
    construir('home');
  }
  setInterval(refrescar, 1200);
  setInterval(tick, 250);
})();
