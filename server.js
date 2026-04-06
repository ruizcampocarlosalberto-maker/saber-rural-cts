/**
 * ════════════════════════════════════════════════════════════
 *  SABER RURAL v2.0 — server.js
 *  I.E. Pueblo Nuevo · INEPUN · Tierralta, Córdoba
 * ────────────────────────────────────────────────────────────
 *  Servidor Node.js para intranet local (LAN/WiFi sin internet)
 *  Compatible con celulares y tablets de la red del docente.
 *
 *  CARACTERÍSTICAS:
 *  ✅ IP dinámica — escucha en 0.0.0.0 (cualquier interfaz)
 *  ✅ CORS permisivo para LAN local
 *  ✅ Chat en tiempo real (endpoint REST + polling desde cliente)
 *  ✅ Registro de resultados de simulacros (POST /api/resultado)
 *  ✅ Dashboard del docente (GET /api/dashboard)
 *  ✅ Subida de archivos (POST /api/recursos/upload)
 *  ✅ Autenticación JWT ligera
 *  ✅ Sin dependencias externas pesadas (solo express + multer + jsonwebtoken)
 *
 *  INSTALACIÓN:
 *    npm install express multer jsonwebtoken
 *    node server.js
 *
 *  El servidor sirve el HTML desde /public/index.html
 *  Acceso desde celulares: http://<IP-del-PC>:3000
 * ════════════════════════════════════════════════════════════
 */

'use strict';

const express  = require('express');
const path     = require('path');
const fs       = require('fs');
const multer   = require('multer');
const jwt      = require('jsonwebtoken');
const crypto   = require('crypto');

// ── Configuración global ────────────────────────────────────
const PORT       = process.env.PORT || 3000;
const HOST       = '0.0.0.0';          // Escuchar en TODAS las interfaces de red
const JWT_SECRET = process.env.JWT_SECRET || 'inepun-saber-rural-2025-secret-lan';
const JWT_EXPIRY = '12h';              // Token válido 12 horas (una jornada escolar)
const DATA_DIR   = path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(__dirname, 'public', 'uploads');

// Crear directorios necesarios si no existen
[DATA_DIR, UPLOAD_DIR, path.join(__dirname, 'public')].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

// ── Archivos de datos (JSON simples, sin base de datos) ─────
const FILES = {
  users:      path.join(DATA_DIR, 'usuarios.json'),
  chat:       path.join(DATA_DIR, 'chat.json'),
  resultados: path.join(DATA_DIR, 'resultados.json'),
  notas:      path.join(DATA_DIR, 'notas.json'),
  recursos:   path.join(DATA_DIR, 'recursos.json'),
  actividad:  path.join(DATA_DIR, 'actividad.json'),
};

