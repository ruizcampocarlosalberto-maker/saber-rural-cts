/**
 * ════════════════════════════════════════════════════════════
 *  SABER RURAL v2.0 — server.js
 *  I.E. Pueblo Nuevo · INEPUN · Tierralta, Córdoba
 * ────────────────────────────────────────────────────────────
 *  Servidor Node.js — compatible LAN local Y despliegue en nube
 *  (Render, Railway, Fly.io, etc.)
 *
 *  CARACTERÍSTICAS:
 *  ✅ Puerto dinámico via process.env.PORT (requerido por Render)
 *  ✅ JWT_SECRET obligatorio en producción (variable de entorno)
 *  ✅ HOST adaptativo: 0.0.0.0 local, ajustado en nube
 *  ✅ CORS permisivo para LAN y producción
 *  ✅ Directorio de datos via DATA_DIR env (opcional)
 *  ✅ Chat en tiempo real (REST + polling)
 *  ✅ Registro de resultados de simulacros
 *  ✅ Dashboard del docente
 *  ✅ Subida de archivos (multer)
 *  ✅ Autenticación JWT ligera
 *
 *  VARIABLES DE ENTORNO (configurar en Render → Environment):
 *    PORT        → Render lo asigna automáticamente (NO tocar)
 *    JWT_SECRET  → ¡OBLIGATORIO en producción! Cadena larga y secreta
 *    NODE_ENV    → "production" en Render
 *
 *  USO LOCAL:
 *    npm install
 *    node server.js
 *
 *  DESPLIEGUE EN RENDER:
 *    Build Command:  npm install
 *    Start Command:  node server.js
 * ════════════════════════════════════════════════════════════
 */

'use strict';

const express  = require('express');
const path     = require('path');
const fs       = require('fs');
const multer   = require('multer');
const jwt      = require('jsonwebtoken');
const crypto   = require('crypto');

// ── Detección de entorno ─────────────────────────────────────
const IS_PROD = process.env.NODE_ENV === 'production';

// ── Configuración global ─────────────────────────────────────
//    PORT: Render (y cualquier PaaS) inyecta process.env.PORT.
//    El fallback 3000 aplica solo en desarrollo local.
const PORT = process.env.PORT || 3000;

//    HOST: En producción algunos entornos requieren escuchar solo
//    en 0.0.0.0 — esto ya funciona tanto local como en nube.
const HOST = '0.0.0.0';

//    JWT_SECRET: En producción DEBE venir de variable de entorno.
//    Si no está definida en producción, el servidor no arranca.
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  if (IS_PROD) {
    console.error('\n[ERROR FATAL] JWT_SECRET no está definido.');
    console.error('→ En Render: ve a Environment y agrega la variable JWT_SECRET.');
    process.exit(1);
  } else {
    // Solo en desarrollo local se permite el valor por defecto
    console.warn('[ADVERTENCIA] JWT_SECRET no definido. Usando valor de desarrollo (NO usar en producción).');
  }
}
const JWT_SECRET_FINAL = JWT_SECRET || 'inepun-saber-rural-dev-secret-local';
const JWT_EXPIRY = '12h';

//    DATA_DIR: En Render el sistema de archivos es efímero.
//    Los datos JSON se perderán al reiniciar — ver nota al pie.
const DATA_DIR   = process.env.DATA_DIR || path.join(__dirname, 'data');
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'public', 'uploads');

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

if (!fs.existsSync(FILES.users)) {
  writeJSON(FILES.users, DEFAULT_USERS);
  console.log('[INIT] Usuarios predeterminados creados.');
}

// ── Aplicación Express ───────────────────────────────────────
const app = express();

// ── CORS — permisivo para LAN y producción ───────────────────
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  if (req.path.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-store');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ── Middlewares ──────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Archivos estáticos
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOAD_DIR));

// ── Multer ───────────────────────────────────────────────────
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
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
});

