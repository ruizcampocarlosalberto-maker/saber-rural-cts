/**
 * ════════════════════════════════════════════════════════════
 *  SABER RURAL v2.1 — server.js
 *  I.E. Pueblo Nuevo · INEPUN · Tierralta, Córdoba
 * ────────────────────────────────────────────────────────────
 *  VARIABLES DE ENTORNO (configurar en Bonto → Variables):
 *    PORT        → Asignado automáticamente
 *    JWT_SECRET  → OBLIGATORIO en producción
 *    MONGODB_URI → URI de MongoDB Atlas (para persistencia)
 *    NODE_ENV    → "production" en la nube
 *
 *  INSTALACIÓN LOCAL:
 *    npm install express multer jsonwebtoken mongoose
 *    node server.js
 * ════════════════════════════════════════════════════════════
 */
'use strict';
const express  = require('express');
const path     = require('path');
const fs       = require('fs');
const multer   = require('multer');
const jwt      = require('jsonwebtoken');
const crypto   = require('crypto');

let mongoose, usandoMongo = false;
try { mongoose = require('mongoose'); } catch(e) { console.warn('[MONGO] mongoose no instalado.'); }

const IS_PROD        = process.env.NODE_ENV === 'production';
const PORT           = process.env.PORT || 3000;
const HOST           = '0.0.0.0';
const JWT_SECRET_F   = process.env.JWT_SECRET || (IS_PROD ? null : 'inepun-dev-secret');
if (!JWT_SECRET_F)   { console.error('[FATAL] JWT_SECRET no definido.'); process.exit(1); }
const JWT_EXPIRY     = '12h';
const DATA_DIR       = process.env.DATA_DIR   || path.join(__dirname, 'data');
const UPLOAD_DIR     = process.env.UPLOAD_DIR || path.join(__dirname, 'public', 'uploads');
[DATA_DIR, UPLOAD_DIR, path.join(__dirname,'public')].forEach(d => { if(!fs.existsSync(d)) fs.mkdirSync(d,{recursive:true}); });

// ── Modelos MongoDB ──────────────────────────────────────────
let UserM, ChatM, ResultadoM, NotasM, RecursoM, ActividadM, SesionM;
function definirModelos() {
  const S = mongoose.Schema;
  UserM      = mongoose.models.User      || mongoose.model('User',      new S({ username:{type:String,unique:true,required:true}, password:String, name:String, emoji:{type:String,default:'👤'}, role:{type:String,default:'estudiante'}, fotoUrl:String, telefono:String, fechaNacimiento:String, bio:String, intereses:String, grado:String, primerIngresoCompletado:{type:Boolean,default:false}, primerIngresoTs:String, creado:String, creadoPor:String }, {timestamps:true}));
  ChatM      = mongoose.models.Chat      || mongoose.model('Chat',      new S({ user:String, name:String, emoji:String, role:String, text:String, time:String, type:{type:String,default:'msg'}, ts:{type:String,default:()=>new Date().toISOString()} }));
  ResultadoM = mongoose.models.Resultado || mongoose.model('Resultado', new S({ username:String, nombre:String, modulo:String, score:Number, total:Number, pct:Number, duracion:Number, respuestas:Array, fecha:String, ts:{type:String,default:()=>new Date().toISOString()} }));
  NotasM     = mongoose.models.Notas     || mongoose.model('Notas',     new S({ students:Array, updatedAt:String }));
  RecursoM   = mongoose.models.Recurso   || mongoose.model('Recurso',   new S({ id:Number, titulo:String, modulo:{type:String,default:'general'}, tipo:{type:String,default:'archivo'}, filename:String, originalName:String, mimeType:String, size:Number, url:String, uploadedBy:String, uploaderName:String, fecha:String, ts:{type:String,default:()=>new Date().toISOString()} }));
  ActividadM = mongoose.models.Actividad || mongoose.model('Actividad', new S({ tipo:String, username:String, nombre:String, detail:String, ip:String, ts:{type:String,default:()=>new Date().toISOString()} }));
  SesionM    = mongoose.models.Sesion    || mongoose.model('Sesion',    new S({ username:{type:String,unique:true}, name:String, emoji:String, role:String, ip:String, loginTs:String, lastSeen:String }));
}

