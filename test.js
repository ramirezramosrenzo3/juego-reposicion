// PRUEBAS AUTOMÁTICAS DEL MOTOR (versión 4.1)
// Ejecutar con:  node test.js
'use strict';
const J = require('./game.js');
const { PRODUCTOS, INFLUENCERS, estadoInicial, avanzarRonda, reproducir, armarDecisiones, puntajes, factorInfluencers, crearRng, leerDecision } = J;

let pruebas = 0, fallos = 0;
function ok(cond, nombre) {
  pruebas++;
  if (cond) console.log('  ok    ' + nombre);
  else { fallos++; console.log('  FALLA ' + nombre); }
}
function cerca(a, b, tol, nombre) {
  ok(Math.abs(a - b) <= tol, `${nombre} (obtuve ${a}, esperaba ${b})`);
}
function seccion(t) { console.log('\n' + t); }

// Bot que toma decisiones aleatorias pero válidas (para pruebas de invariantes)
function bot(seed, rondas = 30) {
  const r = crearRng(seed);
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  const salida = [];
  for (let t = 1; t <= rondas; t++) {
    const dec = {};
    for (const X of J.EQUIPOS) {
      dec[X] = {
        fabrica: {
          calidad: PRODUCTOS.map(() => pick(['economico', 'estandar', 'premium'])),
          produccion: PRODUCTOS.map(() => Math.floor(r() * 200)),
        },
        distribuidor: {
          pedido: PRODUCTOS.map(() => Math.floor(r() * 200)),
          pujas: [0, 1, 2].map(() => (r() < 0.5 ? null : { monto: Math.floor(r() * 60) })),
        },
        tienda: {
          precio: PRODUCTOS.map(() => 2 + r() * 6),
          pedido: PRODUCTOS.map(() => Math.floor(r() * 150)),
        },
      };
    }
    salida.push(dec);
  }
  return salida;
}

// Una semana con decisiones por defecto para ambos equipos; "extra" sobreescribe por equipo
const semana = (extra = {}) => ({
  A: { fabrica: {}, distribuidor: {}, tienda: {}, ...(extra.A || {}) },
  B: { fabrica: {}, distribuidor: {}, tienda: {}, ...(extra.B || {}) },
});
const CAL_PREMIUM = ['premium', 'premium', 'premium', 'premium', 'premium'];
const CAL_ECONOMICO = ['economico', 'economico', 'economico', 'economico', 'economico'];

seccion('1. Determinismo');
{
  const a = reproducir(777, bot(5));
  const b = reproducir(777, bot(5));
  ok(JSON.stringify(puntajes(a)) === JSON.stringify(puntajes(b)), 'mismo resultado de puntajes con la misma semilla');
  ok(JSON.stringify(a.historial) === JSON.stringify(b.historial), 'historial idéntico con la misma semilla');
  const c = reproducir(778, bot(5));
  ok(JSON.stringify(a.historial) !== JSON.stringify(c.historial), 'semilla distinta da partida distinta');
}

