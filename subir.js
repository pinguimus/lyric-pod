/* Lyric Pod - página para compartir música (Supabase) */
(function () {
  'use strict';

  /* ---------- Utilidades ---------- */
  const $ = (s) => document.querySelector(s);
  const UNKNOWN = 'Artista desconocido';
  const MIME = {
    mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', ogg: 'audio/ogg',
    oga: 'audio/ogg', opus: 'audio/opus', flac: 'audio/flac', weba: 'audio/webm'
  };
  const MAX_AUDIO = 20 * 1024 * 1024;

  // Crea elementos sin usar innerHTML: todo texto se inserta como texto (evita XSS).
  function h(tag, props) {
    const e = document.createElement(tag);
    Object.keys(props || {}).forEach((k) => {
      const v = props[k];
      if (k === 'class') { e.className = v; }
      else if (k.indexOf('on') === 0) { e.addEventListener(k.slice(2), v); }
      else if (v !== false && v != null) { e.setAttribute(k, v); }
    });
    for (let i = 2; i < arguments.length; i++) {
      const c = arguments[i];
      if (c != null && c !== false) { e.append(c); }
    }
    return e;
  }
  function fmtStamp(x) {
    const m = Math.floor(x / 60), s = (x - m * 60).toFixed(2);
    return '[' + (m < 10 ? '0' : '') + m + ':' + (s.length < 5 ? '0' : '') + s + ']';
  }
  const hasStamps = (t) => /\[\d+:\d+(?:\.\d+)?\]/.test(t || '');
  const stripAll = (t) => (t || '').replace(/\[[^\]]*\]|<\d+:\d+(?:\.\d+)?>/g, '');
  const plainLines = () => stripAll($('#lyr').value).split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  const extOf = (name) => (name.split('.').pop() || '').toLowerCase();
  function parseName(n) {
    const b = n.replace(/\.[^.]+$/, '').replace(/_/g, ' ').trim();
    const m = b.match(/^(.+?)\s+-\s+(.+)$/);
    if (m && !/^\d+$/.test(m[1])) { return { artist: m[1].trim(), title: m[2].trim() }; }
    return { artist: '', title: m ? m[2].trim() : b };
  }
  let stTimer = null;
  function setStatus(msg, kind) {
    const e = $('#st');
    e.textContent = msg || '';
    e.className = 'status' + (kind ? ' ' + kind : '');
    clearTimeout(stTimer);
  }

  /* ---------- Tema (comparte colores con el iPod) ---------- */
  try {
    const t = JSON.parse(localStorage.getItem('lp-theme') || '{}');
    const r = document.documentElement.style, ok = /^#[0-9a-f]{6}$/i;
    if (ok.test(t.bg)) {
      r.setProperty('--bg', t.bg);
      const n = parseInt(t.bg.slice(1), 16);
      const lighter = [n >> 16 & 255, n >> 8 & 255, n & 255].map((v) => Math.round(v * 0.88 + 255 * 0.12));
      r.setProperty('--bg2', 'rgb(' + lighter.join(',') + ')');
    }
    if (ok.test(t.ac)) { r.setProperty('--ac', t.ac); }
  } catch (e) { /* tema opcional */ }

  /* ---------- Conexión ---------- */
  const cfg = window.LP_CONFIG || {};
  if (!cfg.url || !cfg.key || !window.supabase) {
    $('#setupCard').hidden = false;
    $('#upCard').hidden = true;
    if (!window.supabase && cfg.url) {
      $('#setupCard').querySelector('p').textContent = 'No se pudo cargar la librería de Supabase. Revisa tu conexión a internet y recarga.';
    }
    return;
  }
  const sb = window.supabase.createClient(cfg.url, cfg.key);
  let uid = null;

  async function ensureUser() {
    if (uid) { return uid; }
    const cur = await sb.auth.getSession();
    if (cur.data && cur.data.session) { uid = cur.data.session.user.id; return uid; }
    const r = await sb.auth.signInAnonymously();
    if (r.error) { throw r.error; }
    uid = r.data.user.id;
    return uid;
  }
  function friendly(err) {
    const m = String((err && err.message) || err || '');
    if (/anonymous/i.test(m)) { return 'Falta activar "Allow anonymous sign-ins" en Supabase › Authentication › Sign In / Providers.'; }
    if (/Límite de 10/.test(m)) { return 'Llegaste al límite de 10 canciones por persona. Borra alguna para subir otra.'; }
    if (/mime|not allowed|invalid/i.test(m) && /type/i.test(m)) { return 'Ese tipo de archivo no está permitido.'; }
    if (/exceeded|too large|size/i.test(m)) { return 'El archivo es demasiado grande.'; }
    if (/row-level security|policy/i.test(m)) { return 'Supabase rechazó la subida. ¿Ejecutaste setup.sql completo?'; }
    return 'Algo salió mal: ' + m;
  }

  /* ---------- Formulario: audio, portada, datos ---------- */
  const prev = $('#prev');
  let audioFile = null, coverBlob = null, objUrl = null;

  $('#fAudio').addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (objUrl) { URL.revokeObjectURL(objUrl); objUrl = null; }
    audioFile = null;
    prev.hidden = true;
    if (!f) { return; }
    const ext = extOf(f.name);
    if (!MIME[ext]) { setStatus('Formato no compatible. Usa MP3, M4A, WAV, OGG, FLAC, AAC u OPUS.', 'err'); e.target.value = ''; return; }
    if (f.size > MAX_AUDIO) { setStatus('El audio pesa más de 20 MB.', 'err'); e.target.value = ''; return; }
    audioFile = f;
    objUrl = URL.createObjectURL(f);
    prev.src = objUrl;
    prev.hidden = false;
    setStatus('');
    const meta = parseName(f.name);
    if (!$('#fTitle').value) { $('#fTitle').value = meta.title; }
    if (!$('#fArtist').value) { $('#fArtist').value = meta.artist; }
  });

  async function resizeCover(file) {
    const bmp = await createImageBitmap(file);
    const s = Math.min(bmp.width, bmp.height), size = Math.min(600, s);
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    c.getContext('2d').drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, size, size);
    return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('cover'))), 'image/jpeg', 0.85));
  }
  $('#fCover').addEventListener('change', async (e) => {
    const f = e.target.files[0], img = $('#coverPrev');
    coverBlob = null;
    img.hidden = true;
    if (!f) { return; }
    if (f.size > 15 * 1024 * 1024) { setStatus('La imagen es demasiado grande.', 'err'); e.target.value = ''; return; }
    try {
      coverBlob = await resizeCover(f);
      img.src = URL.createObjectURL(coverBlob);
      img.hidden = false;
    } catch (err) { setStatus('No se pudo leer esa imagen.', 'err'); e.target.value = ''; }
  });

  /* ---------- Letras: .lrc, búsqueda automática, sincronía ---------- */
  $('#bLrc').addEventListener('click', () => $('#fLrc').click());
  $('#fLrc').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) { return; }
    if (f.size > 200 * 1024) { setStatus('Ese archivo es demasiado grande para ser una letra.', 'err'); return; }
    $('#lyr').value = (await f.text()).slice(0, 20000);
    setStatus('Letra cargada' + (hasStamps($('#lyr').value) ? ' (con tiempos).' : '. Ahora puedes sincronizarla.'), 'ok');
  });

  const clean = (s) => s.replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/\b(feat|ft|featuring|prod|official|audio|video|lyrics?|remaster(ed)?|remix|version|live)\b.*$/i, ' ')
    .replace(/[–—_]+/g, ' ').replace(/\s+/g, ' ').trim();
  const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  async function lrclib(params) {
    try {
      const r = await fetch('https://lrclib.net/api/search?' + new URLSearchParams(params));
      return r.ok ? await r.json() : [];
    } catch (e) { return []; }
  }
  async function findLyrics(title, artist, dur) {
    const qs = [];
    if (artist) { qs.push({ track_name: title, artist_name: artist }); }
    qs.push({ q: (artist + ' ' + title).trim() }, { q: title });
    let best = '', bestScore = -1, bestSynced = false;
    for (const q of qs) {
      const list = await lrclib(q);
      list.forEach((j) => {
        const a = norm(j.trackName || ''), b = norm(title);
        if (!b || !(a.indexOf(b) !== -1 || b.indexOf(a) !== -1)) { return; }
        const diff = dur && j.duration ? Math.abs(j.duration - dur) : 0;
        const synced = !!j.syncedLyrics && diff <= 5;
        const text = synced ? j.syncedLyrics : (j.plainLyrics || '');
        const score = (synced ? 100 : text ? 20 : -1) - Math.min(diff, 30) * 2 +
          (artist && norm(j.artistName || '').indexOf(norm(artist).split(' ')[0]) !== -1 ? 15 : 0);
        if (text && score > bestScore) { bestScore = score; best = text; bestSynced = synced; }
      });
      if (bestSynced) { break; }
    }
    return { text: best, synced: bestSynced };
  }
  $('#bFind').addEventListener('click', async () => {
    const title = clean($('#fTitle').value), artist = clean($('#fArtist').value);
    if (!title) { setStatus('Escribe primero el título.', 'err'); return; }
    setStatus('Buscando letra…');
    const dur = isFinite(prev.duration) ? prev.duration : 0;
    const r = await findLyrics(title, artist === UNKNOWN ? '' : artist, dur);
    if (!r.text) { setStatus('No encontré la letra. Pégala o sube tu .lrc.', 'err'); return; }
    $('#lyr').value = r.text.slice(0, 20000);
    setStatus(r.synced ? 'Letra encontrada con tiempos.' : 'Letra encontrada sin tiempos: usa Sincronizar a mano o Auto.', 'ok');
  });

  $('#bAuto').addEventListener('click', () => {
    const lines = plainLines();
    if (!lines.length) { setStatus('Escribe o busca la letra primero.', 'err'); return; }
    const d = isFinite(prev.duration) && prev.duration ? prev.duration : 0;
    if (!d) { setStatus('Elige primero el audio para conocer su duración.', 'err'); return; }
    const start = Math.min(14, d * 0.07), span = d - start - Math.min(10, d * 0.05);
    const w = (x) => Math.max(10, x.length);
    const total = lines.reduce((n, x) => n + w(x), 0);
    let c = 0;
    $('#lyr').value = lines.map((x) => {
      const t = start + span * c / total;
      c += w(x);
      return fmtStamp(t) + x;
    }).join('\n');
    setStatus('Tiempos estimados. Puedes afinarlos con Sincronizar a mano.', 'ok');
  });

  let sy = null;
  function renderSync() {
    $('#syncCur').textContent = sy.lines[sy.i];
    $('#syncNext').textContent = sy.lines[sy.i + 1] || '(última línea)';
  }
  function exitSync() { sy = null; $('#syncBox').hidden = true; prev.pause(); }
  function finishSync() {
    $('#lyr').value = sy.lines.map((x, i) => fmtStamp(sy.t[i]) + x).join('\n');
    exitSync();
    setStatus('Letra sincronizada.', 'ok');
  }
  function mark() {
    if (!sy) { return; }
    sy.t[sy.i] = Math.max(0, prev.currentTime);
    sy.i += 1;
    if (sy.i >= sy.lines.length) { finishSync(); } else { renderSync(); }
  }
  $('#bSync').addEventListener('click', () => {
    const lines = plainLines();
    if (!lines.length) { setStatus('Escribe o busca la letra primero.', 'err'); return; }
    if (!audioFile) { setStatus('Elige primero el audio.', 'err'); return; }
    sy = { lines: lines, t: [], i: 0 };
    $('#syncBox').hidden = false;
    renderSync();
    prev.currentTime = 0;
    prev.play().catch(() => null);
    setStatus('');
  });
  $('#bMark').addEventListener('click', mark);
  $('#bUndo').addEventListener('click', () => {
    if (sy && sy.i > 0) { sy.i -= 1; sy.t.length = sy.i; renderSync(); }
  });
  $('#bExit').addEventListener('click', exitSync);
  document.addEventListener('keydown', (e) => {
    const tag = e.target.tagName;
    if (sy && (e.key === ' ' || e.key === 'Enter') && tag !== 'TEXTAREA' && tag !== 'INPUT' && tag !== 'BUTTON') {
      e.preventDefault();
      mark();
    }
  });

  /* ---------- Publicar ---------- */
  function resetForm() {
    ['#fAudio', '#fCover'].forEach((s) => { $(s).value = ''; });
    ['#fTitle', '#fArtist', '#lyr'].forEach((s) => { $(s).value = ''; });
    $('#fRights').checked = false;
    $('#coverPrev').hidden = true;
    prev.hidden = true;
    prev.removeAttribute('src');
    audioFile = null;
    coverBlob = null;
  }
  $('#bPub').addEventListener('click', async () => {
    const btn = $('#bPub');
    const title = $('#fTitle').value.trim(), artist = $('#fArtist').value.trim() || UNKNOWN;
    if (!audioFile) { setStatus('Elige el audio de tu canción.', 'err'); return; }
    if (!title) { setStatus('Escribe el título.', 'err'); return; }
    if (!$('#fRights').checked) { setStatus('Debes confirmar que tienes los derechos para compartirla.', 'err'); return; }
    if (sy) { exitSync(); }
    btn.disabled = true;
    setStatus('Subiendo… no cierres la página.');
    const uploaded = [];
    try {
      const id = await ensureUser();
      const ext = extOf(audioFile.name), base = crypto.randomUUID();
      const audioPath = id + '/' + base + '.' + ext;
      let r = await sb.storage.from('songs').upload(audioPath, audioFile, { contentType: MIME[ext], cacheControl: '31536000' });
      if (r.error) { throw r.error; }
      uploaded.push(['songs', audioPath]);
      let coverPath = null;
      if (coverBlob) {
        coverPath = id + '/' + base + '.jpg';
        r = await sb.storage.from('covers').upload(coverPath, coverBlob, { contentType: 'image/jpeg', cacheControl: '31536000' });
        if (r.error) { throw r.error; }
        uploaded.push(['covers', coverPath]);
      }
      const dur = isFinite(prev.duration) ? Math.round(prev.duration * 10) / 10 : null;
      r = await sb.from('songs').insert({
        title: title, artist: artist, audio_path: audioPath, cover_path: coverPath,
        lyrics: $('#lyr').value.slice(0, 20000), duration: dur
      });
      if (r.error) { throw r.error; }
      resetForm();
      setStatus('¡Listo! Tu canción ya está publicada.', 'ok');
      loadList();
    } catch (err) {
      console.error(err);
      // Si algo falló a medias, borra los archivos que sí se subieron.
      await Promise.all(uploaded.map((u) => sb.storage.from(u[0]).remove([u[1]]).catch(() => null)));
      setStatus(friendly(err), 'err');
    } finally {
      btn.disabled = false;
    }
  });

  /* ---------- Galería pública ---------- */
  const reported = (() => { try { return JSON.parse(localStorage.getItem('lp-reported') || '[]'); } catch (e) { return []; } })();
  const publicUrl = (bucket, path) => sb.storage.from(bucket).getPublicUrl(path).data.publicUrl;

  function songCard(s) {
    const url = publicUrl('songs', s.audio_path);
    const dlName = (s.artist + ' - ' + s.title + '.' + extOf(s.audio_path)).replace(/[\\/:*?"<>|]+/g, '_');
    const cover = s.cover_path
      ? h('img', { class: 'cv', src: publicUrl('covers', s.cover_path), alt: '', loading: 'lazy' })
      : h('div', { class: 'cv', 'aria-hidden': 'true' }, '♪');
    const player = h('audio', { controls: '', preload: 'none', src: url });
    player.addEventListener('play', () => {
      document.querySelectorAll('#list audio').forEach((a) => { if (a !== player) { a.pause(); } });
    });
    const lyrBox = h('pre', { class: 'lyr', hidden: '' }, stripAll(s.lyrics).trim());
    const acts = h('div', { class: 'acts' },
      h('a', { class: 'btn', href: url + '?download=' + encodeURIComponent(dlName), download: dlName }, 'Descargar'));
    if (s.lyrics) {
      acts.append(h('button', { type: 'button', class: 'btn', onclick: () => { lyrBox.hidden = !lyrBox.hidden; } }, 'Letra'));
    }
    if (!reported.includes(s.id) && s.owner !== uid) {
      const rb = h('button', { type: 'button', class: 'btn' }, 'Reportar');
      rb.addEventListener('click', async () => {
        if (!window.confirm('¿Reportar esta canción por contenido que no debería estar aquí?')) { return; }
        rb.disabled = true;
        const r = await sb.rpc('report_song', { song_id: s.id });
        if (!r.error) {
          reported.push(s.id);
          try { localStorage.setItem('lp-reported', JSON.stringify(reported)); } catch (e) { /* opcional */ }
          rb.textContent = 'Reportada';
        } else { rb.disabled = false; setStatus('No se pudo enviar el reporte.', 'err'); }
      });
      acts.append(rb);
    }
    if (uid && s.owner === uid) {
      const db = h('button', { type: 'button', class: 'btn danger' }, 'Borrar');
      db.addEventListener('click', async () => {
        if (!window.confirm('¿Borrar tu canción? Dejará de estar disponible para todos.')) { return; }
        const r = await sb.from('songs').delete().eq('id', s.id);
        if (r.error) { setStatus(friendly(r.error), 'err'); return; }
        await sb.storage.from('songs').remove([s.audio_path]).catch(() => null);
        if (s.cover_path) { await sb.storage.from('covers').remove([s.cover_path]).catch(() => null); }
        loadList();
      });
      acts.append(db);
    }
    return h('div', { class: 'song' }, cover,
      h('div', { class: 'body' },
        h('div', { class: 't' }, s.title, hasStamps(s.lyrics) ? h('span', { class: 'tag' }, 'LRC') : null),
        h('div', { class: 'a' }, s.artist), player, acts, lyrBox));
  }

  let loadSeq = 0;
  async function loadList() {
    const list = $('#list'), seq = ++loadSeq;
    const q = $('#fSearch').value.trim().replace(/[,()%*_\\]/g, ' ').trim();
    let query = sb.from('songs').select('*').order('created_at', { ascending: false }).limit(60);
    if (q) { query = query.or('title.ilike.%' + q + '%,artist.ilike.%' + q + '%'); }
    const r = await query;
    if (seq !== loadSeq) { return; }
    list.replaceChildren();
    if (r.error) { list.append(h('p', { class: 'sub' }, 'No se pudo cargar la lista. Revisa tu conexión y la configuración de Supabase.')); return; }
    if (!r.data.length) { list.append(h('p', { class: 'sub' }, q ? 'Sin resultados.' : 'Todavía no hay canciones. ¡Sé la primera persona en compartir una!')); return; }
    r.data.forEach((s) => list.append(songCard(s)));
  }
  let searchTimer = null;
  $('#fSearch').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(loadList, 300); });

  ensureUser().catch((e) => console.warn(e)).then(loadList);
})();