// ── JSON fallback ────────────────────────────────────────────
const FILES = { users:path.join(DATA_DIR,'usuarios.json'), chat:path.join(DATA_DIR,'chat.json'), resultados:path.join(DATA_DIR,'resultados.json'), notas:path.join(DATA_DIR,'notas.json'), recursos:path.join(DATA_DIR,'recursos.json'), actividad:path.join(DATA_DIR,'actividad.json'), sesiones:path.join(DATA_DIR,'sesiones.json') };
function rJSON(f,d=[]){ try{ if(!fs.existsSync(f)) return d; return JSON.parse(fs.readFileSync(f,'utf8')); }catch{return d;} }
function wJSON(f,data){ try{ fs.writeFileSync(f,JSON.stringify(data,null,2),'utf8'); }catch(e){ console.error('[DATA]',e.message); } }

function hashPass(p){ return crypto.createHash('sha256').update('inepun_'+p).digest('hex'); }
const DU = [
  {username:'profe',     password:hashPass('profe123'),   name:'Profe Jhon Jairo', emoji:'👨‍🏫',role:'tutor'},
  {username:'tutor',     password:hashPass('inepun2025'), name:'Tutor / Docente',  emoji:'👨‍🏫',role:'tutor'},
  {username:'docente',   password:hashPass('admin123'),   name:'Docente INEPUN',   emoji:'🏫', role:'tutor'},
  {username:'estudiante',password:hashPass('saber2025'),  name:'Estudiante Demo',  emoji:'👨‍🎓',role:'estudiante'},
  {username:'carlos',    password:hashPass('saber2025'),  name:'Carlos Martínez',  emoji:'👦', role:'estudiante'},
  {username:'maria',     password:hashPass('saber2025'),  name:'María González',   emoji:'👧', role:'estudiante'},
  {username:'juan',      password:hashPass('saber2025'),  name:'Juan Pérez',       emoji:'👦', role:'estudiante'},
  {username:'ana',       password:hashPass('saber2025'),  name:'Ana Ruiz',         emoji:'👧', role:'estudiante'},
  {username:'pedro',     password:hashPass('saber2025'),  name:'Pedro López',      emoji:'👦', role:'estudiante'},
];

async function initUsers(){ if(usandoMongo){ const c=await UserM.countDocuments(); if(c===0){ try{ await UserM.insertMany(DU,{ordered:false}); }catch(e){ if(e.code!==11000) console.error("[INIT]",e.message); } } } else if(!fs.existsSync(FILES.users)) wJSON(FILES.users,DU); }

