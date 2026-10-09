const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '.data'));
const DB_FILE = path.join(DATA_DIR, 'db.json');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-this';
const IS_PROD = process.env.NODE_ENV === 'production';

function nowIso() { return new Date().toISOString(); }
function id() { return crypto.randomUUID(); }
function clean(s, max = 500) { return String(s ?? '').trim().slice(0, max); }
function num(v, fallback = null) { const n = Number(v); return Number.isFinite(n) ? n : fallback; }
function parseArray(v) {
  if (Array.isArray(v)) return v.map(x => clean(x, 80)).filter(Boolean);
  return clean(v || '', 800).split(',').map(x => x.trim()).filter(Boolean);
}
function normalize(s) { return clean(s, 1000).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); }
function safeUser(u) {
  if (!u) return null;
  const { passwordHash, ...rest } = u;
  return rest;
}
function avg(values) {
  const xs = values.filter(v => Number.isFinite(Number(v))).map(Number);
  return xs.length ? xs.reduce((a,b)=>a+b,0) / xs.length : 0;
}
function parseTime(t) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || ''));
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}
function toTime(m) { return `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`; }
function haversineKm(lat1, lon1, lat2, lon2) {
  const vals = [lat1,lon1,lat2,lon2].map(Number);
  if (vals.some(v => !Number.isFinite(v))) return null;
  const [a,b,c,d] = vals;
  const R = 6371;
  const rad = x => x * Math.PI / 180;
  const dLat = rad(c-a), dLon = rad(d-b);
  const x = Math.sin(dLat/2)**2 + Math.cos(rad(a))*Math.cos(rad(c))*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1-x));
}
function dateOnlyLocal(yyyyMmDd, hhmm) {
  const [y,m,d] = String(yyyyMmDd).split('-').map(Number);
  const mins = parseTime(hhmm);
  if (![y,m,d].every(Number.isFinite) || mins === null) return null;
  // O produto e o escopo são brasileiros. Fixamos o horário comercial em America/Sao_Paulo (UTC-03)
  // para que um agendamento de 09:00 continue aparecendo como 09:00 no Railway, que roda em UTC.
  return new Date(`${yyyyMmDd}T${toTime(mins)}:00-03:00`);
}
function hourSaoPaulo(value) {
  try { return Number(new Intl.DateTimeFormat('en-US',{hour:'2-digit',hour12:false,timeZone:'America/Sao_Paulo'}).format(new Date(value))); }
  catch { return new Date(value).getUTCHours(); }
}