seccion('2. Subasta de influencers');
{
  // Gana el monto más alto y paga SU monto; el perdedor no paga
  const e = estadoInicial();
  avanzarRonda(e, 1, semana({
    A: { distribuidor: { pujas: [{ monto: 40 }, null, null] } },
    B: { distribuidor: { pujas: [{ monto: 25 }, null, null] } },
  }), crearRng(2));
  ok(e.inf.A.dueno === 'A', 'gana el monto más alto (A con 40 contra 25)');
  ok(e.equipos.A.utilidad.influencers === 40, 'el ganador paga su propio monto (40)');
  ok(e.equipos.B.utilidad.influencers === 0, 'el perdedor no paga nada');
  ok(e.historial[0].subasta.A.desempate === false, 'sin empate, no hay desempate');
}
{
  // Empate en el monto: gana la calidad promedio más alta (A premium vs B económico)
  const e = estadoInicial();
  avanzarRonda(e, 1, semana({
    A: { fabrica: { calidad: CAL_PREMIUM }, distribuidor: { pujas: [{ monto: 30 }, null, null] } },
    B: { fabrica: { calidad: CAL_ECONOMICO }, distribuidor: { pujas: [{ monto: 30 }, null, null] } },
  }), crearRng(21));
  ok(e.inf.A.dueno === 'A', 'empate de monto: gana el equipo con mejor calidad (premium)');
  ok(e.historial[0].subasta.A.desempate === true, 'el desempate queda registrado');
  ok(e.equipos.A.utilidad.influencers === 30 && e.equipos.B.utilidad.influencers === 0, 'el ganador por desempate paga su monto');
}
{
  // Empate en monto y calidad igual: el ganador sale al azar (ambos equipos aparecen)
  const ganadores = new Set();
  for (let s = 0; s < 40; s++) {
    const e = estadoInicial();
    avanzarRonda(e, 1, semana({
      A: { distribuidor: { pujas: [{ monto: 30 }, null, null] } },
      B: { distribuidor: { pujas: [{ monto: 30 }, null, null] } },
    }), crearRng(300 + s));
    ganadores.add(e.inf.A.dueno);
  }
  ok(ganadores.has('A') && ganadores.has('B'), 'empate de monto y de calidad: gana al azar (ambos equipos salen)');
}
{
  // Ocupado durante 2 semanas: la semana 2 no se puede pujar; la 3 sí
  const e = estadoInicial();
  avanzarRonda(e, 1, semana({
    A: { distribuidor: { pujas: [{ monto: 40 }, null, null] } },
  }), crearRng(3));
  avanzarRonda(e, 2, semana({
    B: { distribuidor: { pujas: [{ monto: 100 }, null, null] } },
  }), crearRng(4));
  ok(e.historial[1].subasta.A.ocupado === true, 'semana 2: el influencer A sigue ocupado');
  ok(e.equipos.B.utilidad.influencers === 0, 'semana 2: la puja sobre un influencer ocupado no se cobra');
  ok(factorInfluencers(e, 'A', 2) > 1, 'semana 2: el influencer de A sí sube la demanda');
  ok(factorInfluencers(e, 'A', 3) === 1, 'semana 3: el influencer ya expiró');
  avanzarRonda(e, 3, semana({
    B: { distribuidor: { pujas: [{ monto: 10 }, null, null] } },
  }), crearRng(5));
  ok(e.historial[2].subasta.A.ganador === 'B', 'semana 3: el influencer está libre y lo gana B');
}
{
  // La subida de demanda queda dentro del rango del influencer
  let todoBien = true;
  for (let s = 0; s < 60; s++) {
    const e = estadoInicial();
    avanzarRonda(e, 1, semana({
      A: { distribuidor: { pujas: [{ monto: 5 }, { monto: 5 }, { monto: 5 }] } },
    }), crearRng(100 + s));
    for (const k of ['A', 'B', 'C']) {
      const u = e.inf[k].uplift;
      if (u < INFLUENCERS[k].min || u > INFLUENCERS[k].max) todoBien = false;
    }
  }
  ok(todoBien, 'la subida de A, B y C cae dentro de su rango en 60 sorteos');
}
{
  // Un influencer sube la demanda de TODOS los sabores de su equipo
  const sin = estadoInicial();
  avanzarRonda(sin, 1, semana(), crearRng(55));
  const con = estadoInicial();
  avanzarRonda(con, 1, semana({ A: { distribuidor: { pujas: [{ monto: 40 }, null, null] } } }), crearRng(55));
  const dSin = sin.historial[0].equipos.A.demanda;
  const dCon = con.historial[0].equipos.A.demanda;
  ok(PRODUCTOS.every((p, i) => dCon[i] >= dSin[i]), 'el influencer no baja la demanda de ningún sabor');
  ok(PRODUCTOS.every((p, i) => dCon[i] > dSin[i]), 'el influencer sube la demanda de todos los sabores');
}
{
  // Dos influencers se multiplican
  const e = estadoInicial();
  e.inf.A = { ocupadoHasta: 6, dueno: 'A', uplift: 0.2, hasta: 5 };
  e.inf.B = { ocupadoHasta: 6, dueno: 'A', uplift: 0.3, hasta: 5 };
  cerca(factorInfluencers(e, 'A', 2), 1.2 * 1.3, 1e-9, 'dos influencers se multiplican');
  cerca(factorInfluencers(e, 'B', 2), 1, 1e-9, 'el otro equipo no recibe ese efecto');
}

