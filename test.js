// PRUEBAS AUTOMÁTICAS DEL MOTOR (versión 3)
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
  // Ruido de la demanda: uniforme dentro de ±20% de la media
  const e = reproducir(4242, bot(77, 40));
  let dentro = true;
  e.historial.forEach((h) => PRODUCTOS.forEach((p, i) => {
    const f = h.base[i] / p.demMedia;
    if (f < 0.79 || f > 1.21) dentro = false;
  }));
  ok(dentro, 'la demanda del mercado siempre queda dentro de ±20% de la media');
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

console.log(`\n${pruebas - fallos} de ${pruebas} pruebas pasaron.`);
if (fallos > 0) { console.log(`${fallos} FALLARON.`); process.exitCode = 1; }
else console.log('Todo bien.');