// ── Helpers unificados ───────────────────────────────────────
async function getUsers(){ return usandoMongo ? UserM.find().lean() : rJSON(FILES.users,DU); }
async function saveUser(u){ if(usandoMongo) await UserM.findOneAndUpdate({username:u.username},u,{upsert:true,new:true}); else { const us=rJSON(FILES.users,DU); const i=us.findIndex(x=>x.username===u.username); if(i>=0) us[i]={...us[i],...u}; else us.push(u); wJSON(FILES.users,us); } }
async function deleteUser(username){ if(usandoMongo) await UserM.deleteOne({username}); else { let us=rJSON(FILES.users,DU); us=us.filter(u=>u.username!==username); wJSON(FILES.users,us); } }
async function getChat(d){ if(usandoMongo){ const q=d?{ts:{$gt:d}}:{}; return ChatM.find(q).sort({ts:1}).limit(200).lean(); } let m=rJSON(FILES.chat,[]); if(d) m=m.filter(x=>x.ts&&x.ts>d); return m.slice(-200); }
async function saveChat(m){ if(usandoMongo){ await new ChatM(m).save(); const t=await ChatM.countDocuments(); if(t>500){ const o=await ChatM.find().sort({ts:1}).limit(t-500).select('_id'); await ChatM.deleteMany({_id:{$in:o.map(x=>x._id)}}); } } else { const ms=rJSON(FILES.chat,[]); ms.push(m); if(ms.length>500) ms.splice(0,ms.length-500); wJSON(FILES.chat,ms); } }
async function clearChat(){ const s={type:'sys',text:'🗑️ Chat limpiado · '+new Date().toLocaleTimeString('es-CO'),ts:new Date().toISOString()}; if(usandoMongo){ await ChatM.deleteMany({}); await new ChatM(s).save(); } else wJSON(FILES.chat,[s]); }
async function getResultados(){ return usandoMongo ? ResultadoM.find().sort({ts:-1}).lean() : rJSON(FILES.resultados,[]); }
async function saveResultado(r){ if(usandoMongo) await new ResultadoM(r).save(); else { const rs=rJSON(FILES.resultados,[]); rs.push(r); if(rs.length>2000) rs.splice(0,rs.length-2000); wJSON(FILES.resultados,rs); } }
async function deleteResultadosUser(username){ if(usandoMongo){ const r=await ResultadoM.deleteMany({username}); return r.deletedCount||0; } const rs=rJSON(FILES.resultados,[]); const nuevos=rs.filter(r=>r.username!==username); wJSON(FILES.resultados,nuevos); return rs.length-nuevos.length; }
async function getNotas(){ if(usandoMongo){ const n=await NotasM.findOne().lean(); return n?n.students||[]:[] } const d=rJSON(FILES.notas,{students:[]}); return d.students||[]; }
async function saveNotas(s){ if(usandoMongo) await NotasM.findOneAndUpdate({},{students:s,updatedAt:new Date().toISOString()},{upsert:true}); else wJSON(FILES.notas,{students:s,updatedAt:new Date().toISOString()}); }
async function getRecursos(){ return usandoMongo ? RecursoM.find().sort({ts:-1}).lean() : rJSON(FILES.recursos,[]); }
async function saveRecurso(r){ if(usandoMongo) await new RecursoM(r).save(); else { const rs=rJSON(FILES.recursos,[]); rs.push(r); wJSON(FILES.recursos,rs); } }
async function deleteRecurso(id){ if(usandoMongo) await RecursoM.deleteOne({id}); else { let rs=rJSON(FILES.recursos,[]); rs=rs.filter(r=>r.id!==id); wJSON(FILES.recursos,rs); } }
async function saveAct(a){ if(usandoMongo){ await new ActividadM(a).save(); const t=await ActividadM.countDocuments(); if(t>1000){ const o=await ActividadM.find().sort({ts:1}).limit(t-1000).select('_id'); await ActividadM.deleteMany({_id:{$in:o.map(x=>x._id)}}); } } else { const as=rJSON(FILES.actividad,[]); as.push(a); if(as.length>1000) as.splice(0,as.length-1000); wJSON(FILES.actividad,as); } }
async function getAct(){ return usandoMongo ? ActividadM.find().sort({ts:-1}).limit(100).lean() : rJSON(FILES.actividad,[]).slice(-100).reverse(); }
async function saveSesion(s){ if(usandoMongo) await SesionM.findOneAndUpdate({username:s.username},s,{upsert:true,new:true}); else { const ss=rJSON(FILES.sesiones,[]); const i=ss.findIndex(x=>x.username===s.username); if(i>=0) ss[i]=s; else ss.push(s); wJSON(FILES.sesiones,ss); } }
async function touchSesion(username){ const ts=new Date().toISOString(); try{ if(usandoMongo) await SesionM.findOneAndUpdate({username},{lastSeen:ts}); else { const ss=rJSON(FILES.sesiones,[]); const i=ss.findIndex(x=>x.username===username); if(i>=0){ ss[i].lastSeen=ts; wJSON(FILES.sesiones,ss); } } }catch{} }
async function getSesiones(){ return usandoMongo ? SesionM.find().lean() : rJSON(FILES.sesiones,[]); }