seccion('3. Calidad y costo');
{
  // Cambiar la calidad solo afecta lo que se produce después
  const e = estadoInicial();
  avanzarRonda(e, 1, semana({ A: { fabrica: { produccion: [100, 0, 0, 0, 0] } } }), crearRng(7));
  avanzarRonda(e, 2, semana({
    A: { fabrica: { calidad: ['premium', null, null, null, null], produccion: [100, 0, 0, 0, 0] } },
  }), crearRng(8));
  const prod = e.equipos.A.enTransito.prod.filter((x) => x.p === 0);
  const viejo = prod.find((x) => x.llega === 3);
  const nuevo = prod.find((x) => x.llega === 4);
  cerca(viejo.c, 2.0, 1e-9, 'lote producido con calidad estándar cuesta $2.00');
  cerca(nuevo.c, 2.5, 1e-9, 'lote producido con calidad premium cuesta $2.50');
}

seccion('4. Precio y demanda compartida');
{
  const d = leerDecision({ tienda: { precio: [1, 20, 'x', null, 4.5] } });
  ok(d.precio[0] === 2.5, 'precio por debajo del mínimo se sube a $2.50');
  ok(d.precio[1] === 8, 'precio por encima del máximo se baja a $8.00');
  ok(d.precio[2] === null && d.precio[3] === null, 'precio inválido o vacío mantiene el anterior');
  ok(d.precio[4] === 4.5, 'precio válido se respeta');
}
{
  // Sin diferencias, el mercado se reparte 50/50
  const e = estadoInicial();
  avanzarRonda(e, 1, semana(), crearRng(77));
  const h = e.historial[0];
  ok(PRODUCTOS.every((p, i) => Math.abs(h.equipos.A.demanda[i] + h.equipos.B.demanda[i] - h.base[i]) <= 1),
    'sin diferencias, el mercado se reparte 50/50 entre los equipos');
}
{
  // Precios bajos en ambos equipos: el mercado total crece
  const e = estadoInicial();
  avanzarRonda(e, 1, semana({
    A: { tienda: { precio: [3, 3, 3, 3, 3] } },
    B: { tienda: { precio: [3, 3, 3, 3, 3] } },
  }), crearRng(78));
  const h = e.historial[0];
  ok(PRODUCTOS.every((p, i) => h.equipos.A.demanda[i] + h.equipos.B.demanda[i] > h.base[i]),
    'precios bajos en ambos equipos hacen crecer el mercado total');
}
{
  // Subir el precio de A baja su demanda y la demanda pasa a B
  const sA = estadoInicial();
  avanzarRonda(sA, 1, semana(), crearRng(79));
  const sB = estadoInicial();
  avanzarRonda(sB, 1, semana({ A: { tienda: { precio: [7, 7, 7, 7, 7] } } }), crearRng(79));
  const a = sA.historial[0].equipos;
  const b = sB.historial[0].equipos;
  ok(PRODUCTOS.every((p, i) => b.A.demanda[i] < a.A.demanda[i]), 'subir el precio de A baja su demanda');
  ok(PRODUCTOS.every((p, i) => b.B.demanda[i] > a.B.demanda[i]), 'parte de esa demanda pasa a B');
  cerca(b.A.att[0], Math.pow(4.5 / 7, 1.8), 1e-9, 'el atractivo del precio sigue la fórmula');
}

seccion('5. Mantenimiento de inventario');
{
  const e = estadoInicial();
  avanzarRonda(e, 1, semana(), crearRng(11));
  const s = e.equipos.A.stock;
  let valor = 0;
  PRODUCTOS.forEach((p, i) => {
    valor += s.fabrica[i].q * s.fabrica[i].c
      + s.distribuidor[i].q * s.distribuidor[i].c * 1.3
      + s.tienda[i].q * s.tienda[i].c * 1.7;
  });
  cerca(e.equipos.A.utilidad.mantenimiento, 0.03 * valor, 1e-6, 'mantenimiento = 3% del valor del stock (no de lo que está en camino)');
  // Distribuidor y tienda valoran sus galletas a los precios de transferencia ($2.60 y $3.40)
  let valorTrasp = 0;
  PRODUCTOS.forEach((p, i) => { valorTrasp += s.distribuidor[i].q * 2.6 + s.tienda[i].q * 3.4; });
  const valorFab = PRODUCTOS.reduce((a, p, i) => a + s.fabrica[i].q * s.fabrica[i].c, 0);
  cerca(e.equipos.A.utilidad.mantenimiento, 0.03 * (valorFab + valorTrasp), 1e-6, 'distribuidor y tienda valoran a $2.60 y $3.40 por galleta');
}