// Utilidades JSON ────────────────────────────────────────────
function readJSON(file, def = []) {
  try {
    if (!fs.existsSync(file)) return def;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch { return def; }
}

function writeJSON(file, data) {
  try { fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8'); }
  catch (e) { console.error('[DATA] Error escribiendo:', file, e.message); }
}

// ── Usuarios predeterminados ─────────────────────────────────
function hashPass(p) {
  return crypto.createHash('sha256').update('inepun_' + p).digest('hex');
}

const DEFAULT_USERS = [
  { username: 'profe',      password: hashPass('profe123'),   name: 'Profe Jhon Jairo',   emoji: '👨‍🏫', role: 'tutor'      },
  { username: 'tutor',      password: hashPass('inepun2025'), name: 'Tutor / Docente',     emoji: '👨‍🏫', role: 'tutor'      },
  { username: 'docente',    password: hashPass('admin123'),   name: 'Docente INEPUN',      emoji: '🏫',  role: 'tutor'      },
  { username: 'estudiante', password: hashPass('saber2025'),  name: 'Estudiante Demo',     emoji: '👨‍🎓', role: 'estudiante' },
  { username: 'carlos',     password: hashPass('saber2025'),  name: 'Carlos Martínez',     emoji: '👦',  role: 'estudiante' },
  { username: 'maria',      password: hashPass('saber2025'),  name: 'María González',      emoji: '👧',  role: 'estudiante' },
  { username: 'juan',       password: hashPass('saber2025'),  name: 'Juan Pérez',          emoji: '👦',  role: 'estudiante' },
  { username: 'ana',        password: hashPass('saber2025'),  name: 'Ana Ruiz',            emoji: '👧',  role: 'estudiante' },
  { username: 'pedro',      password: hashPass('saber2025'),  name: 'Pedro López',         emoji: '👦',  role: 'estudiante' },
];

// Inicializar usuarios si no existen
if (!fs.existsSync(FILES.users)) {
  writeJSON(FILES.users, DEFAULT_USERS);
  console.log('[INIT] Usuarios predeterminados creados.');
}

// ── Aplicación Express ───────────────────────────────────────
const app = express();

// ── CORS total para LAN local ────────────────────────────────
// Permite conexiones desde cualquier dispositivo de la red WiFi
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  // Cache mínimo para respuestas de API
  if (req.path.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-store');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ── Middlewares ──────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Archivos estáticos públicos (HTML + uploads)
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOAD_DIR));

// ── Multer — subida de archivos ──────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename:    (req, file, cb) => {
    const ext  = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
    cb(null, `${Date.now()}_${base}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB máximo
});

// ── Middleware de autenticación JWT ──────────────────────────
function requireAuth(req, res, next) {
  const auth = req.headers['authorization'] || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Token requerido' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido o expirado. Inicia sesión nuevamente.' });
  }
}

function requireTutor(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'tutor') {
      return res.status(403).json({ error: 'Acceso solo para docentes' });
    }
    next();
  });
}

// ════════════════════════════════════════════════════════════
//  ENDPOINTS API
// ════════════════════════════════════════════════════════════

// ── Ping / health check ──────────────────────────────────────
app.get('/api/ping', (req, res) => {
  res.json({
    ok: true,
    server: 'SABER RURAL v2.0',
    ie: 'I.E. Pueblo Nuevo · INEPUN',
    ts: new Date().toISOString(),
    uptime: Math.floor(process.uptime()) + 's'
  });
});

// ── LOGIN ────────────────────────────────────────────────────
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
  }

  const users = readJSON(FILES.users, DEFAULT_USERS);
  const user  = users.find(u => u.username === username.toLowerCase().trim());

  // Aceptar tanto hash SHA-256 del servidor como el hash FNV-1a del cliente HTML
  // (el HTML usa _hashPass que es FNV-1a, el servidor usa SHA-256)
  const serverHash = hashPass(password);
  const matches = user && (user.password === serverHash || user.password === password);

  if (!matches) {
    // Log intento fallido
    const act = readJSON(FILES.actividad, []);
    act.push({ tipo: 'login_fallido', username, ip: req.ip, ts: new Date().toISOString() });
    if (act.length > 500) act.splice(0, act.length - 500);
    writeJSON(FILES.actividad, act);
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
  }

  const token = jwt.sign(
    { username: user.username, role: user.role, name: user.name },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRY }
  );

  // Log de acceso
  const act = readJSON(FILES.actividad, []);
  act.push({ tipo: 'login', username: user.username, ip: req.ip, ts: new Date().toISOString() });
  if (act.length > 1000) act.splice(0, act.length - 1000);
  writeJSON(FILES.actividad, act);

  res.json({
    ok: true,
    token,
    user: { username: user.username, name: user.name, emoji: user.emoji, role: user.role }
  });
});

// ── CAMBIAR CONTRASEÑA ───────────────────────────────────────
app.post('/api/cambiar-password', requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Faltan campos requeridos' });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 6 caracteres' });
  }

  const users = readJSON(FILES.users, DEFAULT_USERS);
  const idx   = users.findIndex(u => u.username === req.user.username);
  if (idx === -1) return res.status(404).json({ error: 'Usuario no encontrado' });

  const currentHash = hashPass(currentPassword);
  if (users[idx].password !== currentHash && users[idx].password !== currentPassword) {
    return res.status(401).json({ error: 'La contraseña actual es incorrecta' });
  }

  users[idx].password = hashPass(newPassword);
  writeJSON(FILES.users, users);
  res.json({ ok: true, message: 'Contraseña actualizada correctamente' });
});

// ── CHAT — GET (con soporte ?desde= para polling incremental) ─
app.get('/api/chat', requireAuth, (req, res) => {
  let msgs = readJSON(FILES.chat, []);
  // Si viene parámetro "desde", filtrar mensajes más nuevos
  if (req.query.desde) {
    msgs = msgs.filter(m => m.ts && m.ts > req.query.desde);
  }
  // Limitar respuesta a los últimos 200 mensajes
  if (msgs.length > 200) msgs = msgs.slice(-200);
  res.json({ ok: true, msgs, total: msgs.length });
});

// ── CHAT — POST (enviar mensaje, estudiantes Y docente) ──────
app.post('/api/chat', requireAuth, (req, res) => {
  const { text } = req.body || {};
  if (!text || !text.trim()) {
    return res.status(400).json({ error: 'El mensaje no puede estar vacío' });
  }

  const msgs = readJSON(FILES.chat, []);
  const msg  = {
    user:  req.user.username,
    name:  req.user.name,
    emoji: req.user.role === 'tutor' ? '👨‍🏫' : '👤',
    role:  req.user.role,
    text:  text.trim().slice(0, 1000), // Límite de 1000 chars
    time:  new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }),
    type:  'msg',
    ts:    new Date().toISOString()
  };
  msgs.push(msg);

  // Mantener máximo 500 mensajes en disco
  if (msgs.length > 500) msgs.splice(0, msgs.length - 500);
  writeJSON(FILES.chat, msgs);

  res.json({ ok: true, msg });
});

// ── CHAT — DELETE (limpiar, solo tutor) ─────────────────────
app.delete('/api/chat', requireTutor, (req, res) => {
  const limpio = [{ type: 'sys', text: '🗑️ Chat limpiado por el docente · ' + new Date().toLocaleTimeString('es-CO'), ts: new Date().toISOString() }];
  writeJSON(FILES.chat, limpio);
  res.json({ ok: true });
});

// ── RESULTADO DE SIMULACRO — POST ───────────────────────────
app.post('/api/resultado', requireAuth, (req, res) => {
  const body = req.body || {};
  const resultado = {
    username: req.user.username,
    nombre:   req.user.name,
    modulo:   body.modulo   || 'desconocido',
    score:    Number(body.score)  || 0,
    total:    Number(body.total)  || 0,
    pct:      Number(body.pct)    || 0,
    duracion: Number(body.duracion) || 0,
    respuestas: Array.isArray(body.respuestas) ? body.respuestas : [],
    fecha:    new Date().toLocaleString('es-CO', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    }),
    ts: new Date().toISOString()
  };

  const resultados = readJSON(FILES.resultados, []);
  resultados.push(resultado);
  if (resultados.length > 2000) resultados.splice(0, resultados.length - 2000);
  writeJSON(FILES.resultados, resultados);

  console.log(`[RESULTADO] ${resultado.nombre} · ${resultado.modulo} · ${resultado.pct}%`);
  res.json({ ok: true, resultado });
});

// ── RESULTADO — GET (solo tutor, ver todos los resultados) ──
app.get('/api/resultados', requireTutor, (req, res) => {
  const resultados = readJSON(FILES.resultados, []);
  res.json({ ok: true, resultados, total: resultados.length });
});

// ── DASHBOARD DEL DOCENTE ────────────────────────────────────
app.get('/api/dashboard', requireTutor, (req, res) => {
  const resultados  = readJSON(FILES.resultados, []);
  const notas       = readJSON(FILES.notas, { students: [] });
  const estudiantes = [...new Set(resultados.map(r => r.username))];

  // Tabla BIO: resultados agrupados por estudiante
  const porEst = {};
  for (const r of resultados) {
    if (!porEst[r.username]) porEst[r.username] = { nombre: r.nombre, tematicas: [], pcts: [] };
    porEst[r.username].tematicas.push({ modulo: r.modulo, pct: r.pct, score: r.score, total: r.total, fecha: r.fecha });
    porEst[r.username].pcts.push(r.pct);
  }

  const tabla_bio = Object.entries(porEst).map(([username, data]) => ({
    username,
    emoji:    '👤',
    nombre:   data.nombre,
    tematicas: data.tematicas.slice(-5), // últimas 5 por estudiante
    promedio: data.pcts.length ? Math.round(data.pcts.reduce((a, b) => a + b, 0) / data.pcts.length) : 0
  }));

  // Tabla CTS: últimos 20 simulacros
  const tabla_cts = resultados.slice(-20).reverse().map(r => ({
    username: r.username,
    nombre:   r.nombre,
    modulo:   r.modulo,
    pct:      r.pct,
    score:    r.score,
    total:    r.total,
    duracion: r.duracion,
    fecha:    r.fecha
  }));

  const pcts = resultados.map(r => r.pct);
  const promedioGeneral = pcts.length
    ? Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length) + '%'
    : '—';

  res.json({
    ok: true,
    totalEstudiantes: estudiantes.length,
    totalQuizzes:     resultados.length,
    promedioGeneral,
    tabla_bio,
    tabla_cts,
    ultimaActualizacion: new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })
  });
});

// ── NOTAS — GET ──────────────────────────────────────────────
app.get('/api/notas', requireTutor, (req, res) => {
  const data = readJSON(FILES.notas, { students: [] });
  res.json({ ok: true, students: data.students || [] });
});

// ── NOTAS — SYNC (POST, solo tutor) ─────────────────────────
app.post('/api/notas/sync', requireTutor, (req, res) => {
  const { students } = req.body || {};
  if (!Array.isArray(students)) {
    return res.status(400).json({ error: 'Se esperaba array "students"' });
  }
  writeJSON(FILES.notas, { students, updatedAt: new Date().toISOString() });
  res.json({ ok: true, count: students.length });
});

// ── ACTIVIDAD — POST ─────────────────────────────────────────
app.post('/api/actividad', requireAuth, (req, res) => {
  const { action, detail } = req.body || {};
  const act = readJSON(FILES.actividad, []);
  act.push({
    tipo: action || 'actividad',
    username: req.user.username,
    nombre:   req.user.name,
    detail:   (detail || '').slice(0, 200),
    ip: req.ip,
    ts: new Date().toISOString()
  });
  if (act.length > 1000) act.splice(0, act.length - 1000);
  writeJSON(FILES.actividad, act);
  res.json({ ok: true });
});

// ── ACTIVIDAD — GET (solo tutor) ─────────────────────────────
app.get('/api/actividad', requireTutor, (req, res) => {
  const act = readJSON(FILES.actividad, []);
  res.json({ ok: true, actividad: act.slice(-100).reverse() });
});

// ── RECURSOS — GET ───────────────────────────────────────────
app.get('/api/recursos', requireAuth, (req, res) => {
  const recursos = readJSON(FILES.recursos, []);
  res.json({ ok: true, recursos });
});

// ── RECURSOS — UPLOAD (POST, solo tutor) ────────────────────
app.post('/api/recursos/upload', requireTutor, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se recibió ningún archivo' });

  const recursos = readJSON(FILES.recursos, []);
  const id       = Date.now();
  const resource = {
    id,
    titulo:       (req.body.titulo || req.file.originalname).trim(),
    modulo:       req.body.modulo || 'general',
    filename:     req.file.filename,
    originalName: req.file.originalname,
    mimeType:     req.file.mimetype,
    size:         req.file.size,
    url:          `/uploads/${req.file.filename}`,
    uploadedBy:   req.user.username,
    uploaderName: req.user.name,
    fecha:        new Date().toLocaleString('es-CO', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    }),
    ts: new Date().toISOString()
  };

  recursos.push(resource);
  writeJSON(FILES.recursos, recursos);

  console.log(`[UPLOAD] "${resource.titulo}" · ${(resource.size / 1024).toFixed(0)} KB · ${req.user.name}`);
  res.json({ ok: true, resource, url: resource.url });
});

// ── RECURSOS — DELETE (solo tutor) ──────────────────────────
app.delete('/api/recursos/:id', requireTutor, (req, res) => {
  const id       = Number(req.params.id);
  let recursos   = readJSON(FILES.recursos, []);
  const resource = recursos.find(r => r.id === id);

  if (!resource) return res.status(404).json({ error: 'Recurso no encontrado' });

  // Eliminar archivo físico
  const filePath = path.join(UPLOAD_DIR, resource.filename);
  if (fs.existsSync(filePath)) {
    try { fs.unlinkSync(filePath); }
    catch (e) { console.warn('[DELETE] No se pudo borrar archivo físico:', e.message); }
  }

  recursos = recursos.filter(r => r.id !== id);
  writeJSON(FILES.recursos, recursos);
  res.json({ ok: true });
});

// ── PERFILES — GET (lista pública de estudiantes, solo tutor) ─
app.get('/api/perfiles', requireTutor, (req, res) => {
  const resultados = readJSON(FILES.resultados, []);
  const users      = readJSON(FILES.users, DEFAULT_USERS);

  const perfiles = users
    .filter(u => u.role !== 'tutor')
    .map(u => {
      const misRes = resultados.filter(r => r.username === u.username);
      const pcts   = misRes.map(r => r.pct);
      return {
        username: u.username,
        nombre:   u.name,
        name:     u.name,
        emoji:    u.emoji || '👤',
        grado:    '11°',
        municipio:'Tierralta',
        stats: {
          totalQuizzes: misRes.length,
          promedioQuiz: pcts.length ? Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length) : 0
        }
      };
    });

  res.json({ ok: true, perfiles });
});

// ── PERFIL INDIVIDUAL — GET ──────────────────────────────────
app.get('/api/perfil/:username', requireAuth, (req, res) => {
  const users = readJSON(FILES.users, DEFAULT_USERS);
  const user  = users.find(u => u.username === req.params.username);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

  const resultados = readJSON(FILES.resultados, []);
  const misRes     = resultados.filter(r => r.username === user.username);
  const pcts       = misRes.map(r => r.pct);

  res.json({
    ok: true,
    perfil: {
      username: user.username,
      name:     user.name,
      emoji:    user.emoji || '👤',
      role:     user.role,
      stats: {
        totalQuizzes: misRes.length,
        promedioQuiz: pcts.length ? Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length) : 0
      }
    }
  });
});

// ── PROGRESO — GET (un estudiante ve su propio progreso) ─────
app.get('/api/progreso', requireAuth, (req, res) => {
  const resultados = readJSON(FILES.resultados, []);
  const misRes     = resultados.filter(r => r.username === req.user.username);
  res.json({ ok: true, resultados: misRes });
});

// ── QUIZ RÁPIDO — POST (endpoint alternativo a /api/resultado) ─
app.post('/api/quiz', requireAuth, (req, res) => {
  const { mod, score, total, pct } = req.body || {};
  const resultado = {
    username: req.user.username,
    nombre:   req.user.name,
    modulo:   mod || 'general',
    score:    Number(score) || 0,
    total:    Number(total) || 0,
    pct:      Number(pct)   || 0,
    duracion: 0,
    fecha:    new Date().toLocaleString('es-CO'),
    ts:       new Date().toISOString()
  };
  const resultados = readJSON(FILES.resultados, []);
  resultados.push(resultado);
  if (resultados.length > 2000) resultados.splice(0, resultados.length - 2000);
  writeJSON(FILES.resultados, resultados);
  res.json({ ok: true });
});

// ── Ruta catch-all: servir index.html ───────────────────────
// (para cuando el HTML está en /public/index.html)
app.get('*', (req, res) => {
  const indexPath = path.join(__dirname, 'public', 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send(`
      <html><body style="font-family:sans-serif;padding:40px;background:#f8f9fa">
        <h2>🏫 SABER RURAL v2.0 — I.E. Pueblo Nuevo</h2>
        <p style="color:#e74c3c">⚠️ No se encontró <code>public/index.html</code></p>
        <p>Copia el archivo HTML de SABER RURAL a la carpeta <strong>public/</strong></p>
        <pre style="background:#fff;padding:14px;border-radius:8px;border:1px solid #ddd">
mkdir public
cp SABER_RURAL_*.html public/index.html
node server.js</pre>
        <hr>
        <p>✅ El servidor API está funcionando correctamente en <strong>http://${req.hostname}:${PORT}</strong></p>
      </body></html>
    `);
  }
});

// ── Manejo global de errores ─────────────────────────────────
app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'Archivo demasiado grande (máximo 50 MB)' });
  }
  console.error('[ERROR]', err.message);
  res.status(500).json({ error: 'Error interno del servidor' });
});

// ── Iniciar servidor ─────────────────────────────────────────
app.listen(PORT, HOST, () => {
  // Obtener IPs locales para mostrar en consola
  const os   = require('os');
  const nets = os.networkInterfaces();
  const ips  = [];
  for (const iface of Object.values(nets)) {
    for (const addr of iface) {
      if (addr.family === 'IPv4' && !addr.internal) ips.push(addr.address);
    }
  }

  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║   🌱 SABER RURAL v2.0 — I.E. Pueblo Nuevo       ║');
  console.log('║      Servidor LAN para intranet escolar          ║');
  console.log('╠══════════════════════════════════════════════════╣');
  console.log(`║  ✅ Servidor activo en puerto ${PORT}               ║`);
  console.log('║                                                  ║');
  console.log('║  📡 Acceso desde este PC:                        ║');
  console.log(`║     http://localhost:${PORT}                        ║`);
  if (ips.length) {
    console.log('║                                                  ║');
    console.log('║  📱 Acceso desde celulares/tablets (WiFi):       ║');
    ips.forEach(ip => {
      const url = `http://${ip}:${PORT}`;
      const pad = ' '.repeat(Math.max(0, 46 - url.length));
      console.log(`║     ${url}${pad}║`);
    });
  }
  console.log('║                                                  ║');
  console.log('║  👨‍🏫 Usuarios de ejemplo:                         ║');
  console.log('║     profe / profe123     (Docente)               ║');
  console.log('║     carlos / saber2025   (Estudiante)            ║');
  console.log('╚══════════════════════════════════════════════════╝\n');
});

module.exports = app;