class JsonStore {
  constructor(file) { this.file = file; this.data = null; this.queue = Promise.resolve(); }
  async init() {
    await fsp.mkdir(path.dirname(this.file), { recursive: true });
    await fsp.mkdir(UPLOAD_DIR, { recursive: true });
    try {
      this.data = JSON.parse(await fsp.readFile(this.file, 'utf8'));
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
      this.data = await createSeed();
      await this.persist();
    }
    this.ensureShape();
  }
  ensureShape() {
    const keys = ['users','shops','barbers','services','portfolio','appointments','reviews'];
    for (const k of keys) if (!Array.isArray(this.data[k])) this.data[k] = [];
    if (!this.data.meta) this.data.meta = { version: 1, createdAt: nowIso() };
  }
  async persist() {
    const tmp = `${this.file}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(this.data, null, 2), 'utf8');
    await fsp.rename(tmp, this.file);
  }
  async tx(fn) {
    const run = async () => {
      const out = await fn(this.data);
      await this.persist();
      return out;
    };
    this.queue = this.queue.then(run, run);
    return this.queue;
  }
}

async function createSeed() {
  const adminId = id(), clientId = id(), ownerId = id();
  const owner2Id = id();
  const shop1Id = id(), shop2Id = id(), shop3Id = id();
  const b1 = id(), b2 = id(), b3 = id(), b4 = id();
  const s1 = id(), s2 = id(), s3 = id(), s4 = id(), s5 = id(), s6 = id();
  const hash = await bcrypt.hash('demo123', 10);
  const users = [
    { id: adminId, name:'Admin Deu Régua', email:'admin@deuregua.app', passwordHash:hash, role:'admin', phone:'', active:true, createdAt:nowIso(), profile:{ lat:null,lng:null,locationName:'',favoriteShopIds:[],favoriteBarberIds:[],preferredCuts:[],preferredAmbience:[],priceMin:0,priceMax:120 } },
    { id: clientId, name:'Cliente Demo', email:'cliente@deuregua.app', passwordHash:hash, role:'customer', phone:'(31) 99999-1000', active:true, createdAt:nowIso(), profile:{ lat:-19.9245,lng:-43.9352,locationName:'Belo Horizonte, MG',favoriteShopIds:[shop1Id],favoriteBarberIds:[b1],preferredCuts:['Degradê','Freestyle'],preferredAmbience:['Moderno'],priceMin:0,priceMax:60 } },
    { id: ownerId, name:'Marcos Oliveira', email:'barbearia@deuregua.app', passwordHash:hash, role:'owner', phone:'(31) 98888-2000', active:true, createdAt:nowIso(), profile:{ favoriteShopIds:[],favoriteBarberIds:[],preferredCuts:[],preferredAmbience:[] } },
    { id: owner2Id, name:'Rafael Costa', email:'rafael@deuregua.app', passwordHash:hash, role:'owner', phone:'(31) 97777-3000', active:true, createdAt:nowIso(), profile:{ favoriteShopIds:[],favoriteBarberIds:[],preferredCuts:[],preferredAmbience:[] } }
  ];
  const shops = [
    { id:shop1Id, ownerId, name:'Régua 13 Barber', slug:'regua-13', description:'Barbearia moderna com foco em degradê, freestyle e acabamento premium.', address:'Rua dos Timbiras, 1450', city:'Belo Horizonte', state:'MG', zip:'30140-061', lat:-19.9270, lng:-43.9385, phone:'(31) 3333-1313', ambienceStyles:['Moderno','Street','Descontraído'], photo:'/assets/shop-1.svg', featured:true, plan:'professional', active:true, createdAt:nowIso(), updatedAt:nowIso() },
    { id:shop2Id, ownerId:owner2Id, name:'Clássico BH', slug:'classico-bh', description:'Experiência clássica, navalha, barba e cortes sociais em ambiente tranquilo.', address:'Av. Brasil, 760', city:'Belo Horizonte', state:'MG', zip:'30140-001', lat:-19.9293, lng:-43.9248, phone:'(31) 3333-2020', ambienceStyles:['Clássico','Tranquilo','Premium'], photo:'/assets/shop-2.svg', featured:false, plan:'basic', active:true, createdAt:nowIso(), updatedAt:nowIso() },
    { id:shop3Id, ownerId:null, name:'Barber Lab Savassi', slug:'barber-lab', description:'Cortes atuais, atendimento rápido e equipe especializada em tendências.', address:'Rua Pernambuco, 980', city:'Belo Horizonte', state:'MG', zip:'30130-151', lat:-19.9346, lng:-43.9321, phone:'(31) 3333-3030', ambienceStyles:['Moderno','Premium'], photo:'/assets/shop-3.svg', featured:true, plan:'freemium', active:true, createdAt:nowIso(), updatedAt:nowIso() }
  ];
  const defaultSchedule = { days:[1,2,3,4,5,6], start:'09:00', end:'19:00' };
  const barbers = [
    { id:b1, shopId:shop1Id, name:'João Martins', bio:'Especialista em degradê e freestyle, com foco em acabamento e desenho.', specialties:['Degradê','Freestyle','Americano'], photo:'/assets/barber-1.svg', schedule:defaultSchedule, active:true, createdAt:nowIso() },
    { id:b2, shopId:shop1Id, name:'Lucas Reis', bio:'Cortes sociais, barba e visagismo masculino.', specialties:['Social','Barba','Visagismo'], photo:'/assets/barber-2.svg', schedule:{ days:[2,3,4,5,6], start:'10:00', end:'20:00' }, active:true, createdAt:nowIso() },
    { id:b3, shopId:shop2Id, name:'André Lima', bio:'Barbearia tradicional com navalha e toalha quente.', specialties:['Social','Barba','Clássico'], photo:'/assets/barber-3.svg', schedule:{ days:[1,2,3,4,5,6], start:'08:30', end:'18:00' }, active:true, createdAt:nowIso() },
    { id:b4, shopId:shop3Id, name:'Caio Nunes', bio:'Tendências, degradê e corte infantil.', specialties:['Degradê','Infantil','Americano'], photo:'/assets/barber-4.svg', schedule:defaultSchedule, active:true, createdAt:nowIso() }
  ];
  const services = [
    { id:s1, shopId:shop1Id, name:'Corte Degradê', description:'Degradê completo com acabamento.', price:45, duration:45, styles:['Degradê','Americano'], active:true },
    { id:s2, shopId:shop1Id, name:'Corte + Barba', description:'Combo completo.', price:70, duration:75, styles:['Barba','Social'], active:true },
    { id:s3, shopId:shop2Id, name:'Corte Social', description:'Corte clássico com tesoura e máquina.', price:40, duration:40, styles:['Social','Clássico'], active:true },
    { id:s4, shopId:shop2Id, name:'Barba Premium', description:'Navalha, toalha quente e finalização.', price:35, duration:35, styles:['Barba'], active:true },
    { id:s5, shopId:shop3Id, name:'Freestyle', description:'Corte moderno com desenho.', price:55, duration:60, styles:['Freestyle','Degradê'], active:true },
    { id:s6, shopId:shop3Id, name:'Infantil', description:'Atendimento infantil.', price:35, duration:35, styles:['Infantil'], active:true }
  ];
  const portfolio = [
    { id:id(), shopId:shop1Id, barberId:b1, title:'Degradê baixo', imageUrl:'/assets/work-1.svg', styles:['Degradê'], createdAt:nowIso() },
    { id:id(), shopId:shop1Id, barberId:b1, title:'Freestyle clean', imageUrl:'/assets/work-2.svg', styles:['Freestyle'], createdAt:nowIso() },
    { id:id(), shopId:shop2Id, barberId:b3, title:'Social clássico', imageUrl:'/assets/work-3.svg', styles:['Social'], createdAt:nowIso() },
    { id:id(), shopId:shop3Id, barberId:b4, title:'Americano', imageUrl:'/assets/work-4.svg', styles:['Americano'], createdAt:nowIso() }
  ];
  const apptPast1 = id(), apptPast2 = id();
  const past1 = new Date(); past1.setDate(past1.getDate()-10); past1.setHours(14,0,0,0);
  const past2 = new Date(); past2.setDate(past2.getDate()-4); past2.setHours(16,0,0,0);
  const appointments = [
    { id:apptPast1,userId:clientId,shopId:shop1Id,barberId:b1,serviceId:s1,start:past1.toISOString(),end:new Date(past1.getTime()+45*60000).toISOString(),status:'completed',createdAt:new Date(past1.getTime()-3*86400000).toISOString() },
    { id:apptPast2,userId:clientId,shopId:shop2Id,barberId:b3,serviceId:s3,start:past2.toISOString(),end:new Date(past2.getTime()+40*60000).toISOString(),status:'completed',createdAt:new Date(past2.getTime()-2*86400000).toISOString() }
  ];
  const reviews = [
    { id:id(), appointmentId:apptPast1,userId:clientId,shopId:shop1Id,barberId:b1,rating:5,comment:'Ótimo degradê e atendimento no horário.',createdAt:new Date(past1.getTime()+3600000).toISOString() },
    { id:id(), appointmentId:apptPast2,userId:clientId,shopId:shop2Id,barberId:b3,rating:4,comment:'Ambiente muito tranquilo e bom corte.',createdAt:new Date(past2.getTime()+3600000).toISOString() },
    { id:id(), appointmentId:null,userId:clientId,shopId:shop3Id,barberId:b4,rating:5,comment:'Equipe muito boa e espaço moderno.',createdAt:new Date(Date.now()-20*86400000).toISOString(), seed:true }
  ];
  return { meta:{version:1,createdAt:nowIso()}, users, shops, barbers, services, portfolio, appointments, reviews };
}

const store = new JsonStore(DB_FILE);

function signToken(user) { return jwt.sign({ sub:user.id, role:user.role }, JWT_SECRET, { expiresIn:'14d' }); }
function setAuthCookie(res, token) {
  res.cookie('deu_regua_token', token, { httpOnly:true, sameSite:'lax', secure:IS_PROD, maxAge:14*24*60*60*1000 });
}
function optionalAuth(req,res,next) {
  const token = req.cookies?.deu_regua_token || (req.headers.authorization || '').replace(/^Bearer\s+/i,'');
  req.user = null;
  if (token) {
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      const user = store.data.users.find(u => u.id === payload.sub && u.active !== false);
      if (user) req.user = user;
    } catch (_) {}
  }
  next();
}
function requireAuth(...roles) {
  return (req,res,next) => {
    if (!req.user) return res.status(401).json({ error:'Faça login para continuar.' });
    if (roles.length && !roles.includes(req.user.role)) return res.status(403).json({ error:'Você não tem permissão para esta ação.' });
    next();
  };
}
function shopForOwner(ownerId) { return store.data.shops.find(s => s.ownerId === ownerId) || null; }
function enrichShop(shop, userLat=null, userLng=null) {
  const barbers = store.data.barbers.filter(b => b.shopId === shop.id && b.active !== false);
  const services = store.data.services.filter(s => s.shopId === shop.id && s.active !== false);
  const reviews = store.data.reviews.filter(r => r.shopId === shop.id);
  const rating = avg(reviews.map(r=>r.rating));
  const minPrice = services.length ? Math.min(...services.map(s=>Number(s.price)||0)) : 0;
  const maxPrice = services.length ? Math.max(...services.map(s=>Number(s.price)||0)) : 0;
  const distanceKm = haversineKm(userLat,userLng,shop.lat,shop.lng);
  return { ...shop, rating:Number(rating.toFixed(1)), reviewCount:reviews.length, minPrice, maxPrice, distanceKm:distanceKm == null ? null : Number(distanceKm.toFixed(1)), barberCount:barbers.length, serviceCount:services.length, barberNames:barbers.map(b=>b.name), specialties:[...new Set(barbers.flatMap(b=>b.specialties||[]))] };
}
function fullShop(shop, userLat=null, userLng=null) {
  const base = enrichShop(shop,userLat,userLng);
  const barbers = store.data.barbers.filter(b=>b.shopId===shop.id && b.active!==false).map(b => {
    const rr = store.data.reviews.filter(r=>r.barberId===b.id);
    return { ...b, rating:Number(avg(rr.map(r=>r.rating)).toFixed(1)), reviewCount:rr.length, portfolio:store.data.portfolio.filter(p=>p.barberId===b.id) };
  });
  const services = store.data.services.filter(s=>s.shopId===shop.id && s.active!==false);
  const portfolio = store.data.portfolio.filter(p=>p.shopId===shop.id);
  const reviews = store.data.reviews.filter(r=>r.shopId===shop.id).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)).map(r=>({ ...r, userName:store.data.users.find(u=>u.id===r.userId)?.name || 'Cliente', barberName:store.data.barbers.find(b=>b.id===r.barberId)?.name || null }));
  return { ...base, barbers, services, portfolio, reviews };
}
function getSlots({ barber, service, date }) {
  if (!barber || !service || !date) return [];
  const [y,m,d] = String(date).split('-').map(Number);
  if (![y,m,d].every(Number.isFinite)) return [];
  const day = new Date(Date.UTC(y,m-1,d)).getUTCDay();
  const schedule = barber.schedule || {};
  if (!(schedule.days || []).map(Number).includes(day)) return [];
  const startMin = parseTime(schedule.start), endMin = parseTime(schedule.end);
  if (startMin === null || endMin === null) return [];
  const duration = Math.max(15, Number(service.duration)||30);
  const existing = store.data.appointments.filter(a => a.barberId === barber.id && a.status !== 'cancelled' && String(a.start).slice(0,10) === date);
  const out = [];
  for (let m0=startMin; m0+duration<=endMin; m0+=30) {
    const hhmm = toTime(m0);
    const localStart = dateOnlyLocal(date, hhmm);
    if (!localStart || localStart.getTime() < Date.now() + 5*60000) continue;
    const localEnd = new Date(localStart.getTime()+duration*60000);
    const clashes = existing.some(a => new Date(a.start) < localEnd && new Date(a.end) > localStart);
    if (!clashes) out.push({ time:hhmm, start:localStart.toISOString(), end:localEnd.toISOString() });
  }
  return out;
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req,_file,cb)=>cb(null,UPLOAD_DIR),
    filename: (_req,file,cb)=> {
      const ext = path.extname(file.originalname || '').toLowerCase().replace(/[^.a-z0-9]/g,'').slice(0,8) || '.jpg';
      cb(null, `${Date.now()}-${crypto.randomUUID()}${ext}`);
    }
  }),
  limits:{ fileSize:5*1024*1024 },
  fileFilter:(_req,file,cb)=> file.mimetype.startsWith('image/') ? cb(null,true) : cb(new Error('Apenas imagens são permitidas.'))
});

app.disable('x-powered-by');
app.use(express.json({ limit:'1mb' }));
app.use(express.urlencoded({ extended:true }));
app.use(cookieParser());
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge:'1d' }));
app.use(optionalAuth);

app.get('/api/health', (_req,res)=>res.json({ ok:true, service:'deu-regua', time:nowIso() }));
app.get('/api/meta', (_req,res)=> {
  const cuts = [...new Set(store.data.services.flatMap(s=>s.styles||[]).concat(store.data.barbers.flatMap(b=>b.specialties||[])))].sort();
  const ambiences = [...new Set(store.data.shops.flatMap(s=>s.ambienceStyles||[]))].sort();
  res.json({ cuts, ambiences, plans:[
    {id:'freemium',name:'Freemium',price:0,description:'Cadastro gratuito + recursos essenciais.'},
    {id:'basic',name:'Básico',price:29.90,description:'Gestão de agenda e divulgação padronizada.'},
    {id:'professional',name:'Profissional',price:59.90,description:'Recursos avançados, relatórios e mais visibilidade.'}
  ], commissionModel:{ status:'a_decidir', example:'5% por agendamento (modelo previsto no escopo, sem cobrança real integrada).' } });
});

app.post('/api/auth/register', async (req,res) => {
  const name = clean(req.body.name,120), email = normalize(req.body.email), password = String(req.body.password||''), role = req.body.role === 'owner' ? 'owner' : 'customer';
  if (name.length < 2 || !email.includes('@') || password.length < 6) return res.status(400).json({ error:'Preencha nome, e-mail válido e senha com pelo menos 6 caracteres.' });
  if (store.data.users.some(u=>normalize(u.email)===email)) return res.status(409).json({ error:'Este e-mail já está cadastrado.' });
  const user = { id:id(), name, email, passwordHash:await bcrypt.hash(password,10), role, phone:clean(req.body.phone,30), active:true, createdAt:nowIso(), profile:{ lat:null,lng:null,locationName:'',favoriteShopIds:[],favoriteBarberIds:[],preferredCuts:[],preferredAmbience:[],priceMin:0,priceMax:100 } };
  await store.tx(db=>db.users.push(user));
  setAuthCookie(res, signToken(user));
  res.status(201).json({ user:safeUser(user) });
});
app.post('/api/auth/login', async (req,res) => {
  const email = normalize(req.body.email), password = String(req.body.password||'');
  const user = store.data.users.find(u=>normalize(u.email)===email);
  if (!user || user.active===false || !(await bcrypt.compare(password,user.passwordHash))) return res.status(401).json({ error:'E-mail ou senha inválidos.' });
  setAuthCookie(res, signToken(user));
  res.json({ user:safeUser(user) });
});
app.post('/api/auth/logout', (_req,res)=> { res.clearCookie('deu_regua_token'); res.json({ ok:true }); });
app.get('/api/auth/me', (req,res)=> res.json({ user:safeUser(req.user) }));

app.put('/api/profile', requireAuth('customer','owner','admin'), async (req,res) => {
  const target = store.data.users.find(u=>u.id===req.user.id);
  await store.tx(() => {
    target.name = clean(req.body.name || target.name,120);
    target.phone = clean(req.body.phone ?? target.phone,30);
    target.profile = target.profile || {};
    if (req.user.role === 'customer') {
      if (req.body.lat !== undefined) target.profile.lat = num(req.body.lat,null);
      if (req.body.lng !== undefined) target.profile.lng = num(req.body.lng,null);
      if (req.body.locationName !== undefined) target.profile.locationName = clean(req.body.locationName,160);
      if (req.body.preferredCuts !== undefined) target.profile.preferredCuts = parseArray(req.body.preferredCuts);
      if (req.body.preferredAmbience !== undefined) target.profile.preferredAmbience = parseArray(req.body.preferredAmbience);
      if (req.body.priceMin !== undefined) target.profile.priceMin = Math.max(0,num(req.body.priceMin,0));
      if (req.body.priceMax !== undefined) target.profile.priceMax = Math.max(0,num(req.body.priceMax,100));
    }
  });
  res.json({ user:safeUser(target) });
});

app.get('/api/search', (req,res) => {
  const q = normalize(req.query.q || '');
  const maxDistance = num(req.query.distance,null), maxPrice=num(req.query.price,null), minRating=num(req.query.rating,null);
  const serviceQ = normalize(req.query.service || ''), ambienceQ=normalize(req.query.ambience || '');
  const userLat = num(req.query.lat, req.user?.profile?.lat ?? null), userLng = num(req.query.lng, req.user?.profile?.lng ?? null);
  const sort = req.query.sort || 'match';
  let results = store.data.shops.filter(s=>s.active!==false).map(s=> {
    const e = enrichShop(s,userLat,userLng);
    const barbers = store.data.barbers.filter(b=>b.shopId===s.id && b.active!==false);
    const services = store.data.services.filter(x=>x.shopId===s.id && x.active!==false);
    const hay = normalize([s.name,s.description,s.city,s.address,...(s.ambienceStyles||[]),...barbers.flatMap(b=>[b.name,b.bio,...(b.specialties||[])]),...services.flatMap(x=>[x.name,...(x.styles||[])])].join(' '));
    const serviceHay = normalize(services.flatMap(x=>[x.name,...(x.styles||[])]).concat(barbers.flatMap(b=>b.specialties||[])).join(' '));
    const ambienceHay = normalize((s.ambienceStyles||[]).join(' '));
    let score = (s.featured?3:0) + e.rating;
    if (q && hay.includes(q)) score += 6;
    if (serviceQ && serviceHay.includes(serviceQ)) score += 5;
    if (ambienceQ && ambienceHay.includes(ambienceQ)) score += 4;
    if (req.user?.role==='customer') {
      const p=req.user.profile||{};
      score += (p.preferredCuts||[]).filter(x=>serviceHay.includes(normalize(x))).length*1.2;
      score += (p.preferredAmbience||[]).filter(x=>ambienceHay.includes(normalize(x))).length*0.8;
    }
    return { ...e, score, matchedBarbers:barbers.filter(b=>!q || normalize([b.name,...(b.specialties||[])].join(' ')).includes(q)).map(b=>({id:b.id,name:b.name,specialties:b.specialties})) };
  }).filter(x => {
    if (q) {
      const detail = normalize([x.name,x.description,...x.barberNames,...x.specialties,...(x.ambienceStyles||[])].join(' '));
      const serviceNames = store.data.services.filter(s=>s.shopId===x.id).map(s=>`${s.name} ${(s.styles||[]).join(' ')}`).join(' ');
      if (!detail.includes(q) && !normalize(serviceNames).includes(q)) return false;
    }
    if (maxDistance != null && (x.distanceKm == null || x.distanceKm > maxDistance)) return false;
    if (maxPrice != null && x.minPrice > maxPrice) return false;
    if (minRating != null && x.rating < minRating) return false;
    if (serviceQ) {
      const h = normalize(store.data.services.filter(s=>s.shopId===x.id).flatMap(s=>[s.name,...(s.styles||[])]).concat(x.specialties).join(' '));
      if (!h.includes(serviceQ)) return false;
    }
    if (ambienceQ && !normalize((x.ambienceStyles||[]).join(' ')).includes(ambienceQ)) return false;
    return true;
  });
  const sorters = {
    rating:(a,b)=>b.rating-a.rating,
    distance:(a,b)=>(a.distanceKm??1e9)-(b.distanceKm??1e9),
    price:(a,b)=>a.minPrice-b.minPrice,
    match:(a,b)=>b.score-a.score || b.rating-a.rating
  };
  results.sort(sorters[sort] || sorters.match);
  res.json({ results, location:{lat:userLat,lng:userLng} });
});

app.get('/api/shops/:id', (req,res) => {
  const shop = store.data.shops.find(s=>s.id===req.params.id && s.active!==false);
  if (!shop) return res.status(404).json({ error:'Barbearia não encontrada.' });
  const lat=num(req.query.lat,req.user?.profile?.lat??null), lng=num(req.query.lng,req.user?.profile?.lng??null);
  res.json({ shop:fullShop(shop,lat,lng) });
});
app.get('/api/barbers/:id', (req,res) => {
  const barber = store.data.barbers.find(b=>b.id===req.params.id && b.active!==false);
  if (!barber) return res.status(404).json({ error:'Barbeiro não encontrado.' });
  const shop = store.data.shops.find(s=>s.id===barber.shopId && s.active!==false);
  if (!shop) return res.status(404).json({ error:'Barbearia indisponível.' });
  const reviews = store.data.reviews.filter(r=>r.barberId===barber.id).map(r=>({...r,userName:store.data.users.find(u=>u.id===r.userId)?.name||'Cliente'}));
  res.json({ barber:{...barber,rating:Number(avg(reviews.map(r=>r.rating)).toFixed(1)),reviewCount:reviews.length,portfolio:store.data.portfolio.filter(p=>p.barberId===barber.id),reviews,shop:enrichShop(shop)}, services:store.data.services.filter(s=>s.shopId===shop.id && s.active!==false) });
});
app.get('/api/shops/:id/slots', (req,res) => {
  const shop = store.data.shops.find(s=>s.id===req.params.id && s.active!==false);
  const barber = store.data.barbers.find(b=>b.id===req.query.barberId && b.shopId===shop?.id && b.active!==false);
  const service = store.data.services.find(s=>s.id===req.query.serviceId && s.shopId===shop?.id && s.active!==false);
  if (!shop || !barber || !service) return res.status(400).json({ error:'Barbearia, barbeiro ou serviço inválido.' });
  const date = clean(req.query.date,10);
  res.json({ slots:getSlots({barber,service,date}) });
});

app.post('/api/favorites/toggle', requireAuth('customer'), async (req,res) => {
  const type = req.body.type === 'barber' ? 'barber' : 'shop';
  const targetId = clean(req.body.id,80);
  if (type==='shop' && !store.data.shops.some(s=>s.id===targetId)) return res.status(404).json({ error:'Barbearia não encontrada.' });
  if (type==='barber' && !store.data.barbers.some(b=>b.id===targetId)) return res.status(404).json({ error:'Barbeiro não encontrado.' });
  let active;
  await store.tx(() => {
    req.user.profile = req.user.profile || {};
    const key = type==='shop' ? 'favoriteShopIds' : 'favoriteBarberIds';
    req.user.profile[key] = req.user.profile[key] || [];
    const i = req.user.profile[key].indexOf(targetId);
    if (i >= 0) { req.user.profile[key].splice(i,1); active=false; } else { req.user.profile[key].push(targetId); active=true; }
  });
  res.json({ active, user:safeUser(req.user) });
});

app.post('/api/appointments', requireAuth('customer'), async (req,res) => {
  const shop = store.data.shops.find(s=>s.id===req.body.shopId && s.active!==false);
  const barber = store.data.barbers.find(b=>b.id===req.body.barberId && b.shopId===shop?.id && b.active!==false);
  const service = store.data.services.find(s=>s.id===req.body.serviceId && s.shopId===shop?.id && s.active!==false);
  const date = clean(req.body.date,10), time=clean(req.body.time,5);
  if (!shop || !barber || !service) return res.status(400).json({ error:'Dados do agendamento inválidos.' });
  const slots = getSlots({barber,service,date});
  const slot = slots.find(s=>s.time===time);
  if (!slot) return res.status(409).json({ error:'Este horário não está mais disponível.' });
  const appointment = { id:id(),userId:req.user.id,shopId:shop.id,barberId:barber.id,serviceId:service.id,start:slot.start,end:slot.end,status:'pending',createdAt:nowIso() };
  await store.tx(db=>db.appointments.push(appointment));
  res.status(201).json({ appointment });
});
app.get('/api/appointments/mine', requireAuth('customer'), (req,res) => {
  const items = store.data.appointments.filter(a=>a.userId===req.user.id).sort((a,b)=>new Date(b.start)-new Date(a.start)).map(a=>({
    ...a,
    shop:store.data.shops.find(s=>s.id===a.shopId), barber:store.data.barbers.find(b=>b.id===a.barberId), service:store.data.services.find(s=>s.id===a.serviceId),
    review:store.data.reviews.find(r=>r.appointmentId===a.id)||null
  }));
  res.json({ appointments:items });
});
app.patch('/api/appointments/:id/cancel', requireAuth('customer'), async (req,res) => {
  const a=store.data.appointments.find(x=>x.id===req.params.id && x.userId===req.user.id);
  if (!a) return res.status(404).json({ error:'Agendamento não encontrado.' });
  if (!['pending','confirmed'].includes(a.status)) return res.status(400).json({ error:'Este agendamento não pode ser cancelado.' });
  if (new Date(a.start) <= new Date()) return res.status(400).json({ error:'Não é possível cancelar um horário já iniciado.' });
  await store.tx(()=>{a.status='cancelled';a.cancelledAt=nowIso();});
  res.json({ appointment:a });
});
app.post('/api/reviews', requireAuth('customer'), async (req,res) => {
  const appointment=store.data.appointments.find(a=>a.id===req.body.appointmentId && a.userId===req.user.id);
  if (!appointment || appointment.status!=='completed') return res.status(400).json({ error:'Só é possível avaliar atendimentos concluídos.' });
  if (store.data.reviews.some(r=>r.appointmentId===appointment.id)) return res.status(409).json({ error:'Este atendimento já foi avaliado.' });
  const rating=Math.round(num(req.body.rating,0));
  if (rating<1 || rating>5) return res.status(400).json({ error:'A nota deve ser de 1 a 5.' });
  const review={id:id(),appointmentId:appointment.id,userId:req.user.id,shopId:appointment.shopId,barberId:appointment.barberId,rating,comment:clean(req.body.comment,800),createdAt:nowIso()};
  await store.tx(db=>db.reviews.push(review));
  res.status(201).json({ review });
});

app.get('/api/owner/shop', requireAuth('owner'), (req,res) => {
  const shop=shopForOwner(req.user.id);
  res.json({ shop:shop?fullShop(shop):null });
});
app.post('/api/owner/shop', requireAuth('owner'), async (req,res) => {
  if (shopForOwner(req.user.id)) return res.status(409).json({ error:'Este usuário já possui uma barbearia.' });
  const name=clean(req.body.name,120), lat=num(req.body.lat,null), lng=num(req.body.lng,null);
  if (!name || lat===null || lng===null) return res.status(400).json({ error:'Informe nome, latitude e longitude do estabelecimento.' });
  const shop={id:id(),ownerId:req.user.id,name,slug:normalize(name).replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''),description:clean(req.body.description,1000),address:clean(req.body.address,180),city:clean(req.body.city,80),state:clean(req.body.state,2).toUpperCase(),zip:clean(req.body.zip,12),lat,lng,phone:clean(req.body.phone,30),ambienceStyles:parseArray(req.body.ambienceStyles),photo:'/assets/shop-default.svg',featured:false,plan:'freemium',active:true,createdAt:nowIso(),updatedAt:nowIso()};
  await store.tx(db=>db.shops.push(shop));
  res.status(201).json({shop});
});
app.put('/api/owner/shop', requireAuth('owner'), async (req,res) => {
  const shop=shopForOwner(req.user.id); if(!shop) return res.status(404).json({error:'Cadastre sua barbearia primeiro.'});
  await store.tx(()=>{
    for(const k of ['name','description','address','city','zip','phone']) if(req.body[k]!==undefined) shop[k]=clean(req.body[k], k==='description'?1000:180);
    if(req.body.state!==undefined) shop.state=clean(req.body.state,2).toUpperCase();
    if(req.body.lat!==undefined) shop.lat=num(req.body.lat,shop.lat); if(req.body.lng!==undefined) shop.lng=num(req.body.lng,shop.lng);
    if(req.body.ambienceStyles!==undefined) shop.ambienceStyles=parseArray(req.body.ambienceStyles);
    if(req.body.photo!==undefined) shop.photo=clean(req.body.photo,500)||shop.photo;
    shop.updatedAt=nowIso();
  });
  res.json({shop:fullShop(shop)});
});
app.post('/api/owner/shop-photo', requireAuth('owner'), upload.single('image'), async (req,res) => {
  const shop=shopForOwner(req.user.id); if(!shop) return res.status(404).json({error:'Cadastre sua barbearia primeiro.'});
  if(!req.file) return res.status(400).json({error:'Envie uma imagem.'});
  await store.tx(()=>{shop.photo=`/uploads/${req.file.filename}`;shop.updatedAt=nowIso();});
  res.json({url:shop.photo});
});

app.post('/api/owner/barbers', requireAuth('owner'), async (req,res) => {
  const shop=shopForOwner(req.user.id); if(!shop) return res.status(404).json({error:'Cadastre sua barbearia primeiro.'});
  const name=clean(req.body.name,120); if(!name) return res.status(400).json({error:'Informe o nome do barbeiro.'});
  const barber={id:id(),shopId:shop.id,name,bio:clean(req.body.bio,800),specialties:parseArray(req.body.specialties),photo:clean(req.body.photo,500)||'/assets/barber-default.svg',schedule:{days:(req.body.days||[1,2,3,4,5,6]).map?.(Number)||[1,2,3,4,5,6],start:clean(req.body.start||'09:00',5),end:clean(req.body.end||'19:00',5)},active:true,createdAt:nowIso()};
  await store.tx(db=>db.barbers.push(barber)); res.status(201).json({barber});
});
app.put('/api/owner/barbers/:id', requireAuth('owner'), async (req,res) => {
  const shop=shopForOwner(req.user.id), barber=store.data.barbers.find(b=>b.id===req.params.id&&b.shopId===shop?.id); if(!barber)return res.status(404).json({error:'Barbeiro não encontrado.'});
  await store.tx(()=>{
    for(const k of ['name','bio','photo']) if(req.body[k]!==undefined) barber[k]=clean(req.body[k],k==='bio'?800:500);
    if(req.body.specialties!==undefined) barber.specialties=parseArray(req.body.specialties);
    barber.schedule=barber.schedule||{};
    if(req.body.days!==undefined) barber.schedule.days=(Array.isArray(req.body.days)?req.body.days:parseArray(req.body.days)).map(Number).filter(n=>n>=0&&n<=6);
    if(req.body.start!==undefined) barber.schedule.start=clean(req.body.start,5); if(req.body.end!==undefined) barber.schedule.end=clean(req.body.end,5);
    if(req.body.active!==undefined) barber.active=Boolean(req.body.active);
  });
  res.json({barber});
});
app.delete('/api/owner/barbers/:id', requireAuth('owner'), async (req,res) => {
  const shop=shopForOwner(req.user.id), barber=store.data.barbers.find(b=>b.id===req.params.id&&b.shopId===shop?.id); if(!barber)return res.status(404).json({error:'Barbeiro não encontrado.'});
  const hasFuture=store.data.appointments.some(a=>a.barberId===barber.id&&['pending','confirmed'].includes(a.status)&&new Date(a.start)>new Date());
  if(hasFuture) return res.status(409).json({error:'Há agendamentos futuros. Desative o barbeiro em vez de excluí-lo.'});
  await store.tx(db=>{db.barbers=db.barbers.filter(b=>b.id!==barber.id);db.portfolio=db.portfolio.filter(p=>p.barberId!==barber.id);}); res.json({ok:true});
});

app.post('/api/owner/services', requireAuth('owner'), async (req,res) => {
  const shop=shopForOwner(req.user.id); if(!shop)return res.status(404).json({error:'Cadastre sua barbearia primeiro.'});
  const name=clean(req.body.name,120),price=num(req.body.price,null),duration=Math.round(num(req.body.duration,30)); if(!name||price===null||price<0)return res.status(400).json({error:'Informe serviço e preço válidos.'});
  const service={id:id(),shopId:shop.id,name,description:clean(req.body.description,600),price,duration:Math.max(15,duration),styles:parseArray(req.body.styles),active:true};
  await store.tx(db=>db.services.push(service));res.status(201).json({service});
});
app.put('/api/owner/services/:id', requireAuth('owner'), async (req,res) => {
  const shop=shopForOwner(req.user.id), service=store.data.services.find(s=>s.id===req.params.id&&s.shopId===shop?.id);if(!service)return res.status(404).json({error:'Serviço não encontrado.'});
  await store.tx(()=>{
    for(const k of ['name','description']) if(req.body[k]!==undefined) service[k]=clean(req.body[k],k==='description'?600:120);
    if(req.body.price!==undefined) service.price=Math.max(0,num(req.body.price,service.price)); if(req.body.duration!==undefined) service.duration=Math.max(15,Math.round(num(req.body.duration,service.duration)));
    if(req.body.styles!==undefined) service.styles=parseArray(req.body.styles); if(req.body.active!==undefined) service.active=Boolean(req.body.active);
  });res.json({service});
});
app.delete('/api/owner/services/:id', requireAuth('owner'), async (req,res) => {
  const shop=shopForOwner(req.user.id), service=store.data.services.find(s=>s.id===req.params.id&&s.shopId===shop?.id);if(!service)return res.status(404).json({error:'Serviço não encontrado.'});
  const hasFuture=store.data.appointments.some(a=>a.serviceId===service.id&&['pending','confirmed'].includes(a.status)&&new Date(a.start)>new Date());
  if(hasFuture)return res.status(409).json({error:'Há agendamentos futuros. Desative o serviço em vez de excluí-lo.'});
  await store.tx(db=>{db.services=db.services.filter(s=>s.id!==service.id);});res.json({ok:true});
});
app.post('/api/owner/portfolio', requireAuth('owner'), upload.single('image'), async (req,res) => {
  const shop=shopForOwner(req.user.id);if(!shop)return res.status(404).json({error:'Cadastre sua barbearia primeiro.'});
  const barber=store.data.barbers.find(b=>b.id===req.body.barberId&&b.shopId===shop.id);if(!barber)return res.status(400).json({error:'Selecione um barbeiro válido.'});
  const imageUrl=req.file?`/uploads/${req.file.filename}`:clean(req.body.imageUrl,500);if(!imageUrl)return res.status(400).json({error:'Envie uma imagem ou informe uma URL.'});
  const item={id:id(),shopId:shop.id,barberId:barber.id,title:clean(req.body.title,120)||'Trabalho',imageUrl,styles:parseArray(req.body.styles),createdAt:nowIso()};
  await store.tx(db=>db.portfolio.push(item));res.status(201).json({item});
});
app.delete('/api/owner/portfolio/:id', requireAuth('owner'), async (req,res) => {
  const shop=shopForOwner(req.user.id), item=store.data.portfolio.find(p=>p.id===req.params.id&&p.shopId===shop?.id);if(!item)return res.status(404).json({error:'Foto não encontrada.'});
  await store.tx(db=>{db.portfolio=db.portfolio.filter(p=>p.id!==item.id);});res.json({ok:true});
});
app.get('/api/owner/appointments', requireAuth('owner'), (req,res) => {
  const shop=shopForOwner(req.user.id);if(!shop)return res.json({appointments:[]});
  const items=store.data.appointments.filter(a=>a.shopId===shop.id).sort((a,b)=>new Date(b.start)-new Date(a.start)).map(a=>({...a,client:safeUser(store.data.users.find(u=>u.id===a.userId)),barber:store.data.barbers.find(b=>b.id===a.barberId),service:store.data.services.find(s=>s.id===a.serviceId)}));
  res.json({appointments:items});
});
app.patch('/api/owner/appointments/:id/status', requireAuth('owner'), async (req,res) => {
  const shop=shopForOwner(req.user.id), a=store.data.appointments.find(a=>a.id===req.params.id&&a.shopId===shop?.id);if(!a)return res.status(404).json({error:'Agendamento não encontrado.'});
  const status=clean(req.body.status,20);if(!['pending','confirmed','completed','cancelled'].includes(status))return res.status(400).json({error:'Status inválido.'});
  await store.tx(()=>{a.status=status;a.updatedAt=nowIso();});res.json({appointment:a});
});
app.get('/api/owner/reports', requireAuth('owner'), (req,res) => {
  const shop=shopForOwner(req.user.id);if(!shop)return res.json({report:null});
  const appts=store.data.appointments.filter(a=>a.shopId===shop.id && a.status!=='cancelled');
  const completed=appts.filter(a=>a.status==='completed');
  const reviews=store.data.reviews.filter(r=>r.shopId===shop.id);
  const serviceCount={}; for(const a of completed)serviceCount[a.serviceId]=(serviceCount[a.serviceId]||0)+1;
  const barberCount={}; for(const a of completed)barberCount[a.barberId]=(barberCount[a.barberId]||0)+1;
  const hourCount={}; for(const a of appts){const h=hourSaoPaulo(a.start);hourCount[h]=(hourCount[h]||0)+1;}
  const clientFirst={}; for(const a of completed){if(!clientFirst[a.userId]||new Date(a.start)<new Date(clientFirst[a.userId]))clientFirst[a.userId]=a.start;}
  const monthStart=new Date();monthStart.setDate(1);monthStart.setHours(0,0,0,0);
  const report={
    totalAppointments:appts.length, completedAppointments:completed.length, avgRating:Number(avg(reviews.map(r=>r.rating)).toFixed(1)), newClients:Object.values(clientFirst).filter(d=>new Date(d)>=monthStart).length,
    topServices:Object.entries(serviceCount).map(([serviceId,count])=>({name:store.data.services.find(s=>s.id===serviceId)?.name||'Serviço removido',count})).sort((a,b)=>b.count-a.count).slice(0,5),
    busyHours:Object.entries(hourCount).map(([hour,count])=>({hour:`${String(hour).padStart(2,'0')}:00`,count})).sort((a,b)=>b.count-a.count).slice(0,5),
    topBarbers:Object.entries(barberCount).map(([barberId,count])=>({name:store.data.barbers.find(b=>b.id===barberId)?.name||'Barbeiro removido',count})).sort((a,b)=>b.count-a.count).slice(0,5)
  };
  res.json({report});
});
app.put('/api/owner/plan', requireAuth('owner'), async (req,res) => {
  const shop=shopForOwner(req.user.id);if(!shop)return res.status(404).json({error:'Cadastre sua barbearia primeiro.'});
  const plan=clean(req.body.plan,20);if(!['freemium','basic','professional'].includes(plan))return res.status(400).json({error:'Plano inválido.'});
  await store.tx(()=>{shop.plan=plan;shop.updatedAt=nowIso();});res.json({shop});
});

app.get('/api/admin/overview', requireAuth('admin'), (req,res)=>res.json({ overview:{ users:store.data.users.length,customers:store.data.users.filter(u=>u.role==='customer').length,owners:store.data.users.filter(u=>u.role==='owner').length,shops:store.data.shops.length,activeShops:store.data.shops.filter(s=>s.active!==false).length,appointments:store.data.appointments.length,reviews:store.data.reviews.length } }));
app.get('/api/admin/users', requireAuth('admin'), (_req,res)=>res.json({users:store.data.users.map(safeUser)}));
app.patch('/api/admin/users/:id', requireAuth('admin'), async (req,res)=>{
  const u=store.data.users.find(u=>u.id===req.params.id);if(!u)return res.status(404).json({error:'Usuário não encontrado.'});
  if(u.id===req.user.id && req.body.active===false)return res.status(400).json({error:'Você não pode suspender sua própria conta.'});
  await store.tx(()=>{if(req.body.active!==undefined)u.active=Boolean(req.body.active);});res.json({user:safeUser(u)});
});
app.get('/api/admin/shops', requireAuth('admin'), (_req,res)=>res.json({shops:store.data.shops.map(s=>enrichShop(s))}));
app.patch('/api/admin/shops/:id', requireAuth('admin'), async (req,res)=>{
  const s=store.data.shops.find(s=>s.id===req.params.id);if(!s)return res.status(404).json({error:'Barbearia não encontrada.'});
  await store.tx(()=>{if(req.body.active!==undefined)s.active=Boolean(req.body.active);if(req.body.featured!==undefined)s.featured=Boolean(req.body.featured);s.updatedAt=nowIso();});res.json({shop:enrichShop(s)});
});
app.get('/api/admin/appointments', requireAuth('admin'), (_req,res)=>{
  const appointments=store.data.appointments.slice().sort((a,b)=>new Date(b.start)-new Date(a.start)).map(a=>({...a,client:safeUser(store.data.users.find(u=>u.id===a.userId)),shop:store.data.shops.find(s=>s.id===a.shopId),barber:store.data.barbers.find(b=>b.id===a.barberId),service:store.data.services.find(s=>s.id===a.serviceId)}));
  res.json({appointments});
});
app.patch('/api/admin/appointments/:id/status', requireAuth('admin'), async (req,res)=>{
  const a=store.data.appointments.find(a=>a.id===req.params.id);if(!a)return res.status(404).json({error:'Agendamento não encontrado.'});
  const status=clean(req.body.status,20);if(!['pending','confirmed','completed','cancelled'].includes(status))return res.status(400).json({error:'Status inválido.'});
  await store.tx(()=>{a.status=status;a.updatedAt=nowIso();});res.json({appointment:a});
});
app.get('/api/admin/reviews', requireAuth('admin'), (_req,res)=>{
  const reviews=store.data.reviews.slice().sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)).map(r=>({...r,userName:store.data.users.find(u=>u.id===r.userId)?.name||'Cliente',shopName:store.data.shops.find(s=>s.id===r.shopId)?.name||'Barbearia',barberName:store.data.barbers.find(b=>b.id===r.barberId)?.name||'Profissional'}));
  res.json({reviews});
});
app.delete('/api/admin/reviews/:id', requireAuth('admin'), async (req,res)=>{
  const review=store.data.reviews.find(r=>r.id===req.params.id);if(!review)return res.status(404).json({error:'Avaliação não encontrada.'});
  await store.tx(db=>{db.reviews=db.reviews.filter(r=>r.id!==review.id);});res.json({ok:true});
});

app.use(express.static(path.join(__dirname,'public'), { maxAge: IS_PROD ? '1h' : 0 }));
app.get('*', (_req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));

app.use((err,req,res,_next)=>{
  console.error(err);
  if (err instanceof multer.MulterError) return res.status(400).json({error:err.code==='LIMIT_FILE_SIZE'?'Imagem maior que 5 MB.':err.message});
  res.status(500).json({error:err.message==='Apenas imagens são permitidas.'?err.message:'Erro interno do servidor.'});
});

store.init().then(()=>app.listen(PORT,'0.0.0.0',()=>console.log(`Deu Régua rodando na porta ${PORT} | dados em ${DATA_DIR}`))).catch(err=>{console.error('Falha ao iniciar:',err);process.exit(1);});