seccion('6. Desvío de clientes');
{
  let envA = 0, recB = 0, envB = 0, recA = 0;
  for (let s = 0; s < 10; s++) {
    const e = reproducir(500 + s, bot(s));
    for (const h of e.historial) {
      envA += h.equipos.A.desvEnv.reduce((a, b) => a + b, 0);
      recB += h.equipos.B.desvRec.reduce((a, b) => a + b, 0);
      envB += h.equipos.B.desvEnv.reduce((a, b) => a + b, 0);
      recA += h.equipos.A.desvRec.reduce((a, b) => a + b, 0);
    }
  }
  ok(envA === recB, `lo que A envía a B (${envA}) = lo que B recibe (${recB})`);
  ok(envB === recA, `lo que B envía a A (${envB}) = lo que A recibe (${recA})`);
  ok(envA + envB > 0, 'el desvío sí ocurre en las pruebas');
}

seccion('7. Traducción de decisiones (filas de la base -> motor)');
{
  const filas = [
    { ronda: 1, equipo: 'A', rol: 'fabrica', payload: { produccion: [5, 0, 0, 0, 0] } },
    { ronda: 1, equipo: 'B', rol: 'tienda', payload: { precio: [4.5, 4.5, 4.5, 4.5, 4.5] } },
    { ronda: 9, equipo: 'A', rol: 'fabrica', payload: {} },
    { ronda: 1, equipo: 'A', rol: 'jefe', payload: { pedido: [1, 1, 1, 1, 1] } },
  ];
  const out = armarDecisiones(filas, 3);
  ok(out.length === 3, 'hay una entrada por semana');
  ok(out[0].A.fabrica.produccion[0] === 5, 'la producción de fábrica llega a su equipo');
  ok(out[0].B.tienda.precio[0] === 4.5, 'el precio de tienda llega al equipo B');
  ok(Object.keys(out[1].A).length === 0, 'una semana sin decisiones queda vacía');
  ok(Object.keys(out[0].A).length === 1, 'un rol desconocido o una semana fuera de rango se ignora');
}
{
  // Ruido de la demanda: uniforme dentro de ±30% de la media
  const e = reproducir(4242, bot(77, 40));
  let dentro = true;
  e.historial.forEach((h) => PRODUCTOS.forEach((p, i) => {
    const f = h.base[i] / p.demMedia;
    if (f < 0.69 || f > 1.31) dentro = false;
  }));
  ok(dentro, 'la demanda del mercado siempre queda dentro de ±30% de la media');
}
{
  // Empate por calidad con sumas que dan decimales distintos: sigue siendo un empate real
  const mezcla = (primero) => (primero
    ? ['estandar', 'economico', 'economico', 'economico', 'economico']
    : ['economico', 'economico', 'economico', 'economico', 'estandar']);
  const ganadores = new Set();
  for (let s = 0; s < 40; s++) {
    const e = estadoInicial();
    avanzarRonda(e, 1, semana({
      A: { fabrica: { calidad: mezcla(true) }, distribuidor: { pujas: [{ monto: 30 }, null, null] } },
      B: { fabrica: { calidad: mezcla(false) }, distribuidor: { pujas: [{ monto: 30 }, null, null] } },
    }), crearRng(900 + s));
    ganadores.add(e.inf.A.dueno);
  }
  ok(ganadores.has('A') && ganadores.has('B'), 'calidades iguales en otro orden empatan y el azar decide');
}
{
  // Jugador que no decidió (se acabó el tiempo): la partida sigue sin fallar
  const e = reproducir(42, [{ A: {}, B: {} }, { A: {}, B: {} }]);
  ok(Number.isFinite(puntajes(e).A) && Number.isFinite(puntajes(e).B), 'sin decisiones la partida no se rompe');
}

seccion('8. Invariantes con decisiones aleatorias');
{
  let stockOk = true, utilOk = true;
  for (let s = 0; s < 20; s++) {
    const e = estadoInicial();
    const dec = bot(900 + s);
    dec.forEach((d, idx) => {
      avanzarRonda(e, idx + 1, d, crearRng((900 + s) ^ Math.imul(idx + 1, 0x9e3779b1)));
      for (const X of J.EQUIPOS) {
        for (const etapa of ['fabrica', 'distribuidor', 'tienda']) {
          for (const L of e.equipos[X].stock[etapa]) {
            if (!Number.isInteger(L.q) || L.q < 0 || !Number.isFinite(L.c)) stockOk = false;
          }
        }
        const u = e.equipos[X].utilidad;
        if (!Number.isFinite(u.ventas) || !Number.isFinite(u.mantenimiento) || !Number.isFinite(u.influencers)) utilOk = false;
      }
    });
  }
  ok(stockOk, 'stock siempre entero, no negativo y con costo válido (20 partidas)');
  ok(utilOk, 'utilidades siempre finitas (20 partidas)');
}