// ── Express ──────────────────────────────────────────────────
const app = express();
app.use((req,res,next)=>{ res.setHeader('Access-Control-Allow-Origin','*'); res.setHeader('Access-Control-Allow-Methods','GET,POST,PUT,PATCH,DELETE,OPTIONS'); res.setHeader('Access-Control-Allow-Headers','Content-Type,Authorization,X-Requested-With'); if(req.path.startsWith('/api/')) res.setHeader('Cache-Control','no-store'); if(req.method==='OPTIONS') return res.sendStatus(204); next(); });
app.use(express.json({limit:'10mb'}));
app.use(express.urlencoded({extended:true,limit:'10mb'}));
app.use(express.static(path.join(__dirname,'public')));
app.use('/uploads',express.static(UPLOAD_DIR));

const storage = multer.diskStorage({ destination:(req,file,cb)=>cb(null,UPLOAD_DIR), filename:(req,file,cb)=>{ const ext=path.extname(file.originalname); const base=path.basename(file.originalname,ext).replace(/[^a-zA-Z0-9_-]/g,'_'); cb(null,`${Date.now()}_${base}${ext}`); } });
const upload = multer({storage,limits:{fileSize:50*1024*1024}});

function requireAuth(req,res,next){ const token=(req.headers['authorization']||'').replace(/^Bearer\s+/i,''); if(!token) return res.status(401).json({error:'Token requerido'}); try{ req.user=jwt.verify(token,JWT_SECRET_F); touchSesion(req.user.username); next(); }catch{ res.status(401).json({error:'Token inválido o expirado.'}); } }
function requireTutor(req,res,next){ requireAuth(req,res,()=>{ if(req.user.role!=='tutor') return res.status(403).json({error:'Acceso solo para docentes'}); next(); }); }

// ── Endpoints ────────────────────────────────────────────────
app.get('/api/ping',(req,res)=>res.json({ok:true,server:'SABER RURAL v2.1',ie:'I.E. Pueblo Nuevo · INEPUN',env:IS_PROD?'producción':'desarrollo',db:usandoMongo?'MongoDB Atlas ✅':'JSON local ⚠️',ts:new Date().toISOString(),uptime:Math.floor(process.uptime())+'s'}));

app.post('/api/login',async(req,res)=>{ const{username,password}=req.body||{}; if(!username||!password) return res.status(400).json({error:'Usuario y contraseña requeridos'}); const users=await getUsers(); const user=users.find(u=>u.username===username.toLowerCase().trim()); const ok=user&&(user.password===hashPass(password)||user.password===password); if(!ok){ await saveAct({tipo:'login_fallido',username,ip:req.ip,ts:new Date().toISOString()}); return res.status(401).json({error:'Usuario o contraseña incorrectos'}); } const token=jwt.sign({username:user.username,role:user.role,name:user.name},JWT_SECRET_F,{expiresIn:JWT_EXPIRY}); await saveAct({tipo:'login',username:user.username,ip:req.ip,ts:new Date().toISOString()}); await saveSesion({username:user.username,name:user.name,emoji:user.emoji,role:user.role,ip:req.ip,loginTs:new Date().toISOString(),lastSeen:new Date().toISOString()}); res.json({ok:true,token,user:{username:user.username,name:user.name,emoji:user.emoji,role:user.role,primerIngresoCompletado:user.primerIngresoCompletado||false}}); });

app.post('/api/cambiar-password',requireAuth,async(req,res)=>{ const{currentPassword,newPassword}=req.body||{}; if(!currentPassword||!newPassword) return res.status(400).json({error:'Faltan campos'}); if(newPassword.length<6) return res.status(400).json({error:'Mínimo 6 caracteres'}); const users=await getUsers(); const user=users.find(u=>u.username===req.user.username); if(!user) return res.status(404).json({error:'Usuario no encontrado'}); if(user.password!==hashPass(currentPassword)&&user.password!==currentPassword) return res.status(401).json({error:'Contraseña actual incorrecta'}); await saveUser({...user,password:hashPass(newPassword)}); res.json({ok:true,message:'Contraseña actualizada'}); });