// ── Middleware JWT ───────────────────────────────────────────
function requireAuth(req, res, next) {
  const auth  = req.headers['authorization'] || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Token requerido' });
  try {
    req.user = jwt.verify(token, JWT_SECRET_FINAL);
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

// ── Health check ─────────────────────────────────────────────
// Render usa este endpoint para verificar que el servidor está vivo
app.get('/api/ping', (req, res) => {
  res.json({
    ok: true,
    server: 'SABER RURAL v2.0',
    ie: 'I.E. Pueblo Nuevo · INEPUN',
    env: IS_PROD ? 'producción' : 'desarrollo',
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

  const serverHash = hashPass(password);
  const matches    = user && (user.password === serverHash || user.password === password);

  if (!matches) {
    const act = readJSON(FILES.actividad, []);
    act.push({ tipo: 'login_fallido', username, ip: req.ip, ts: new Date().toISOString() });
    if (act.length > 500) act.splice(0, act.length - 500);
    writeJSON(FILES.actividad, act);
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
  }

  const token = jwt.sign(
    { username: user.username, role: user.role, name: user.name },
    JWT_SECRET_FINAL,
    { expiresIn: JWT_EXPIRY }
  );

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

// ── CHAT — GET ───────────────────────────────────────────────
app.get('/api/chat', requireAuth, (req, res) => {
  let msgs = readJSON(FILES.chat, []);
  if (req.query.desde) {
    msgs = msgs.filter(m => m.ts && m.ts > req.query.desde);
  }
  if (msgs.length > 200) msgs = msgs.slice(-200);
  res.json({ ok: true, msgs, total: msgs.length });
});

// ── CHAT — POST ──────────────────────────────────────────────
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
    text:  text.trim().slice(0, 1000),
    time:  new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }),
    type:  'msg',
    ts:    new Date().toISOString()
  };
  msgs.push(msg);
  if (msgs.length > 500) msgs.splice(0, msgs.length - 500);
  writeJSON(FILES.chat, msgs);
  res.json({ ok: true, msg });
});

// ── CHAT — DELETE ────────────────────────────────────────────
app.delete('/api/chat', requireTutor, (req, res) => {
  const limpio = [{ type: 'sys', text: '🗑️ Chat limpiado por el docente · ' + new Date().toLocaleTimeString('es-CO'), ts: new Date().toISOString() }];
  writeJSON(FILES.chat, limpio);
  res.json({ ok: true });
});

// ── RESULTADO — POST ─────────────────────────────────────────
app.post('/api/resultado', requireAuth, (req, res) => {
  const body = req.body || {};
  const resultado = {
    username:   req.user.username,
    nombre:     req.user.name,
    modulo:     body.modulo   || 'desconocido',
    score:      Number(body.score)    || 0,
    total:      Number(body.total)    || 0,
    pct:        Number(body.pct)      || 0,
    duracion:   Number(body.duracion) || 0,
    respuestas: Array.isArray(body.respuestas) ? body.respuestas : [],
    fecha:      new Date().toLocaleString('es-CO', {
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

// ── RESULTADOS — GET (tutor) ─────────────────────────────────
app.get('/api/resultados', requireTutor, (req, res) => {
  const resultados = readJSON(FILES.resultados, []);
  res.json({ ok: true, resultados, total: resultados.length });
});

// ── DASHBOARD DEL DOCENTE ────────────────────────────────────
app.get('/api/dashboard', requireTutor, (req, res) => {
  const resultados  = readJSON(FILES.resultados, []);
  const notas       = readJSON(FILES.notas, { students: [] });
  const estudiantes = [...new Set(resultados.map(r => r.username))];

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
    tematicas: data.tematicas.slice(-5),
    promedio: data.pcts.length ? Math.round(data.pcts.reduce((a, b) => a + b, 0) / data.pcts.length) : 0
  }));

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

// ── NOTAS — SYNC ─────────────────────────────────────────────
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
    tipo:     action || 'actividad',
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

// ── ACTIVIDAD — GET ──────────────────────────────────────────
app.get('/api/actividad', requireTutor, (req, res) => {
  const act = readJSON(FILES.actividad, []);
  res.json({ ok: true, actividad: act.slice(-100).reverse() });
});

// ── RECURSOS — GET ───────────────────────────────────────────
app.get('/api/recursos', requireAuth, (req, res) => {
  const recursos = readJSON(FILES.recursos, []);
  res.json({ ok: true, recursos });
});

// ── RECURSOS — UPLOAD ────────────────────────────────────────
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

// ── RECURSOS — DELETE ────────────────────────────────────────
app.delete('/api/recursos/:id', requireTutor, (req, res) => {
  const id       = Number(req.params.id);
  let recursos   = readJSON(FILES.recursos, []);
  const resource = recursos.find(r => r.id === id);

  if (!resource) return res.status(404).json({ error: 'Recurso no encontrado' });

  const filePath = path.join(UPLOAD_DIR, resource.filename);
  if (fs.existsSync(filePath)) {
    try { fs.unlinkSync(filePath); }
    catch (e) { console.warn('[DELETE] No se pudo borrar archivo físico:', e.message); }
  }

  recursos = recursos.filter(r => r.id !== id);
  writeJSON(FILES.recursos, recursos);
  res.json({ ok: true });
});

// ── PERFILES ─────────────────────────────────────────────────
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

// ── PERFIL INDIVIDUAL ────────────────────────────────────────
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

// ── PROGRESO ─────────────────────────────────────────────────
app.get('/api/progreso', requireAuth, (req, res) => {
  const resultados = readJSON(FILES.resultados, []);
  const misRes     = resultados.filter(r => r.username === req.user.username);
  res.json({ ok: true, resultados: misRes });
});

// ── QUIZ RÁPIDO ──────────────────────────────────────────────
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


// ── RECURSOS — ENLACE URL (POST, solo tutor) ────────────────────────
app.post('/api/recursos/enlace', requireTutor, (req, res) => {
  const { titulo, modulo, enlace } = req.body || {};
  if (!enlace) return res.status(400).json({ error: 'URL requerida' });

  const recursos = readJSON(FILES.recursos, []);
  const id       = Date.now();
  const resource = {
    id,
    titulo:       (titulo || enlace).trim(),
    modulo:       modulo || 'general',
    tipo:         'enlace',
    url:          enlace,
    filename:     null,
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
  console.log(`[ENLACE] "${resource.titulo}" · ${req.user.name}`);
  res.json({ ok: true, resource });
});


// ── PERFIL — PATCH (actualizar datos del perfil) ─────────────
app.patch('/api/perfil', requireAuth, (req, res) => {
  const { nombre, telefono, fechaNacimiento, bio, intereses, emoji } = req.body || {};
  const users = readJSON(FILES.users, DEFAULT_USERS);
  const idx   = users.findIndex(u => u.username === req.user.username);
  if (idx === -1) return res.status(404).json({ error: 'Usuario no encontrado' });

  if (nombre)          users[idx].name            = nombre.trim();
  if (emoji)           users[idx].emoji           = emoji;
  if (telefono)        users[idx].telefono        = telefono;
  if (fechaNacimiento) users[idx].fechaNacimiento = fechaNacimiento;
  if (bio)             users[idx].bio             = bio;
  if (intereses)       users[idx].intereses       = intereses;

  writeJSON(FILES.users, users);
  res.json({ ok: true, user: { username: users[idx].username, name: users[idx].name, emoji: users[idx].emoji } });
});

// ── PERFIL — FOTO (POST, subir foto de perfil) ───────────────
app.post('/api/perfil/foto', requireAuth, upload.single('foto'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se recibió ninguna foto' });

  const users = readJSON(FILES.users, DEFAULT_USERS);
  const idx   = users.findIndex(u => u.username === req.user.username);
  if (idx === -1) return res.status(404).json({ error: 'Usuario no encontrado' });

  const fotoUrl = `/uploads/${req.file.filename}`;
  users[idx].fotoUrl = fotoUrl;
  writeJSON(FILES.users, users);

  console.log(`[FOTO] ${req.user.username} · ${req.file.filename}`);
  res.json({ ok: true, fotoUrl });
});

// ── Catch-all: servir index.html ─────────────────────────────
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
        <p>✅ API activa · Verifica en <strong>/api/ping</strong></p>
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
  const os   = require('os');
  const nets = os.networkInterfaces();
  const ips  = [];
  for (const iface of Object.values(nets)) {
    for (const addr of iface) {
      if (addr.family === 'IPv4' && !addr.internal) ips.push(addr.address);
    }
  }

  if (IS_PROD) {
    console.log('\n╔══════════════════════════════════════════════════╗');
    console.log('║   🌱 SABER RURAL v2.0 — Modo PRODUCCIÓN          ║');
    console.log('╠══════════════════════════════════════════════════╣');
    console.log(`║  ✅ Servidor activo en puerto ${PORT}               ║`);
    console.log('║  🌐 Desplegado en la nube (Render/Railway)        ║');
    console.log('║  🔒 JWT_SECRET desde variable de entorno          ║');
    console.log('╚══════════════════════════════════════════════════╝\n');
    console.log('[AVISO] El sistema de archivos en Render es efímero.');
    console.log('[AVISO] Los datos JSON y uploads se pierden al reiniciar.');
    console.log('[AVISO] Para persistencia use Render Disks o una base de datos.\n');
  } else {
    console.log('\n╔══════════════════════════════════════════════════╗');
    console.log('║   🌱 SABER RURAL v2.0 — I.E. Pueblo Nuevo       ║');
    console.log('║      Modo DESARROLLO LOCAL                       ║');
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
  }
});

module.exports = app;