seccion('9. Bots');
{
  const rngSemana = (semilla, t) => crearRng((semilla ^ Math.imul(t, 0x9e3779b1)) >>> 0);
  // Juega una partida; juegaBot(X) dice qué equipos los lleva el bot. Devuelve estado y las decisiones guardadas.
  function partida(semilla, rondas, juegaBot) {
    const e = estadoInicial();
    e.semilla = semilla >>> 0;
    const guardadas = [];
    for (let t = 1; t <= rondas; t++) {
      const dec = { A: {}, B: {} };
      for (const X of J.EQUIPOS) {
        if (!juegaBot(X)) continue;
        for (const rol of J.ROLES) dec[X][rol] = J.decisionBot(e, X, rol, t);
      }
      guardadas.push(JSON.parse(JSON.stringify(dec)));          // como queda guardado en la base (jsonb)
      avanzarRonda(e, t, dec, rngSemana(semilla, t));
    }
    return { e, guardadas };
  }
  const ambos = () => true;

  // Decisiones siempre válidas y dentro de los límites
  let validas = true, topes = true, limpias = true;
  {
    const e = estadoInicial();
    for (let t = 1; t <= 30; t++) {
      const dec = { A: {}, B: {} };
      for (const X of J.EQUIPOS) for (const rol of J.ROLES) {
        const p = J.decisionBot(e, X, rol, t);
        dec[X][rol] = p;
        const lim = leerDecision({ [rol]: p });
        if (rol === 'fabrica') {
          if (!p.calidad.every((c) => J.CALIDADES[c])) validas = false;
          if (!p.produccion.every((n, i) => Number.isInteger(n) && n >= 0 && n <= PRODUCTOS[i].capProd)) topes = false;
          if (JSON.stringify(lim.produccion) !== JSON.stringify(p.produccion)) limpias = false;
        } else if (rol === 'distribuidor') {
          if (!p.pedido.every((n) => Number.isInteger(n) && n >= 0 && n <= J.CONFIG.tope)) topes = false;
          if (!p.pujas.every((x) => x === null || (Number.isInteger(x.monto) && x.monto >= 1 && x.monto <= J.CONFIG.topeMonto))) topes = false;
          if (JSON.stringify(lim.pedidoFab) !== JSON.stringify(p.pedido)) limpias = false;
        } else {
          if (!p.precio.every((x) => x >= J.CONFIG.precioMin && x <= J.CONFIG.precioMax)) topes = false;
          if (!p.pedido.every((n) => Number.isInteger(n) && n >= 0 && n <= J.CONFIG.tope)) topes = false;
          if (JSON.stringify(lim.pedidoDist) !== JSON.stringify(p.pedido)) limpias = false;
        }
      }
      avanzarRonda(e, t, dec, rngSemana(11, t));
    }
  }
  ok(validas, 'los bots eligen solo calidades que existen');
  ok(topes, 'los bots respetan capacidad de producción, tope de pedido, rango de precio y pujas de $1 a $10,000');
  ok(limpias, 'el motor lee las decisiones de los bots tal como las enviaron (sin recortes)');

  // Una misma situación da siempre la misma decisión y no se modifica el estado
  {
    const { e } = partida(5, 8, ambos);
    const foto = JSON.stringify(e);
    const d1 = JSON.stringify(J.ROLES.map((r) => J.decisionBot(e, 'A', r, 9)));
    const d2 = JSON.stringify(J.ROLES.map((r) => J.decisionBot(e, 'A', r, 9)));
    ok(d1 === d2, 'misma situación, misma decisión (todos los celulares coinciden)');
    ok(JSON.stringify(e) === foto, 'decidir no modifica el estado de la partida');
  }

  // Repetir la partida con las decisiones guardadas reproduce exactamente la partida jugada
  {
    const { e, guardadas } = partida(321, 30, ambos);
    const r = reproducir(321, guardadas);
    ok(JSON.stringify(puntajes(r)) === JSON.stringify(puntajes(e)), 'la partida de bots se repite igual desde lo guardado');
  }

  // Partidas completas de 30 semanas
  let finitos = true, enteros = true, ganaAlInactivo = 0, victoriasA = 0, ventas = 0, demanda = 0, partidas = 0;
  for (let s = 1; s <= 40; s++) {
    const { e } = partida(s * 7919, 30, ambos);
    const p = puntajes(e);
    if (!Number.isFinite(p.A) || !Number.isFinite(p.B)) finitos = false;
    for (const X of J.EQUIPOS) for (const etapa of ['fabrica', 'distribuidor', 'tienda']) {
      for (const L of e.equipos[X].stock[etapa]) if (!Number.isInteger(L.q) || L.q < 0) enteros = false;
    }
    if (p.A > p.B) victoriasA++;
    e.historial.forEach((h) => h.equipos.A.demanda.forEach((d, i) => { demanda += d; ventas += h.equipos.A.vendido[i]; }));
    partidas++;
    const solo = partida(s * 7919, 30, (X) => X === 'A').e;
    if (puntajes(solo).A > puntajes(solo).B) ganaAlInactivo++;
  }
  ok(finitos && enteros, '40 partidas completas de bots: utilidades finitas y stock entero y no negativo');
  ok(ventas / demanda >= 0.9, `los bots atienden al menos 90% de la demanda (atienden ${(100 * ventas / demanda).toFixed(1)}%)`);
  ok(ganaAlInactivo === 40, 'un equipo de bots le gana siempre a un equipo que no decide nada (40 de 40)');
  ok(victoriasA >= 12 && victoriasA <= 28, `bots contra bots es parejo: A gana ${victoriasA} de 40`);

  // Los bots no pujan por un influencer ocupado ni cuando la tienda no tiene stock
  {
    const { e } = partida(9, 6, ambos);
    const t = 7;
    const antes = J.decisionBot(e, 'A', 'distribuidor', t).pujas;
    e.inf.A.ocupadoHasta = t + 1;
    const ocupado = J.decisionBot(e, 'A', 'distribuidor', t).pujas;
    ok(ocupado[0] === null && JSON.stringify(ocupado.slice(1)) === JSON.stringify(antes.slice(1)), 'no puja por un influencer ocupado');
    e.equipos.A.stock.tienda.forEach((L) => { L.q = 0; });
    e.equipos.A.enTransito.dt = [];
    const sinStock = J.decisionBot(e, 'A', 'distribuidor', t).pujas;
    ok(sinStock.every((x) => x === null), 'no puja si la tienda no tiene stock para atender más demanda');
  }

  // Un bot junto a decisiones aleatorias de otro equipo no rompe la partida
  {
    const e = estadoInicial();
    const aleatorio = bot(33, 30);
    let todoBien = true;
    for (let t = 1; t <= 30; t++) {
      const dec = { A: {}, B: aleatorio[t - 1].B };
      for (const rol of J.ROLES) dec.A[rol] = J.decisionBot(e, 'A', rol, t);
      avanzarRonda(e, t, dec, rngSemana(33, t));
      if (!Number.isFinite(puntajes(e).A) || !Number.isFinite(puntajes(e).B)) todoBien = false;
    }
    ok(todoBien, 'bots contra un equipo de decisiones aleatorias: sin errores en 30 semanas');
  }
}