app.patch('/api/perfil',requireAuth,async(req,res)=>{ const{nombre,telefono,fechaNacimiento,bio,intereses,emoji}=req.body||{}; const users=await getUsers(); const user=users.find(u=>u.username===req.user.username); if(!user) return res.status(404).json({error:'Usuario no encontrado'}); const u={...user,name:nombre?nombre.trim():user.name,emoji:emoji||user.emoji,telefono:telefono||user.telefono,fechaNacimiento:fechaNacimiento||user.fechaNacimiento,bio:bio||user.bio,intereses:intereses||user.intereses}; await saveUser(u); res.json({ok:true,user:{username:u.username,name:u.name,emoji:u.emoji}}); });

app.post('/api/perfil/foto',requireAuth,upload.single('foto'),async(req,res)=>{ if(!req.file) return res.status(400).json({error:'No se recibió foto'}); const users=await getUsers(); const user=users.find(u=>u.username===req.user.username); if(!user) return res.status(404).json({error:'Usuario no encontrado'}); const fotoUrl=`/uploads/${req.file.filename}`; await saveUser({...user,fotoUrl}); res.json({ok:true,fotoUrl}); });

app.get('/api/perfil/:username',requireAuth,async(req,res)=>{ const users=await getUsers(); const user=users.find(u=>u.username===req.params.username); if(!user) return res.status(404).json({error:'Usuario no encontrado'}); const rs=await getResultados(); const mis=rs.filter(r=>r.username===user.username); const pcts=mis.map(r=>r.pct); res.json({ok:true,perfil:{username:user.username,name:user.name,emoji:user.emoji||'👤',role:user.role,fotoUrl:user.fotoUrl||null,stats:{totalQuizzes:mis.length,promedioQuiz:pcts.length?Math.round(pcts.reduce((a,b)=>a+b,0)/pcts.length):0}}}); });

app.get('/api/perfiles',requireTutor,async(req,res)=>{ const rs=await getResultados(); const users=await getUsers(); const perfiles=users.filter(u=>u.role!=='tutor').map(u=>{ const mis=rs.filter(r=>r.username===u.username); const pcts=mis.map(r=>r.pct); return{username:u.username,nombre:u.name,name:u.name,emoji:u.emoji||'👤',grado:u.grado||'11°',municipio:'Tierralta',stats:{totalQuizzes:mis.length,promedioQuiz:pcts.length?Math.round(pcts.reduce((a,b)=>a+b,0)/pcts.length):0}}; }); res.json({ok:true,perfiles}); });

app.get('/api/chat',requireAuth,async(req,res)=>{ const msgs=await getChat(req.query.desde||null); res.json({ok:true,msgs,total:msgs.length}); });

app.post('/api/chat',requireAuth,async(req,res)=>{ const{text}=req.body||{}; if(!text||!text.trim()) return res.status(400).json({error:'Mensaje vacío'}); const msg={user:req.user.username,name:req.user.name,emoji:req.user.role==='tutor'?'👨‍🏫':'👤',role:req.user.role,text:text.trim().slice(0,1000),time:new Date().toLocaleTimeString('es-CO',{hour:'2-digit',minute:'2-digit'}),type:'msg',ts:new Date().toISOString()}; await saveChat(msg); res.json({ok:true,msg}); });

app.delete('/api/chat',requireTutor,async(req,res)=>{ await clearChat(); res.json({ok:true}); });

