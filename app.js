/* Lyric Pod 5.0 */
/* global showDirectoryPicker, MediaMetadata */
(function () {
  'use strict';

  /* ================= Utilidades ================= */
  function $(sel) { return document.querySelector(sel); }
  function $$(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }
  function esc(s) {
    var map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return map[c]; });
  }
  function fmt(s) {
    if (!isFinite(s)) { return '0:00'; }
    var m = Math.floor(s / 60), r = Math.floor(s % 60);
    return m + ':' + (r < 10 ? '0' : '') + r;
  }
  function tid(t) { return t.id !== undefined ? 'l' + t.id : t.uid; }
  function tkey(t) { return t.uid || 't' + t.id; }
  function last(arr) { return arr[arr.length - 1]; }

  /* ================= Color y tema ================= */
  var HEX = /^#[0-9a-f]{6}$/i;
  function toRgb(h) {
    var n = parseInt(h.slice(1), 16);
    return [n >> 16 & 255, n >> 8 & 255, n & 255];
  }
  function mix(h, other, a) {
    var A = toRgb(h), B = toRgb(other);
    return '#' + A.map(function (v, i) {
      var x = Math.round(v * (1 - a) + B[i] * a).toString(16);
      return x.length < 2 ? '0' + x : x;
    }).join('');
  }
  function lin(v) { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
  function lum(h) { var c = toRgb(h); return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]); }
  function ratio(a, b) {
    var x = lum(a), y = lum(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  }
  function bestInk(backgrounds) {
    var options = ['#f7f8fa', '#14161a'], best = options[0], bestScore = -1;
    options.forEach(function (o) {
      var worst = Math.min.apply(null, backgrounds.map(function (b) { return ratio(o, b); }));
      if (worst > bestScore) { bestScore = worst; best = o; }
    });
    return best;
  }

  var THEME = (function () {
    var t = { ipod: '#e6e7ea', bg: '#14151a', ac: '#ffd84a' };
    try {
      var saved = JSON.parse(localStorage.getItem('lp-theme') || '{}');
      Object.keys(t).forEach(function (k) { if (HEX.test(saved[k])) { t[k] = saved[k]; } });
    } catch (e) { console.warn('Tema no válido', e); }
    return t;
  })();

  function applyTheme() {
    var r = document.documentElement.style, p = THEME.ipod;
    var w1 = mix(p, '#ffffff', 0.55), w2 = mix(p, '#000000', 0.08);
    r.setProperty('--i0', mix(p, '#ffffff', 0.45));
    r.setProperty('--i1', p);
    r.setProperty('--i2', mix(p, '#000000', 0.22));
    r.setProperty('--w1', w1);
    r.setProperty('--w2', w2);
    r.setProperty('--c1', mix(p, '#ffffff', 0.3));
    r.setProperty('--c2', mix(p, '#000000', 0.14));
    r.setProperty('--wk', bestInk([w1, mix(p, '#ffffff', 0.22), w2]));
    r.setProperty('--bg', THEME.bg);
    r.setProperty('--bg2', mix(THEME.bg, '#ffffff', 0.12));
    r.setProperty('--ac', THEME.ac);
    var meta = $('meta[name="theme-color"]');
    if (meta) { meta.setAttribute('content', THEME.bg); }
    try { localStorage.setItem('lp-theme', JSON.stringify(THEME)); } catch (e) { console.warn(e); }
  }

  /* ================= Estado ================= */
  var db = null;
  var tracks = [], lists = [];
  var nav = [{ n: 'home' }];
  var ctx = [], sel = -1;
  var results = [], oq = '', source = 'audius';
  var cur = null, queue = [], objUrl = null;
  var lines = [], plain = '', lst = '', est = false, sy = null;
  var li = -1, kw = -2;
  var toff = 0;
  var shuf = false, rep = 0, editing = false;
  var installEvt = null, toastTimer = null, sleepTimer = null, sleepMin = 0;
  var offset = Number(localStorage.getItem('lpoff')) || 0;
  var au = new Audio();
  au.preload = 'auto';
  au.volume = Math.min(1, Math.max(0, Number(localStorage.getItem('lpvol') || 1)));

  var AUDIO_RE = /\.(mp3|wav|flac|m4a|aac|ogg|oga|opus|wma|weba)$/i;
  var UNKNOWN = 'Artista desconocido';
  var standalone = window.matchMedia('(display-mode: standalone)').matches;

  var ICON = {
    note: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3v11.3A3.5 3.5 0 1 0 11 17.5V8h8V3z"></path></svg>',
    shuffle: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h3.5c3.5 0 5 10 9 10H20M3 17h3.5c1.8 0 2.9-2.3 4-4.6M20 7h-4.5c-1.6 0-2.7 1.6-3.6 3.4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path><path d="M17.5 4.5L21 7l-3.5 2.5M17.5 14.5L21 17l-3.5 2.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg>',
    repeat: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11V9a3 3 0 0 1 3-3h12M20 13v2a3 3 0 0 1-3 3H5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path><path d="M16 3l3.5 3L16 9M8 15l-3.5 3L8 21" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg>',
    heart: function (on) {
      return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.5S3.5 15 3.5 9.2A4.7 4.7 0 0 1 12 7a4.7 4.7 0 0 1 8.5 2.2C20.5 15 12 20.5 12 20.5z" fill="' +
        (on ? 'currentColor' : 'none') + '" stroke="currentColor" stroke-width="2" stroke-linejoin="round"></path></svg>';
    }
  };

  /* ================= Base de datos (IndexedDB) ================= */
  function openDb() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open('LyricPodDatabase', 3);
      req.onupgradeneeded = function () {
        var d = req.result;
        ['tracks', 'playlists'].forEach(function (n) {
          if (!d.objectStoreNames.contains(n)) { d.createObjectStore(n, { keyPath: 'id', autoIncrement: true }); }
        });
        ['kv', 'ly'].forEach(function (n) {
          if (!d.objectStoreNames.contains(n)) { d.createObjectStore(n); }
        });
      };
      req.onsuccess = function () { db = req.result; resolve(); };
      req.onerror = function () { reject(req.error); };
    });
  }
  function tx(name, mode, fn) {
    return new Promise(function (resolve, reject) {
      var q = fn(db.transaction(name, mode).objectStore(name));
      q.onsuccess = function () { resolve(q.result); };
      q.onerror = function () { reject(q.error); };
    });
  }
  function dbAll(n) { return tx(n, 'readonly', function (s) { return s.getAll(); }); }
  function dbGet(n, k) { return tx(n, 'readonly', function (s) { return s.get(k); }); }
  function dbPut(n, v, k) { return tx(n, 'readwrite', function (s) { return k === undefined ? s.put(v) : s.put(v, k); }); }
  function dbDel(n, k) { return tx(n, 'readwrite', function (s) { return s['delete'](k); }); }

  function refresh() {
    if (!db) { render(true); return Promise.resolve(); }
    return Promise.all([dbAll('tracks'), dbAll('playlists')]).then(function (r) {
      tracks = r[0].sort(function (a, b) { return a.title.localeCompare(b.title); });
      lists = r[1].map(function (l) { l.ids = l.ids || l.trackIds || []; return l; });
      render(true);
    });
  }

  /* ================= Avisos ================= */
  function toast(msg) {
    var e = $('#toast');
    e.textContent = msg;
    e.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { e.classList.remove('on'); }, 2600);
  }
  function status(msg) {
    var e = $('#as');
    if (e) { e.textContent = msg; }
    toast(msg);
  }
  function fail(err) {
    console.error(err);
    toast('Algo salió mal. Intenta de nuevo.');
  }

  /* ================= Navegación ================= */
  var TITLES = {
    home: 'Lyric Pod', lib: 'Música', fav: 'Favoritos', rec: 'Recientes', pl: 'Playlists',
    plp: 'Añadir canciones', on: 'Música online', now: 'Reproduciendo', set: 'Ajustes', add: 'Agregar música'
  };
  function go(n, a) { nav.push({ n: n, a: a }); render(); }
  function back() { if (nav.length > 1) { nav.pop(); render(); } }
  function home() { nav = [{ n: 'home' }]; render(); }

  function coverCss(t) {
    if (t && t.cover) { return 'url("' + String(t.cover).replace(/["\\()\s]/g, encodeURIComponent) + '")'; }
    return 'linear-gradient(135deg, #2a5f9e, #0b0e13)';
  }

  function render(keep) {
    var page = last(nav), pg = $('#pg'), top = pg.scrollTop, scr = $('#screen');
    var title = TITLES[page.n];
    if (page.n === 'pld') {
      var pl = lists.filter(function (l) { return l.id === page.a; })[0];
      title = pl ? pl.name : 'Playlist';
    }
    $('#ttl').textContent = title;
    $('#back').style.visibility = nav.length > 1 ? 'visible' : 'hidden';
    scr.classList.toggle('dark', page.n === 'now' && !!cur);
    scr.style.setProperty('--cv', coverCss(cur));
    pg.innerHTML = views[page.n](page.a);
    pg.scrollTop = keep ? top : 0;
    sel = -1;
    if (page.n === 'now') { drawLyrics(); }
    if (page.n === 'set' && navigator.storage && navigator.storage.persisted) {
      navigator.storage.persisted().then(function (ok) {
        var e = $('#sg');
        if (e) { e.textContent = ok ? 'Almacenamiento protegido: tus datos no se borran solos.' : 'Almacenamiento sin proteger. Instala la app para protegerlo.'; }
      });
    }
  }

  /* ================= Vistas ================= */
  function coverBox(t) {
    return '<i class="cv">' + (t.cover ? '<img loading="lazy" src="' + esc(t.cover) + '" alt="">' : '&#9834;') + '</i>';
  }
  function trow(t, i, extra) {
    return '<div class="row' + (extra ? ' nc' : '') + '" data-a="pq" data-i="' + i + '">' + coverBox(t) +
      '<div class="t"><b>' + esc(t.title) + '</b><small>' + (t.fav ? '&#9829; ' : '') + esc(t.artist) + '</small></div>' + (extra || '') + '</div>';
  }
  function empty(msg) { return '<p class="pad">' + msg + '</p>'; }
  function trackList(arr, emptyMsg) {
    ctx = arr;
    if (!arr.length) { return empty(emptyMsg); }
    return arr.map(function (t, i) {
      return trow(t, i, editing && t.id !== undefined ? '<button type="button" class="btn danger" data-a="rt" data-i="' + t.id + '">Quitar</button>' : '');
    }).join('');
  }
  function libList(q) {
    var s = (q || '').toLowerCase();
    var arr = tracks.filter(function (t) { return (t.title + ' ' + t.artist).toLowerCase().indexOf(s) !== -1; });
    return trackList(arr, tracks.length ? 'Sin resultados.' : 'Todavía no hay canciones. Ve a Agregar música.');
  }
  function resList() {
    ctx = results;
    return results.map(function (t, i) {
      return trow(t, i, t.preview ? '' : '<button type="button" class="btn" data-a="sv" data-i="' + i + '">Guardar</button>');
    }).join('');
  }
  function swatches(k, colors) {
    return colors.map(function (c) {
      return '<button type="button" class="sw' + (THEME[k] === c ? ' on' : '') + '" style="background:' + c +
        '" data-a="th" data-k="' + k + '" data-c="' + c + '" aria-label="Color ' + c + '"></button>';
    }).join('') + '<input type="color" value="' + THEME[k] + '" data-a="cp" data-k="' + k + '" aria-label="Color personalizado">';
  }
  function homeRow(n, label, count) {
    return '<div class="row" data-a="go" data-n="' + n + '"><div class="t"><b>' + label + '</b></div>' +
      (count === undefined ? '' : '<small>' + count + '</small>') + '</div>';
  }
  function iconBtn(act, on, label, inner, extra) {
    return '<button type="button" class="ib' + (on ? ' on' : '') + '" data-a="' + act + '" aria-label="' + label + '"' +
      (extra || '') + '>' + inner + '</button>';
  }

  var views = {
    home: function () {
      var h = homeRow('lib', '&#9834;&nbsp; Música', tracks.length) +
        homeRow('fav', '&#9829;&nbsp; Favoritos', tracks.filter(function (t) { return t.fav; }).length) +
        homeRow('rec', '&#8635;&nbsp; Recientes') +
        homeRow('pl', '&#9636;&nbsp; Playlists', lists.length) +
        homeRow('on', '&#9678;&nbsp; Música online') +
        (cur ? homeRow('now', '&#9835;&nbsp; Reproduciendo') : '') +
        homeRow('add', '&#65291;&nbsp; Agregar música') +
        '<div class="row" data-a="share"><div class="t"><b>&#9729;&nbsp; Compartir música</b></div></div>' +
        homeRow('set', '&#9881;&nbsp; Ajustes');
      if (installEvt) { h += '<div class="row" data-a="inst"><div class="t"><b>&#11015;&nbsp; Instalar app</b></div></div>'; }
      return h;
    },
    lib: function () {
      return '<div class="pad"><input class="in" id="q" data-a="q" placeholder="Buscar en tu música…" aria-label="Buscar en tu música"></div>' +
        '<div class="pad fl" style="padding-top:0"><button type="button" class="btn pri" data-a="shufall">Aleatorio</button>' +
        '<button type="button" class="btn" data-a="edit">' + (editing ? 'Listo' : 'Editar') + '</button></div>' +
        '<div id="ll">' + libList('') + '</div>';
    },
    fav: function () {
      return trackList(tracks.filter(function (t) { return t.fav; }), 'Marca canciones con el corazón mientras suenan.');
    },
    rec: function () {
      var arr = tracks.filter(function (t) { return t.last; }).sort(function (a, b) { return b.last - a.last; }).slice(0, 30);
      return trackList(arr, 'Aquí aparecerán las canciones que escuches.');
    },
    pl: function () {
      return '<div class="pad fl nw"><input class="in" id="pn" placeholder="Nombre de la playlist" aria-label="Nombre de la playlist">' +
        '<button type="button" class="btn pri" data-a="mk">Crear</button></div>' +
        (lists.map(function (l) {
          return '<div class="row" data-a="go" data-n="pld" data-i="' + l.id + '"><div class="t"><b>' + esc(l.name) + '</b><small>' + l.ids.length + ' canciones</small></div></div>';
        }).join('') || empty('Crea tu primera playlist.'));
    },
    pld: function (id) {
      var l = lists.filter(function (x) { return x.id === id; })[0];
      if (!l) { return empty('Esta playlist ya no existe.'); }
      ctx = l.ids.map(function (k) { return tracks.filter(function (t) { return t.id === k; })[0]; }).filter(Boolean);
      return '<div class="pad fl"><button type="button" class="btn pri" data-a="go" data-n="plp" data-i="' + id + '">Añadir canciones</button>' +
        '<button type="button" class="btn" data-a="pls">Reproducir</button>' +
        '<button type="button" class="btn danger" data-a="dl" data-i="' + id + '">Eliminar</button></div>' +
        (ctx.map(function (t, i) {
          return trow(t, i, '<button type="button" class="btn" data-a="rm" data-i="' + t.id + '" data-p="' + id + '">Quitar</button>');
        }).join('') || empty('Esta playlist está vacía.'));
    },
    plp: function (id) {
      var l = lists.filter(function (x) { return x.id === id; })[0];
      if (!l) { return ''; }
      return tracks.map(function (t) {
        return '<div class="row nc" data-a="tg" data-i="' + t.id + '" data-p="' + id + '"><div class="t"><b>' + esc(t.title) + '</b><small>' + esc(t.artist) + '</small></div><b>' +
          (l.ids.indexOf(t.id) !== -1 ? '&#10003;' : '+') + '</b></div>';
      }).join('') || empty('Primero agrega música.');
    },
    on: function () {
      return '<div class="pad"><div class="fl"><button type="button" class="btn' + (source === 'audius' ? ' pri' : '') + '" data-a="src" data-i="audius">Canciones completas</button>' +
        '<button type="button" class="btn' + (source === 'itunes' ? ' pri' : '') + '" data-a="src" data-i="itunes">Previews 30 s</button></div></div>' +
        '<div class="pad fl nw" style="padding-top:0"><input class="in" id="oq" placeholder="Canción o artista…" value="' + esc(oq) + '" aria-label="Buscar música online">' +
        '<button type="button" class="btn pri" data-a="os">Buscar</button></div><div id="res">' + resList() + '</div>';
    },
    now: function () {
      if (!cur) { return empty('No hay nada en reproducción. Elige una canción de tu música.'); }
      var pills = '';
      if (est && !sy) { pills = '<button type="button" class="gb" data-a="sync">Sincronizar</button>'; }
      var body;
      if (sy) {
        body = '<div class="syb"><button type="button" class="btn pri grow" data-a="mark">Marcar línea</button>' +
          '<button type="button" class="btn" data-a="syu">Deshacer</button><button type="button" class="btn" data-a="syc">Salir</button></div>';
      } else {
        body = '<div class="pb"><span id="t1">0:00</span><input type="range" id="pr" min="0" max="1000" value="0" data-a="sk" aria-label="Progreso"><span id="t2">0:00</span></div>' +
          '<div class="ctl">' + iconBtn('shuf', shuf, 'Aleatorio', ICON.shuffle) +
          iconBtn('toffm', false, 'Adelantar letra', '&minus;') + '<span class="sub">letra</span>' + iconBtn('toffp', false, 'Atrasar letra', '+') +
          (cur.id !== undefined ? iconBtn('fav', cur.fav, 'Favorito', ICON.heart(cur.fav)) : '') +
          iconBtn('rep', rep > 0, 'Repetir', ICON.repeat + (rep === 2 ? '<i>1</i>' : '')) + '</div>';
      }
      return '<div class="np"><div class="nh">' + coverBox(cur) + '<div class="t"><b>' + esc(cur.title) + '</b><small>' +
        (sy ? 'Pulsa Marcar cuando empiece cada línea' : esc(cur.artist)) + '</small></div>' + pills + '</div>' +
        '<div class="lyw"><div class="ly" id="ly"></div></div>' + body + '</div>';
    },
    add: function () {
      return '<div class="pad"><button type="button" class="btn pri full" data-a="scan">Escanear carpeta de música</button>' +
        '<p class="sub">Encuentra MP3, WAV, FLAC, M4A, OGG y más, junto con sus archivos .lrc. Pide permiso una vez por carpeta.</p>' +
        '<div class="fl"><button type="button" class="btn" data-a="rescan">Reanalizar carpetas</button>' +
        '<button type="button" class="btn" data-a="files">Elegir archivos</button>' +
        '<button type="button" class="btn" data-a="folder">Elegir carpeta (otros navegadores)</button></div><p id="as" class="sub"></p></div>';
    },
    set: function () {
      var inst = standalone ? '<span>Instalada &#10003;</span>' :
        '<button type="button" class="btn pri" data-a="inst">' + (installEvt ? 'Instalar Lyric Pod' : '¿Cómo instalar?') + '</button>';
      return '<div class="pad"><b>Color del iPod</b><div class="sws">' + swatches('ipod', ['#e6e7ea', '#1d1e22', '#3a78c2', '#e58fb0', '#d6453d', '#4fae7b', '#e3c46b']) + '</div>' +
        '<b>Color del fondo</b><div class="sws">' + swatches('bg', ['#14151a', '#f1f2f4', '#1f3a5f', '#3b1f2e', '#16352a', '#4a2d1a']) + '</div>' +
        '<b>Palabra resaltada</b><div class="sws">' + swatches('ac', ['#ffd84a', '#4fd1ff', '#ff6fa5', '#7dff8f', '#ff9a3c', '#ffffff']) + '</div>' +
        '<b>Sincronía global de letras</b><div class="sws"><button type="button" class="btn" data-a="of" data-i="-0.25">&minus;</button><span>' + offset.toFixed(2) + ' s</span>' +
        '<button type="button" class="btn" data-a="of" data-i="0.25">+</button></div>' +
        '<b>Temporizador de apagado</b><div class="sws"><button type="button" class="btn" data-a="sleep">' + (sleepMin ? sleepMin + ' min' : 'Apagado') + '</button></div>' +
        '<b>App</b><div class="sws">' + inst + '</div><p class="sub" id="sg"></p>' +
        '<p class="sub">Atajos: flechas para moverte, Enter para elegir, Esc para volver, espacio para pausar. En Reproduciendo, ↑ ↓ cambian el volumen.</p></div>';
    }
  };

  /* ================= Acciones ================= */
  var actions = {
    go: function (d) { go(d.n, d.i !== undefined && d.i !== '' ? Number(d.i) : undefined); },
    share: function () { window.location.href = 'subir.html'; },
    pq: function (d) { playTrack(ctx[Number(d.i)], ctx); },
    q: function () { $('#ll').innerHTML = libList($('#q').value); },
    shufall: function () {
      if (!tracks.length) { return toast('Aún no hay canciones'); }
      shuf = true;
      playTrack(tracks[Math.floor(Math.random() * tracks.length)], tracks);
    },
    edit: function () { editing = !editing; render(true); },
    rt: function (d) {
      var id = Number(d.i);
      if (!window.confirm('¿Quitar esta canción de tu biblioteca? El archivo original no se borra.')) { return; }
      return dbDel('tracks', id).then(function () {
        return Promise.all(lists.map(function (l) {
          if (l.ids.indexOf(id) === -1) { return null; }
          l.ids = l.ids.filter(function (k) { return k !== id; });
          return dbPut('playlists', l);
        }));
      }).then(refresh);
    },
    mk: function () {
      var name = $('#pn').value.trim();
      if (!name) { return toast('Escribe un nombre'); }
      return dbPut('playlists', { name: name, ids: [] }).then(refresh);
    },
    dl: function (d) {
      if (!window.confirm('¿Eliminar esta playlist?')) { return; }
      return dbDel('playlists', Number(d.i)).then(function () { nav.pop(); return refresh(); });
    },
    rm: function (d) {
      var l = lists.filter(function (x) { return x.id === Number(d.p); })[0], id = Number(d.i);
      l.ids = l.ids.filter(function (k) { return k !== id; });
      return dbPut('playlists', l).then(refresh);
    },
    tg: function (d) {
      var l = lists.filter(function (x) { return x.id === Number(d.p); })[0], id = Number(d.i);
      l.ids = l.ids.indexOf(id) !== -1 ? l.ids.filter(function (k) { return k !== id; }) : l.ids.concat([id]);
      return dbPut('playlists', l).then(refresh);
    },
    pls: function () { return ctx.length ? playTrack(ctx[0], ctx) : toast('La playlist está vacía'); },
    src: function (d) { source = d.i; results = []; render(true); },
    os: function () {
      oq = $('#oq').value.trim();
      if (!oq) { return; }
      $('#res').innerHTML = empty('Buscando…');
      return (source === 'audius' ? searchAudius : searchItunes)(oq).then(function (r) {
        results = r;
        $('#res').innerHTML = r.length ? resList() : empty('Sin resultados.');
      }, function () {
        results = [];
        $('#res').innerHTML = empty('No se pudo conectar. Revisa tu internet e intenta de nuevo.');
      });
    },
    sv: function (d) {
      var t = results[Number(d.i)];
      if (tracks.some(function (x) { return x.path === t.uid; })) { return toast('Ya está en tu música'); }
      toast('Guardando para escuchar sin internet…');
      return fetch(t.url).then(function (r) { return r.blob(); }).then(function (blob) {
        return dbPut('tracks', { title: t.title, artist: t.artist, cover: t.cover, dur: t.dur, audio: blob, lyrics: '', path: t.uid, type: 'saved' });
      }).then(function () { toast('Guardada. Ya suena sin internet.'); return refresh(); },
        function () { toast('Esta canción no permite descargarse'); });
    },
    lk: function (d) { au.currentTime = Math.max(0, lines[Number(d.i)].t - offset - toff); },
    sk: function (d, el) { if (au.duration) { au.currentTime = el.value / 1000 * au.duration; } },
    of: function (d) { offset = Math.round((offset + Number(d.i)) * 100) / 100; localStorage.setItem('lpoff', String(offset)); render(true); },
    toffm: function () { setToff(-0.25); },
    toffp: function () { setToff(0.25); },
    shuf: function () { shuf = !shuf; render(true); },
    rep: function () { rep = (rep + 1) % 3; render(true); toast(['Repetir: apagado', 'Repetir: todo', 'Repetir: esta canción'][rep]); },
    fav: function () {
      if (!cur || cur.id === undefined) { return; }
      cur.fav = !cur.fav;
      return dbPut('tracks', cur).then(function () { toast(cur.fav ? 'Añadida a Favoritos' : 'Quitada de Favoritos'); render(true); });
    },
    th: function (d) { THEME[d.k] = d.c; applyTheme(); render(true); },
    cp: function (d, el) { THEME[d.k] = el.value; applyTheme(); },
    sleep: function () {
      var steps = [0, 15, 30, 60];
      sleepMin = steps[(steps.indexOf(sleepMin) + 1) % steps.length];
      clearTimeout(sleepTimer);
      if (sleepMin) {
        sleepTimer = setTimeout(function () { au.pause(); sleepMin = 0; toast('Temporizador: música pausada'); }, sleepMin * 60000);
      }
      render(true);
    },
    inst: function () {
      if (installEvt) {
        installEvt.prompt();
        return installEvt.userChoice.then(function () { installEvt = null; render(true); });
      }
      toast('Usa el menú del navegador › Instalar app. En iPhone: Compartir › Añadir a inicio.');
    },
    scan: function () {
      if (!window.showDirectoryPicker) { return actions.folder(); }
      return showDirectoryPicker({ id: 'lyricpod', mode: 'read' }).then(function (d) {
        return dbPut('kv', d, 'dir:' + d.name).then(function () { return ingestDir(d, false); });
      }, function (e) { if (e && e.name !== 'AbortError') { status('No se pudo abrir la carpeta'); } });
    },
    rescan: function () {
      return dbAll('kv').then(function (dirs) {
        if (!dirs.length) { return status('Aún no hay carpetas guardadas'); }
        return dirs.reduce(function (p, d) {
          return p.then(function () {
            return d.requestPermission({ mode: 'read' }).then(function (ok) { return ok === 'granted' ? ingestDir(d, false) : null; });
          });
        }, Promise.resolve());
      });
    },
    files: function () { fileInput.click(); },
    folder: function () { folderInput.click(); },
    sync: function () {
      var l = plain.split(/\r?\n/).map(function (x) { return x.trim(); }).filter(Boolean);
      if (!l.length) { return; }
      sy = { l: l, t: [], i: 0 };
      au.currentTime = 0;
      au.play().catch(function () { return null; });
      render(true);
    },
    auto: function () { setEstimate(); },
    mark: function () {
      if (!sy) { return; }
      sy.t[sy.i] = Math.max(0, au.currentTime);
      sy.i += 1;
      if (sy.i >= sy.l.length) { finishSync(); }
      render(true);
    },
    syu: function () { if (sy && sy.i > 0) { sy.i -= 1; sy.t.length = sy.i; render(true); } },
    syc: function () { sy = null; render(true); }
  };

  function runAction(el) {
    var fn = actions[el.dataset.a];
    if (!fn) { return; }
    try {
      var r = fn(el.dataset, el);
      if (r && r.then) { r.then(null, fail); }
    } catch (e) { fail(e); }
  }
  $('#pg').addEventListener('click', function (e) {
    var el = e.target.closest('[data-a]');
    if (el && !/^(INPUT|SELECT)$/.test(el.tagName)) { runAction(el); }
  });
  $('#pg').addEventListener('input', function (e) {
    var el = e.target.closest('[data-a]');
    if (el) { runAction(el); }
  });
  $('#back').addEventListener('click', back);

  /* ================= Biblioteca local ================= */
  function parseName(n) {
    var b = n.replace(/\.[^.]+$/, '').replace(/_/g, ' ').trim();
    var m = b.match(/^(.+?)\s+-\s+(.+)$/);
    if (m && !/^\d+$/.test(m[1])) { return { artist: m[1].trim(), title: m[2].trim() }; }
    return { artist: UNKNOWN, title: m ? m[2].trim() : b };
  }
  function walk(dir, path, out) {
    var it = dir.entries(), jobs = Promise.resolve();
    function step() {
      return it.next().then(function (r) {
        if (r.done) { return null; }
        var n = r.value[0], h = r.value[1];
        if (n.charAt(0) !== '.') {
          if (h.kind === 'directory') { jobs = jobs.then(function () { return walk(h, path + n + '/', out); }); }
          else { out.push({ n: n, h: h, p: path + n }); }
        }
        return step();
      });
    }
    return step().then(function () { return jobs; });
  }
  function ingestDir(d, quiet) {
    var found = [];
    return walk(d, d.name + '/', found).then(function () { return ingest(found, quiet); });
  }
  function readFile(x) { return x.h ? x.h.getFile() : Promise.resolve(x.f); }
  function ingest(items, quiet) {
    if (!db) { return Promise.resolve(); }
    if (!quiet) { status('Escaneando…'); }
    function key(p) { return p.replace(/\.[^./]+$/, '').toLowerCase(); }
    var lrc = {}, have = {}, added = 0;
    items.forEach(function (x) { if (/\.lrc$/i.test(x.n)) { lrc[key(x.p)] = x; } });
    tracks.forEach(function (t) { have[t.path] = true; });
    return items.reduce(function (p, x) {
      return p.then(function () {
        if (!AUDIO_RE.test(x.n) || have[x.p]) { return null; }
        var l = lrc[key(x.p)];
        return (l ? readFile(l).then(function (f) { return f.text(); }) : Promise.resolve('')).then(function (text) {
          var meta = parseName(x.n);
          added += 1;
          return dbPut('tracks', { title: meta.title, artist: meta.artist, path: x.p, handle: x.h, audio: x.f, lyrics: text, cover: '', type: 'local' });
        });
      });
    }, Promise.resolve()).then(refresh).then(function () {
      if (!quiet) { status(added ? added + ' canciones nuevas' : 'No hay canciones nuevas'); }
    });
  }
  var fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.multiple = true;
  fileInput.accept = 'audio/*,.lrc,.flac,.m4a,.opus';
  var folderInput = document.createElement('input');
  folderInput.type = 'file';
  folderInput.setAttribute('webkitdirectory', '');
  function onFiles(input, useRelative) {
    input.addEventListener('change', function () {
      var items = Array.prototype.slice.call(input.files).map(function (f) {
        return { n: f.name, p: useRelative && f.webkitRelativePath ? f.webkitRelativePath : f.name, f: f };
      });
      input.value = '';
      ingest(items, false).then(null, fail);
    });
  }
  onFiles(fileInput, false);
  onFiles(folderInput, true);

  /* ================= Música online ================= */
  function searchAudius(q) {
    var base = 'https://discoveryprovider.audius.co/v1/tracks/';
    return fetch(base + 'search?limit=20&app_name=LyricPod&query=' + encodeURIComponent(q)).then(function (r) { return r.json(); }).then(function (j) {
      return (j.data || []).map(function (x) {
        var art = x.artwork || {};
        return {
          uid: 'a' + x.id, title: x.title, artist: x.user ? x.user.name : UNKNOWN,
          cover: art['480x480'] || art['150x150'] || '', dur: x.duration,
          url: base + x.id + '/stream?app_name=LyricPod'
        };
      });
    });
  }
  function searchItunes(q) {
    return fetch('https://itunes.apple.com/search?entity=song&limit=20&term=' + encodeURIComponent(q)).then(function (r) { return r.json(); }).then(function (j) {
      return (j.results || []).filter(function (x) { return x.previewUrl; }).map(function (x) {
        return {
          uid: 'i' + x.trackId, title: x.trackName, artist: x.artistName,
          cover: x.artworkUrl100.replace('100x100', '300x300'), dur: x.trackTimeMillis / 1000,
          url: x.previewUrl, preview: true
        };
      });
    });
  }

  /* ================= Reproducción ================= */
  function srcOf(t) {
    if (objUrl) { URL.revokeObjectURL(objUrl); objUrl = null; }
    if (t.url) { return Promise.resolve(t.url); }
    if (t.handle) {
      return t.handle.queryPermission({ mode: 'read' }).then(function (p) {
        return p === 'granted' ? 'granted' : t.handle.requestPermission({ mode: 'read' });
      }).then(function (p) {
        if (p !== 'granted') { throw new Error('perm'); }
        return t.handle.getFile();
      }).then(function (f) { objUrl = URL.createObjectURL(f); return objUrl; });
    }
    objUrl = URL.createObjectURL(t.audio);
    return Promise.resolve(objUrl);
  }
  function resetLyrics() { lines = []; plain = ''; lst = 'load'; est = false; sy = null; toff = 0; li = -1; kw = -2; }
  function playTrack(t, q) {
    if (!t) { return Promise.resolve(); }
    au.pause();
    cur = t;
    if (q) { queue = q; }
    resetLyrics();
    if (last(nav).n === 'now') { render(); } else { go('now'); }
    return srcOf(t).then(function (src) {
      au.src = src;
      return au.play();
    }).then(null, function (e) {
      if (e && e.name === 'AbortError') { return; }
      toast(e && e.message === 'perm' ? 'Permite el acceso a la carpeta para reproducir' : 'No se pudo reproducir esta canción');
    }).then(function () {
      if (cur !== t) { return; }
      if (t.id !== undefined) {
        t.plays = (t.plays || 0) + 1;
        t.last = Date.now();
        dbPut('tracks', t).then(null, console.warn);
      }
      mediaMeta();
      return loadLyrics(t);
    });
  }
  function togglePlay() {
    if (!cur) { return toast('Elige una canción primero'); }
    if (au.paused) { au.play().then(null, console.warn); } else { au.pause(); }
  }
  function nextTrack(auto) {
    if (!cur || !queue.length) { return; }
    var i = queue.map(tid).indexOf(tid(cur));
    if (auto && rep === 2) { return playTrack(cur); }
    if (shuf && queue.length > 1) {
      var j;
      do { j = Math.floor(Math.random() * queue.length); } while (j === i);
      return playTrack(queue[j]);
    }
    if (auto && rep === 0 && i === queue.length - 1) { return; }
    return playTrack(queue[(i + 1) % queue.length]);
  }
  function prevTrack() {
    if (!cur || !queue.length) { return; }
    if (au.currentTime > 3) { au.currentTime = 0; return; }
    var i = queue.map(tid).indexOf(tid(cur));
    return playTrack(queue[(i - 1 + queue.length) % queue.length]);
  }
  function setVolume(delta) {
    au.volume = Math.min(1, Math.max(0, Math.round((au.volume + delta) * 100) / 100));
    localStorage.setItem('lpvol', String(au.volume));
    toast('Volumen ' + Math.round(au.volume * 100) + '%');
  }
  au.addEventListener('ended', function () { nextTrack(true); });
  au.addEventListener('play', function () { $('#pi').classList.add('on'); });
  au.addEventListener('pause', function () { $('#pi').classList.remove('on'); });
  au.addEventListener('error', function () { if (au.src) { toast('No se pudo cargar el audio'); } });

  function mediaMeta() {
    if (!('mediaSession' in navigator) || !cur) { return; }
    navigator.mediaSession.metadata = new MediaMetadata({
      title: cur.title, artist: cur.artist,
      artwork: cur.cover ? [{ src: cur.cover, sizes: '300x300' }] : []
    });
  }
  if ('mediaSession' in navigator) {
    var ms = navigator.mediaSession;
    ms.setActionHandler('play', function () { au.play(); });
    ms.setActionHandler('pause', function () { au.pause(); });
    ms.setActionHandler('previoustrack', prevTrack);
    ms.setActionHandler('nexttrack', function () { nextTrack(false); });
  }

  /* ================= Letras ================= */
  function fill(o) {
    o.forEach(function (l, i) {
      var nx = o[i + 1] ? o[i + 1].t : l.t + 4;
      if (!l.w) {
        var e = Math.min(nx, l.t + 8), ws = l.txt.split(/\s+/).filter(Boolean), n = 0, c = 0;
        ws.forEach(function (x) { n += x.length + 1; });
        l.w = ws.map(function (x) {
          var z = { t: l.t + (e - l.t) * 0.9 * c / n, w: x };
          c += x.length + 1;
          return z;
        });
      }
      l.w.forEach(function (w, k) { w.e = l.w[k + 1] ? l.w[k + 1].t : Math.min(nx, w.t + 2); });
    });
    return o;
  }
  function parseLrc(text) {
    var out = [];
    text.split(/\r?\n/).forEach(function (raw) {
      var stamps = raw.match(/\[\d+:\d+(?:\.\d+)?\]/g);
      if (!stamps) { return; }
      var body = raw.replace(/\[\d+:\d+(?:\.\d+)?\]/g, '').trim(), words = null;
      if (/<\d+:\d+/.test(body)) {
        var p = body.split(/<(\d+):(\d+(?:\.\d+)?)>/);
        words = [];
        for (var i = 1; i < p.length; i += 3) {
          if (p[i + 2].trim()) { words.push({ t: Number(p[i]) * 60 + Number(p[i + 1]), w: p[i + 2].trim() }); }
        }
      }
      stamps.forEach(function (s) {
        var m = s.match(/\[(\d+):(\d+(?:\.\d+)?)\]/);
        out.push({
          t: Number(m[1]) * 60 + Number(m[2]),
          txt: words ? words.map(function (z) { return z.w; }).join(' ') : body,
          w: words ? words.map(function (z) { return { t: z.t, w: z.w }; }) : null
        });
      });
    });
    out.sort(function (a, b) { return a.t - b.t; });
    return fill(out);
  }
  function clean(s) {
    return s.replace(/\(.*?\)|\[.*?\]/g, ' ')
      .replace(/\b(feat|ft|featuring|prod|official|audio|video|lyrics?|remaster(ed)?|remix|version|live)\b.*$/i, ' ')
      .replace(/[–—_]+/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function norm(s) {
    return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  }
  function whenReady() {
    return new Promise(function (resolve) {
      if (au.readyState >= 1) { return resolve(); }
      var timer = setTimeout(done, 4000);
      function done() { clearTimeout(timer); au.removeEventListener('loadedmetadata', done); resolve(); }
      au.addEventListener('loadedmetadata', done);
    });
  }
  function searchLrclib(params) {
    return fetch('https://lrclib.net/api/search?' + new URLSearchParams(params)).then(function (r) {
      return r.ok ? r.json() : [];
    }).then(null, function () { return []; });
  }
  function findLyrics(t) {
    var unknown = t.artist === UNKNOWN;
    var title = clean(t.title) || t.title, artist = unknown ? '' : clean(t.artist);
    var real = isFinite(au.duration) && au.duration > 0 && !t.preview ? au.duration : 0;
    var dur = real || t.dur || 0;
    var queries = [];
    if (artist) { queries.push({ track_name: title, artist_name: artist }); }
    queries.push({ q: (artist + ' ' + title).trim() }, { q: title }, { q: clean(t.title.split(/\s[-–]\s/).pop()) });
    var best = '', bestScore = -1;
    return queries.reduce(function (p, q) {
      return p.then(function () {
        if (bestScore >= 100) { return null; }
        return searchLrclib(q).then(function (list) {
          list.forEach(function (j) {
            var a = norm(j.trackName || ''), b = norm(title);
            if (!b || !(a.indexOf(b) !== -1 || b.indexOf(a) !== -1)) { return; }
            var diff = dur && j.duration ? Math.abs(j.duration - dur) : 0;
            var synced = !!j.syncedLyrics && diff <= 5;
            var text = synced ? j.syncedLyrics : (j.plainLyrics || j.syncedLyrics || '');
            var score = (synced ? 100 : text ? 20 : -1) - Math.min(diff, 30) * 2 +
              (artist && norm(j.artistName || '').indexOf(norm(artist).split(' ')[0]) !== -1 ? 15 : 0);
            if (text && score > bestScore) {
              bestScore = score;
              best = synced ? text : text.replace(/\[\d+:\d+(?:\.\d+)?\]/g, '');
            }
          });
        });
      });
    }, Promise.resolve()).then(function () { return best; });
  }
  function enrich(t) {
    if (t.cover && t.artist !== UNKNOWN) { return Promise.resolve(); }
    var term = (t.artist !== UNKNOWN ? t.artist + ' ' : '') + t.title;
    return fetch('https://itunes.apple.com/search?entity=song&limit=1&term=' + encodeURIComponent(term)).then(function (r) { return r.json(); }).then(function (j) {
      var r = j.results && j.results[0];
      if (r && r.trackName.toLowerCase().indexOf(t.title.toLowerCase().slice(0, 8)) === 0) {
        t.cover = t.cover || r.artworkUrl100.replace('100x100', '300x300');
        if (t.artist === UNKNOWN) { t.artist = r.artistName; }
        t.dur = t.dur || r.trackTimeMillis / 1000;
        if (t.id !== undefined) { dbPut('tracks', t).then(null, console.warn); }
      }
    }).then(null, function () { return null; });
  }
  function refreshNow() { if (last(nav).n === 'now') { render(true); } }

  function loadLyrics(t) {
    var key = tkey(t), text = '';
    return enrich(t).then(function () {
      if (cur !== t) { return null; }
      mediaMeta();
      refreshNow();
      return whenReady();
    }).then(function () {
      if (cur !== t) { return null; }
      return dbGet('ly', 'off:' + key).then(function (v) { toff = Number(v) || 0; });
    }).then(function () {
      if (cur !== t) { return null; }
      text = t.lyrics || '';
      return text ? text : dbGet('ly', key).then(function (v) { return v || ''; });
    }).then(function (x) {
      if (cur !== t) { return null; }
      text = x || '';
      if (text) { return text; }
      return findLyrics(t).then(function (found) {
        if (found) {
          if (t.id !== undefined && /\[\d+:\d+/.test(found)) { t.lyrics = found; dbPut('tracks', t).then(null, console.warn); }
          else { dbPut('ly', found, key).then(null, console.warn); }
        }
        return found;
      });
    }).then(function (x) {
      if (cur !== t || x === null) { return; }
      text = x || '';
      lst = '';
      if (text && /\[\d+:\d+/.test(text) && !t.preview) { lines = parseLrc(text); }
      else { plain = text.replace(/\[[^\]]*\]|<[^>]*>/g, '').trim(); }
      refreshNow();
    }).then(null, function (e) { console.warn(e); lst = ''; refreshNow(); });
  }
  function setEstimate() {
    var ws = plain.split(/\r?\n/).map(function (x) { return x.trim(); }).filter(Boolean);
    if (!ws.length) { return; }
    var d = (isFinite(au.duration) && au.duration) || (cur && cur.dur) || 210;
    var start = Math.min(14, d * 0.07), span = d - start - Math.min(10, d * 0.05), total = 0, c = 0;
    function weight(x) { return Math.max(10, x.length); }
    ws.forEach(function (x) { total += weight(x); });
    lines = fill(ws.map(function (x) {
      var o = { t: start + span * c / total, txt: x, w: null };
      c += weight(x);
      return o;
    }));
    est = true;
    refreshNow();
  }
  function setToff(delta) {
    if (!cur) { return; }
    toff = Math.round((toff + delta) * 100) / 100;
    dbPut('ly', toff, 'off:' + tkey(cur)).then(null, console.warn);
    toast('Sincronía de esta canción: ' + (toff > 0 ? '+' : '') + toff.toFixed(2) + ' s');
  }
  function stamp(x) {
    var m = Math.floor(x / 60), s = (x - m * 60).toFixed(2);
    return '[' + (m < 10 ? '0' : '') + m + ':' + (s.length < 5 ? '0' : '') + s + ']';
  }
  function finishSync() {
    var lrc = sy.l.map(function (x, i) { return stamp(sy.t[i]) + x; }).join('\n');
    if (cur.id !== undefined) { cur.lyrics = lrc; dbPut('tracks', cur).then(null, console.warn); }
    else { dbPut('ly', lrc, cur.uid).then(null, console.warn); }
    lines = parseLrc(lrc);
    est = false;
    sy = null;
    toast('Letra sincronizada y guardada');
  }
  function centerOn(box, p, smooth) {
    if (!p) { return; }
    var top = p.offsetTop - box.clientHeight / 2 + p.offsetHeight / 2;
    if (box.scrollTo) { box.scrollTo({ top: top, behavior: smooth ? 'smooth' : 'auto' }); } else { box.scrollTop = top; }
  }
  function drawLyrics() {
    var box = $('#ly');
    if (!box || !cur) { return; }
    li = -1; kw = -2;
    if (sy) {
      box.className = 'ly';
      box.innerHTML = sy.l.map(function (x, i) {
        return '<p class="' + (i === sy.i ? 'on' : '') + '"' + (i < sy.i ? ' style="opacity:.2"' : '') + '>' + esc(x) + '</p>';
      }).join('');
      centerOn(box, box.children[sy.i], false);
      return;
    }
    if (lines.length) {
      box.className = 'ly';
      box.innerHTML = lines.map(function (l, i) {
        return '<p data-a="lk" data-i="' + i + '">' + (l.w.length ? l.w.map(function (w) { return '<span>' + esc(w.w) + '</span>'; }).join(' ') : '&#9834;') + '</p>';
      }).join('');
      return;
    }
    if (lst === 'load' || !plain) {
      box.className = 'ly none';
      box.innerHTML = '<div class="nl' + (lst === 'load' ? ' busy' : '') + '">' + ICON.note + '</div>';
      return;
    }
    box.className = 'ly txt';
    box.innerHTML = (cur.preview ? '<div class="hint">Preview de 30 s: la letra no se puede sincronizar.</div>' :
      '<div class="fl"><button type="button" class="gb" data-a="sync">Sincronizar</button><button type="button" class="gb" data-a="auto">Auto</button></div>') +
      '<div class="pl">' + esc(plain).replace(/\n/g, '<br>') + '</div>';
  }
  function clearLine(p) {
    p.classList.remove('on');
    Array.prototype.forEach.call(p.children, function (s) { s.classList.remove('c'); s.classList.remove('d'); });
  }
  function tick() {
    window.requestAnimationFrame(tick);
    var pr = $('#pr');
    if (pr && au.duration) {
      if (document.activeElement !== pr) { pr.value = au.currentTime / au.duration * 1000; }
      $('#t1').textContent = fmt(au.currentTime);
      $('#t2').textContent = '-' + fmt(au.duration - au.currentTime);
    }
    var box = $('#ly');
    if (!box || !lines.length || sy) { return; }
    var t = au.currentTime + offset + toff, ps = box.children, i = -1;
    while (i + 1 < lines.length && lines[i + 1].t <= t) { i += 1; }
    if (i !== li) {
      if (ps[li]) { clearLine(ps[li]); }
      li = i;
      kw = -2;
      if (ps[i]) { ps[i].classList.add('on'); centerOn(box, ps[i], true); }
    }
    if (i < 0 || !ps[i]) { return; }
    var ws = lines[i].w, k = -1;
    while (k + 1 < ws.length && ws[k + 1].t <= t) { k += 1; }
    if (k >= 0 && k === ws.length - 1 && t > ws[k].e + 0.2) { k = ws.length; }
    if (k !== kw) {
      kw = k;
      Array.prototype.forEach.call(ps[i].children, function (s, n) {
        s.classList.toggle('d', n < k);
        s.classList.toggle('c', n === k);
      });
    }
  }

  /* ================= Rueda click y teclado ================= */
  function moveSel(d) {
    var rows = $$('#pg .row');
    if (!rows.length) { return; }
    if (rows[sel]) { rows[sel].classList.remove('sel'); }
    sel = Math.max(0, Math.min(rows.length - 1, sel + d));
    rows[sel].classList.add('sel');
    if (rows[sel].scrollIntoView) { rows[sel].scrollIntoView({ block: 'nearest' }); }
  }
  function scrollWheel(d) { if (last(nav).n === 'now') { setVolume(d * 0.05); } else { moveSel(d); } }
  function centerClick() {
    if (sy) { return actions.mark(); }
    var rows = $$('#pg .row');
    if (rows[sel]) { rows[sel].click(); } else { togglePlay(); }
  }
  $('.wheel').addEventListener('wheel', function (e) { e.preventDefault(); scrollWheel(e.deltaY > 0 ? 1 : -1); }, { passive: false });
  $('#bPrev').addEventListener('click', prevTrack);
  $('#bNext').addEventListener('click', function () { nextTrack(false); });
  $('#bPlay').addEventListener('click', togglePlay);
  $('#bSel').addEventListener('click', centerClick);

  var menuBtn = $('#bMenu'), pressTimer = 0, longPress = false;
  menuBtn.addEventListener('pointerdown', function () {
    longPress = false;
    pressTimer = setTimeout(function () { longPress = true; home(); }, 550);
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (ev) {
    menuBtn.addEventListener(ev, function () { clearTimeout(pressTimer); });
  });
  menuBtn.addEventListener('click', function () { if (longPress) { longPress = false; } else { back(); } });

  document.addEventListener('keydown', function (e) {
    var tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'SELECT') {
      if (e.key === 'Enter') {
        if (e.target.id === 'oq') { actions.os(); }
        if (e.target.id === 'pn') { actions.mk(); }
      }
      return;
    }
    if (tag === 'BUTTON' && (e.key === 'Enter' || e.key === ' ')) { return; }
    if (sy && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); actions.mark(); return; }
    var map = {
      ArrowDown: function () { scrollWheel(1); }, ArrowUp: function () { scrollWheel(-1); },
      Enter: centerClick, Escape: back, Backspace: back, ' ': togglePlay,
      ArrowRight: function () { nextTrack(false); }, ArrowLeft: prevTrack
    };
    if (map[e.key]) { e.preventDefault(); map[e.key](); }
  });

  /* ================= Ajuste de tamaño ================= */
  function fit() {
    var a = document.activeElement;
    if (a && a.tagName === 'INPUT') { return; }
    var ip = $('#ipod'), stage = $('#stage');
    ip.style.transform = 'none';
    var w = ip.offsetWidth, h = ip.offsetHeight;
    var k = Math.min(1, (window.innerWidth - 24) / w, (window.innerHeight - 24) / h);
    ip.style.transform = 'scale(' + k + ')';
    stage.style.width = Math.round(w * k) + 'px';
    stage.style.height = Math.round(h * k) + 'px';
  }
  window.addEventListener('resize', fit);

  /* ================= Instalación y arranque ================= */
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); installEvt = e; render(true); });
  window.addEventListener('appinstalled', function () {
    installEvt = null;
    if (navigator.storage && navigator.storage.persist) { navigator.storage.persist(); }
    toast('Lyric Pod instalada');
    render(true);
  });

  function autoScan() {
    return dbAll('kv').then(function (dirs) {
      return dirs.reduce(function (p, d) {
        return p.then(function () {
          if (!d || !d.queryPermission) { return null; }
          return d.queryPermission({ mode: 'read' }).then(function (ok) { return ok === 'granted' ? ingestDir(d, true) : null; });
        }).then(null, console.warn);
      }, Promise.resolve());
    });
  }

  applyTheme();
  render();
  fit();
  tick();
  openDb().then(refresh).then(function () {
    if (navigator.storage && navigator.storage.persist) { navigator.storage.persist(); }
    return autoScan();
  }).then(null, function (e) { console.warn(e); toast('No se pudo abrir el almacenamiento'); });
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').then(null, function (e) { console.warn('Service worker:', e); });
  }
})();