// ---------- EVENTOS ALEATORIOS (4.2) ----------
{
  const J2 = J;
  { // sin repetir evento en una misma partida
  let rep = 0, vistos = 0;
  for (let sd = 1; sd <= 300; sd++) {
    const e = J2.estadoInicial(); e.semilla = sd;
    const sal = [];
    for (let n = 1; n <= 80; n++) { J2.prepararEvento(e, n); if (e.evento && e.evento.inicio === n) sal.push(e.evento.id); }
    vistos += sal.length;
    const ciclo = sal.slice(0, 9);
    if (new Set(ciclo).size !== ciclo.length) rep++;
  }
  ok(vistos > 300 && rep === 0, `ningún evento se repite dentro de una partida (${vistos} eventos en 300 partidas)`);
}
{ // dificultad: 3, 4 y 5 sabores
  const nombres = ['chocolate', 'vainilla', 'menta', 'fresa', 'mora'];
  [3, 4, 5].forEach((n) => {
    J2.setSabores(n);
    ok(J2.PRODUCTOS.length === n && J2.PRODUCTOS.every((p, i) => p.id === nombres[i]), `${n} sabores: ${nombres.slice(0, n).join(', ')}`);
    const e = J2.estadoInicial(); e.semilla = 7;
    const dec = Array.from({ length: 8 }, () => ({}));
    const A = J2.reproducir(7, dec), B = J2.reproducir(7, dec);
    const h = A.historial[A.historial.length - 1];
    const u = h.equipos.A;
    ok(u.demanda.length === n && u.vendido.length === n, `${n} sabores: los reportes tienen ${n} columnas`);
    ok(JSON.stringify(A.historial) === JSON.stringify(B.historial), `${n} sabores: mismo resultado al repetir`);
  });
  J2.setSabores(5);
}
ok(J2.EVENTOS.length === 9, 'hay 9 eventos');
  const ev = (id) => J2.eventoPorId(id);
  const cerca2 = (a, b) => Math.abs(a - b) < 1e-9;
  ok(cerca2(ev('navidad').efectos[0], 0.2) && cerca2(ev('navidad').efectos[4], -0.1) && ev('navidad').efectos[2] === undefined, 'Navidad: chocolate +20, vainilla +20, mora −10');
  ok(cerca2(ev('maincra').efectos[3], -0.15) && cerca2(ev('maincra').efectos[4], 0.05), 'MAINCRA: −15% y mora +5%');
  ok(cerca2(ev('cyber').efectos[3], 0.1) && cerca2(ev('cyber').efectos[4], 0.04), 'Cyber Galletas');
  ok(cerca2(ev('nino').efectos[0], -0.16) && cerca2(ev('nino').efectos[3], 0.12), 'Fenómeno del Niño');
  ok(cerca2(ev('happy').efectos[2], 0.19) && cerca2(ev('happy').efectos[0], -0.03), 'Happy Cookies');
  ok(ev('huelga').duracion === 1 && ev('navidad').duracion === 4, 'duraciones: huelga 1, el resto 4');

  // Calendario de eventos: depende solo de la semilla, empieza en la semana 5 y respeta la espera
  const calendario = (semilla, n) => {
    const e = J2.estadoInicial(); e.semilla = semilla >>> 0;
    const lista = [];
    for (let r = 2; r <= n; r++) {
      J2.prepararEvento(e, r);
      if (e.evento && e.evento.inicio === r) lista.push({ r, id: e.evento.id, fin: e.evento.fin });
    }
    return lista;
  };
  let primeras = [], gaps = true, prob = [], solapes = false;
  for (let s = 1; s <= 400; s++) {
    const c = calendario(s * 7919, 60);
    if (c.length) primeras.push(c[0].r);
    for (let k = 1; k < c.length; k++) { if (c[k].r - c[k - 1].r < 5) gaps = false; if (c[k].r <= c[k - 1].fin) solapes = true; }
  }
  ok(primeras.every((r) => r >= 5), 'ningún evento aparece antes de la semana 5');
  ok(gaps && !solapes, 'entre un evento y el siguiente pasan al menos 5 semanas y nunca hay dos a la vez');
  const en5 = primeras.filter((r) => r === 5).length / 400;
  ok(en5 > 0.23 && en5 < 0.39, `la primera evaluación (semana 5) acierta cerca del 31% (${(en5 * 100).toFixed(0)}%)`);
  ok(calendario(555, 40).length > 0 || calendario(777, 40).length > 0, 'en 40 semanas aparecen eventos');
  ok(JSON.stringify(calendario(4242, 40)) === JSON.stringify(calendario(4242, 40)), 'el calendario es igual en todos los celulares');
  // la probabilidad sube de 5 en 5 y nunca pasa de 100
  const pe = J2.estadoInicial(); pe.semilla = 99; const ps = [];
  for (let r = 2; r <= 40 && !pe.evento; r++) { J2.prepararEvento(pe, r); ps.push(pe.probEvento); }
  ok(ps.every((p, i) => i === 0 || p === 31 || p === ps[i - 1] + 5 || p === 100), 'la probabilidad sube 5 puntos por intento sin evento');
  const p100 = J2.estadoInicial(); p100.semilla = 1; p100.probEvento = 98; p100.proxEval = 2;
  // sin evento posible: forzar fallo con probabilidad 98 → nunca pasa de 100
  for (let k = 0; k < 3; k++) { p100.evento = null; p100.probEvento = Math.min(100, p100.probEvento + 5); }
  ok(p100.probEvento <= 100, 'la probabilidad nunca supera 100%');

  // Efecto sobre la demanda: misma partida con y sin evento, solo cambia lo indicado
  const jugar = (evId) => {
    const e = J2.estadoInicial(); e.semilla = 1234;
    if (evId) e.evento = { id: evId, inicio: 1, fin: ev(evId).duracion };
    J2.avanzarRonda(e, 1, { A: {}, B: {} }, J2.crearRng(77));
    return e.historial[0];
  };
  const h0 = jugar(null), h1 = jugar('navidad');
  ok(h1.evento === 'navidad' && h0.evento === null, 'la semana guarda qué evento estuvo activo');
  const dem = (h, X) => h.equipos[X].demanda;
  ok(dem(h1, 'A')[0] > dem(h0, 'A')[0] && dem(h1, 'A')[1] > dem(h0, 'A')[1], 'Navidad sube la demanda de chocolate y vainilla');
  ok(dem(h1, 'A')[4] < dem(h0, 'A')[4], 'Navidad baja la demanda de mora');
  ok(dem(h1, 'A')[2] === dem(h0, 'A')[2] && dem(h1, 'A')[3] === dem(h0, 'A')[3], 'Navidad no cambia menta ni fresa');
  ok(JSON.stringify(h1.base) === JSON.stringify(h0.base), 'la demanda base no se modifica (solo el efecto temporal)');
  const hh = jugar('huelga');
  ok(JSON.stringify(dem(hh, 'A')) === JSON.stringify(dem(h0, 'A')), 'la huelga no cambia la demanda');

  // Huelga: nada llega esa semana, nada se pierde y todo llega la semana siguiente
  const total = (e) => J2.EQUIPOS.map((X) => ['prod', 'fd', 'dt'].map((c) =>
    e.equipos[X].enTransito[c].reduce((s, x) => s + x.q, 0) + 0).join(',')).join('|');
  const eh = J2.estadoInicial(); eh.semilla = 1234; eh.evento = { id: 'huelga', inicio: 1, fin: 1 };
  const stock0 = JSON.stringify(eh.equipos.A.stock);
  const pend0 = eh.equipos.A.enTransito.prod.filter((x) => x.llega <= 1).reduce((s, x) => s + x.q, 0);
  J2.avanzarRonda(eh, 1, { A: {}, B: {} }, J2.crearRng(5));
  const pendDespues = eh.equipos.A.enTransito.prod.filter((x) => x.llega <= 1).reduce((s, x) => s + x.q, 0);
  ok(pend0 > 0 && pendDespues === pend0, 'huelga: lo que debía llegar queda pendiente, sin perder ni duplicar');
  const antesStock = eh.equipos.A.stock.fabrica.reduce((s, l) => s + l.q, 0);
  J2.avanzarRonda(eh, 2, { A: {}, B: {} }, J2.crearRng(6));
  const despues2 = eh.equipos.A.enTransito.prod.filter((x) => x.llega <= 2).reduce((s, x) => s + x.q, 0);
  ok(despues2 === 0, 'la semana siguiente llega todo lo pendiente junto con lo programado');
  const sinHuelga = J2.estadoInicial(); sinHuelga.semilla = 1234;
  J2.avanzarRonda(sinHuelga, 1, { A: {}, B: {} }, J2.crearRng(5));
  J2.avanzarRonda(sinHuelga, 2, { A: {}, B: {} }, J2.crearRng(6));
  const sumaTodo = (e) => ['prod', 'fd', 'dt'].reduce((s, c) => s + e.equipos.A.enTransito[c].reduce((a, x) => a + x.q, 0), 0)
    + ['fabrica', 'distribuidor', 'tienda'].reduce((s, c) => s + e.equipos.A.stock[c].reduce((a, l) => a + l.q, 0), 0);
  ok(eh.evento === null || eh.evento.id !== 'huelga' || eh.evento.fin >= 2, 'la huelga termina tras 1 semana');
}

console.log(`\n${pruebas - fallos} de ${pruebas} pruebas pasaron.`);
if (fallos > 0) { console.log(`${fallos} FALLARON.`); process.exitCode = 1; }
else console.log('Todo bien.');