app.post('/api/resultado',requireAuth,async(req,res)=>{ const b=req.body||{}; const r={username:req.user.username,nombre:req.user.name,modulo:b.modulo||'desconocido',score:Number(b.score)||0,total:Number(b.total)||0,pct:Number(b.pct)||0,duracion:Number(b.duracion)||0,respuestas:Array.isArray(b.respuestas)?b.respuestas:[],fecha:new Date().toLocaleString('es-CO',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}),ts:new Date().toISOString()}; await saveResultado(r); res.json({ok:true,resultado:r}); });

app.get('/api/resultados',requireTutor,async(req,res)=>{ const rs=await getResultados(); res.json({ok:true,resultados:rs,total:rs.length}); });

app.post('/api/quiz',requireAuth,async(req,res)=>{ const{mod,score,total,pct}=req.body||{}; await saveResultado({username:req.user.username,nombre:req.user.name,modulo:mod||'general',score:Number(score)||0,total:Number(total)||0,pct:Number(pct)||0,duracion:0,fecha:new Date().toLocaleString('es-CO'),ts:new Date().toISOString()}); res.json({ok:true}); });

app.get('/api/dashboard',requireTutor,async(req,res)=>{ const rs=await getResultados(); const ests=[...new Set(rs.map(r=>r.username))]; const por={}; for(const r of rs){ if(!por[r.username]) por[r.username]={nombre:r.nombre,tematicas:[],pcts:[]}; por[r.username].tematicas.push({modulo:r.modulo,pct:r.pct,score:r.score,total:r.total,fecha:r.fecha}); por[r.username].pcts.push(r.pct); } const tb=Object.entries(por).map(([u,d])=>({username:u,emoji:'👤',nombre:d.nombre,tematicas:d.tematicas.slice(-5),promedio:d.pcts.length?Math.round(d.pcts.reduce((a,b)=>a+b,0)/d.pcts.length):0})); const tc=rs.slice(0,20).map(r=>({username:r.username,nombre:r.nombre,modulo:r.modulo,pct:r.pct,score:r.score,total:r.total,duracion:r.duracion,fecha:r.fecha})); const pcts=rs.map(r=>r.pct); res.json({ok:true,totalEstudiantes:ests.length,totalQuizzes:rs.length,promedioGeneral:pcts.length?Math.round(pcts.reduce((a,b)=>a+b,0)/pcts.length)+'%':'—',tabla_bio:tb,tabla_cts:tc,ultimaActualizacion:new Date().toLocaleTimeString('es-CO',{hour:'2-digit',minute:'2-digit'})}); });

app.get('/api/notas',requireTutor,async(req,res)=>{ res.json({ok:true,students:await getNotas()}); });
app.post('/api/notas/sync',requireTutor,async(req,res)=>{ const{students}=req.body||{}; if(!Array.isArray(students)) return res.status(400).json({error:'Se esperaba array'}); await saveNotas(students); res.json({ok:true,count:students.length}); });

app.post('/api/actividad',requireAuth,async(req,res)=>{ const{action,detail}=req.body||{}; await saveAct({tipo:action||'actividad',username:req.user.username,nombre:req.user.name,detail:(detail||'').slice(0,200),ip:req.ip,ts:new Date().toISOString()}); res.json({ok:true}); });
app.get('/api/actividad',requireTutor,async(req,res)=>{ res.json({ok:true,actividad:await getAct()}); });

app.get('/api/recursos',requireAuth,async(req,res)=>{ res.json({ok:true,recursos:await getRecursos()}); });

app.post('/api/recursos/upload',requireTutor,upload.single('file'),async(req,res)=>{ if(!req.file) return res.status(400).json({error:'No se recibió archivo'}); const r={id:Date.now(),titulo:(req.body.titulo||req.file.originalname).trim(),modulo:req.body.modulo||'general',tipo:'archivo',filename:req.file.filename,originalName:req.file.originalname,mimeType:req.file.mimetype,size:req.file.size,url:`/uploads/${req.file.filename}`,uploadedBy:req.user.username,uploaderName:req.user.name,fecha:new Date().toLocaleString('es-CO',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}),ts:new Date().toISOString()}; await saveRecurso(r); res.json({ok:true,resource:r,url:r.url}); });

app.post('/api/recursos/enlace',requireTutor,async(req,res)=>{ const{titulo,modulo,enlace,url}=req.body||{}; const finalUrl=enlace||url; if(!finalUrl) return res.status(400).json({error:'URL requerida'}); const r={id:Date.now(),titulo:(titulo||finalUrl).trim(),modulo:modulo||'general',tipo:'enlace',url:finalUrl,filename:null,uploadedBy:req.user.username,uploaderName:req.user.name,fecha:new Date().toLocaleString('es-CO',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}),ts:new Date().toISOString()}; await saveRecurso(r); res.json({ok:true,resource:r,recurso:r}); });

app.delete('/api/recursos/:id',requireTutor,async(req,res)=>{ const id=Number(req.params.id); const rs=await getRecursos(); const r=rs.find(x=>x.id===id); if(!r) return res.status(404).json({error:'Recurso no encontrado'}); if(r.filename){ const fp=path.join(UPLOAD_DIR,r.filename); if(fs.existsSync(fp)) try{fs.unlinkSync(fp);}catch(e){} } await deleteRecurso(id); res.json({ok:true}); });

app.get('/api/progreso',requireAuth,async(req,res)=>{ const rs=await getResultados(); res.json({ok:true,resultados:rs.filter(r=>r.username===req.user.username)}); });

// ════════════════════════════════════════════════════════════
//  ENDPOINTS AÑADIDOS — Compatibilidad con index.html v6
// ════════════════════════════════════════════════════════════

// ── PRIMER INGRESO (POST) ────────────────────────────────────
app.post('/api/primer-ingreso',requireAuth,async(req,res)=>{
  const users=await getUsers();
  const user=users.find(u=>u.username===req.user.username);
  if(!user) return res.status(404).json({error:'Usuario no encontrado'});
  await saveUser({...user,primerIngresoCompletado:true,primerIngresoTs:new Date().toISOString()});
  res.json({ok:true});
});

// ── SESIONES ACTIVAS (GET, solo tutor) ───────────────────────
app.get('/api/sesiones',requireTutor,async(req,res)=>{
  const sesiones=await getSesiones();
  const ahora=Date.now();
  const CINCO_MIN=5*60*1000;
  const activas=sesiones.filter(s=>{
    const last=new Date(s.lastSeen||s.loginTs).getTime();
    return (ahora-last)<CINCO_MIN;
  }).map(s=>({
    username:s.username,name:s.name,emoji:s.emoji,role:s.role,
    loginTs:s.loginTs,lastSeen:s.lastSeen,
    minutosActivo:Math.round((ahora-new Date(s.loginTs).getTime())/60000)
  }));
  res.json({ok:true,sesiones:activas});
});

// ── ESTUDIANTES — LISTAR (GET, solo tutor) ───────────────────
app.get('/api/estudiantes',requireTutor,async(req,res)=>{
  const users=await getUsers();
  const estudiantes=users.filter(u=>u.role==='estudiante').map(u=>({
    username:u.username,nombre:u.name,emoji:u.emoji||'👨‍🎓',
    grado:u.grado||'',fotoUrl:u.fotoUrl||null,creado:u.creado||null
  }));
  res.json({ok:true,estudiantes});
});

// ── ESTUDIANTES — CREAR (POST, solo tutor) ───────────────────
app.post('/api/estudiantes',requireTutor,async(req,res)=>{
  const{username,nombre,grado,clave}=req.body||{};
  if(!username||!nombre||!clave) return res.status(400).json({error:'Faltan datos: username, nombre y clave son obligatorios'});
  const users=await getUsers();
  const userClean=username.toLowerCase().trim();
  if(users.some(u=>u.username===userClean)) return res.status(409).json({error:'Ya existe un usuario con ese nombre'});
  const nuevo={username:userClean,password:hashPass(clave),name:nombre.trim(),emoji:'👨‍🎓',role:'estudiante',grado:grado||'',creado:new Date().toISOString(),creadoPor:req.user.username};
  await saveUser(nuevo);
  res.json({ok:true,estudiante:{username:nuevo.username,nombre:nuevo.name,grado:nuevo.grado}});
});

// ── ESTUDIANTES — RESETEAR CLAVE (POST, solo tutor) ──────────
app.post('/api/estudiantes/:username/reset',requireTutor,async(req,res)=>{
  const{nuevaClave}=req.body||{};
  if(!nuevaClave) return res.status(400).json({error:'Nueva clave requerida'});
  const users=await getUsers();
  const user=users.find(u=>u.username===req.params.username&&u.role==='estudiante');
  if(!user) return res.status(404).json({error:'Estudiante no encontrado'});
  await saveUser({...user,password:hashPass(nuevaClave),primerIngresoCompletado:false});
  res.json({ok:true});
});

// ── ESTUDIANTES — ELIMINAR (DELETE, solo tutor) ──────────────
app.delete('/api/estudiantes/:username',requireTutor,async(req,res)=>{
  const users=await getUsers();
  const user=users.find(u=>u.username===req.params.username&&u.role==='estudiante');
  if(!user) return res.status(404).json({error:'Estudiante no encontrado'});
  await deleteUser(req.params.username);
  res.json({ok:true});
});

// ── ESTUDIANTES — RESETEAR PROGRESO (POST, solo tutor) ───────
app.post('/api/estudiantes/:username/reset-progreso',requireTutor,async(req,res)=>{
  const eliminados=await deleteResultadosUser(req.params.username);
  res.json({ok:true,eliminados:{resultados:eliminados}});
});

// ════════════════════════════════════════════════════════════

app.get('*',(req,res)=>{ const p=path.join(__dirname,'public','index.html'); if(fs.existsSync(p)) res.sendFile(p); else res.status(404).send('<h2>🏫 SABER RURAL v2.1</h2><p>No se encontró public/index.html</p><p>API activa en <a href="/api/ping">/api/ping</a></p>'); });

app.use((err,req,res,next)=>{ if(err.code==='LIMIT_FILE_SIZE') return res.status(413).json({error:'Archivo demasiado grande (máx 50MB)'}); console.error('[ERROR]',err.message); res.status(500).json({error:'Error interno'}); });

// ── Inicio ───────────────────────────────────────────────────
async function iniciar(){
  if(mongoose&&process.env.MONGODB_URI){
    try{
      await mongoose.connect(process.env.MONGODB_URI,{serverSelectionTimeoutMS:5000});
      definirModelos(); usandoMongo=true;
      console.log('[MONGO] ✅ Conectado a MongoDB Atlas — datos permanentes');
    }catch(e){ console.warn('[MONGO] ⚠️ Sin conexión:',e.message,'— usando JSON local.'); }
  } else { console.log('[DB] Usando archivos JSON locales.'); }

  await initUsers();

  app.listen(PORT,HOST,()=>{
    const os=require('os'); const nets=os.networkInterfaces(); const ips=[];
    for(const i of Object.values(nets)) for(const a of i) if(a.family==='IPv4'&&!a.internal) ips.push(a.address);
    console.log('\n╔══════════════════════════════════════════════════╗');
    console.log(`║   🌱 SABER RURAL v2.1 — ${IS_PROD?'PRODUCCIÓN        ':'DESARROLLO LOCAL  '}║`);
    console.log('╠══════════════════════════════════════════════════╣');
    console.log(`║  ✅ Puerto: ${PORT}  🗄️ DB: ${usandoMongo?'MongoDB Atlas':'JSON local      '}   ║`);
    if(!IS_PROD) ips.forEach(ip=>{ const u=`http://${ip}:${PORT}`; const p=' '.repeat(Math.max(0,46-u.length)); console.log(`║     ${u}${p}║`); });
    console.log('╚══════════════════════════════════════════════════╝\n');
  });
}

iniciar();
module.exports = app;
