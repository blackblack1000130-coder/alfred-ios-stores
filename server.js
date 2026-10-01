const express=require("express");
const bcrypt=require("bcryptjs");
const multer=require("multer");
const path=require("path");
const fs=require("fs");
const crypto=require("crypto");
const Database=require("better-sqlite3");

const app=express();
const PORT=process.env.PORT||10000;
const DATA_ROOT=process.env.RAILWAY_VOLUME_MOUNT_PATH||path.join(__dirname,"data");
const DB_PATH=process.env.DB_PATH||path.join(DATA_ROOT,"store.db");
const ADMIN_EMAIL=process.env.ADMIN_EMAIL||"Blackblack1000130@gmail.com";
const ADMIN_PASSWORD=process.env.ADMIN_PASSWORD||"CAMBIAR_ESTA_CLAVE";
fs.mkdirSync(path.dirname(DB_PATH),{recursive:true});
const db=new Database(DB_PATH, { timeout: 10000 });
db.pragma("journal_mode=WAL");
db.pragma("foreign_keys=ON");
db.exec(`
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,balance INTEGER NOT NULL DEFAULT 0,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS products(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,category TEXT NOT NULL,price INTEGER NOT NULL,description TEXT DEFAULT '',image TEXT DEFAULT '',video TEXT DEFAULT '',mediafire_url TEXT DEFAULT '',active INTEGER DEFAULT 1,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS topups(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,amount INTEGER NOT NULL,receipt TEXT NOT NULL,status TEXT DEFAULT 'pending',created_at TEXT DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(user_id) REFERENCES users(id));
CREATE TABLE IF NOT EXISTS purchases(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,product_id INTEGER NOT NULL,price INTEGER NOT NULL,status TEXT DEFAULT 'pending_delivery',created_at TEXT DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(user_id) REFERENCES users(id),FOREIGN KEY(product_id) REFERENCES products(id));
CREATE TABLE IF NOT EXISTS balance_adjustments(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,amount INTEGER NOT NULL,note TEXT DEFAULT '',created_at TEXT DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(user_id) REFERENCES users(id));
CREATE TABLE IF NOT EXISTS compatibility_rules(id INTEGER PRIMARY KEY AUTOINCREMENT,label TEXT NOT NULL,min_version TEXT NOT NULL,max_version TEXT NOT NULL,compatible INTEGER NOT NULL DEFAULT 1,enabled INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS categories(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT UNIQUE NOT NULL,active INTEGER NOT NULL DEFAULT 1,sort_order INTEGER NOT NULL DEFAULT 0,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS payment_methods(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,account TEXT NOT NULL DEFAULT '',details TEXT DEFAULT '',active INTEGER NOT NULL DEFAULT 1,sort_order INTEGER NOT NULL DEFAULT 0,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS reseller_requests(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,email TEXT NOT NULL,password_hash TEXT NOT NULL,plan_months INTEGER NOT NULL,amount INTEGER NOT NULL,status TEXT DEFAULT 'pending',user_id INTEGER,created_at TEXT DEFAULT CURRENT_TIMESTAMP,reviewed_at TEXT);
CREATE TABLE IF NOT EXISTS reseller_files(id INTEGER PRIMARY KEY AUTOINCREMENT,reseller_id INTEGER NOT NULL,name TEXT NOT NULL,url TEXT NOT NULL,original_name TEXT DEFAULT '',product_id INTEGER,active INTEGER NOT NULL DEFAULT 1,created_at TEXT DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(reseller_id) REFERENCES users(id));
CREATE TABLE IF NOT EXISTS reseller_products(id INTEGER PRIMARY KEY AUTOINCREMENT,reseller_id INTEGER NOT NULL,name TEXT NOT NULL,category TEXT NOT NULL,price INTEGER NOT NULL,description TEXT DEFAULT '',file_id INTEGER,image TEXT DEFAULT '',active INTEGER NOT NULL DEFAULT 1,created_at TEXT DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(reseller_id) REFERENCES users(id),FOREIGN KEY(file_id) REFERENCES reseller_files(id));
CREATE TABLE IF NOT EXISTS reseller_purchases(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,reseller_id INTEGER NOT NULL,product_id INTEGER NOT NULL,price INTEGER NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(user_id) REFERENCES users(id),FOREIGN KEY(reseller_id) REFERENCES users(id),FOREIGN KEY(product_id) REFERENCES reseller_products(id));
`);

// Campos de entrega digital. Se agregan sin borrar datos existentes.
for (const [col, type] of [['mega_url',"TEXT DEFAULT ''"],['file_password',"TEXT DEFAULT ''"],['ipa_url',"TEXT DEFAULT ''"],['file_url',"TEXT DEFAULT ''"],['file_name',"TEXT DEFAULT ''"],['owner_user_id',"INTEGER DEFAULT NULL"]]) {
  const exists = db.prepare(`PRAGMA table_info(products)`).all().some(x => x.name === col);
  if (!exists) db.exec(`ALTER TABLE products ADD COLUMN ${col} ${type}`);
}
// Compatibilidad con bases de datos creadas por versiones anteriores.
{ const exists=db.prepare(`PRAGMA table_info(topups)`).all().some(x => x.name === 'receipt_mime'); if(!exists) db.exec(`ALTER TABLE topups ADD COLUMN receipt_mime TEXT DEFAULT ''`); }
{ const exists=db.prepare(`PRAGMA table_info(topups)`).all().some(x => x.name === 'payment_method_id'); if(!exists) db.exec(`ALTER TABLE topups ADD COLUMN payment_method_id INTEGER DEFAULT NULL`); }
{ const exists=db.prepare(`PRAGMA table_info(users)`).all().some(x => x.name === 'store_background'); if(!exists) db.exec(`ALTER TABLE users ADD COLUMN store_background TEXT DEFAULT ''`); }
for (const [col, type] of [['iphone_model',"TEXT DEFAULT ''"],['ios_version',"TEXT DEFAULT ''"],['role',"TEXT DEFAULT 'customer'"],['reseller_status',"TEXT DEFAULT ''"],['reseller_expires_at',"TEXT DEFAULT ''"],['reseller_slug',"TEXT DEFAULT ''"],['store_name',"TEXT DEFAULT ''"],['store_color',"TEXT DEFAULT '#f7c94b'"],['reseller_plan_months',"INTEGER DEFAULT 0"],['reseller_id',"INTEGER DEFAULT NULL"]]) {
  const exists = db.prepare(`PRAGMA table_info(users)`).all().some(x => x.name === col);
  if (!exists) db.exec(`ALTER TABLE users ADD COLUMN ${col} ${type}`);
}
// Campos adicionales para solicitudes de revendedor ligadas a una cuenta de cliente existente.
for (const [col, type] of [['user_id',"INTEGER DEFAULT NULL"],['receipt',"TEXT DEFAULT ''"],['receipt_mime',"TEXT DEFAULT ''"],['payment_method_id',"INTEGER DEFAULT NULL"]]) {
  const exists = db.prepare(`PRAGMA table_info(reseller_requests)`).all().some(x => x.name === col);
  if (!exists) db.exec(`ALTER TABLE reseller_requests ADD COLUMN ${col} ${type}`);
}
db.exec(`CREATE TABLE IF NOT EXISTS category_downloads(category TEXT PRIMARY KEY, ipa_url TEXT DEFAULT '', ipa_name TEXT DEFAULT '')`);
for (const c of ['Filza','3105','iMazing']) db.prepare("INSERT OR IGNORE INTO category_downloads(category) VALUES(?)").run(c);
const existingCategories=db.prepare("SELECT DISTINCT category FROM products WHERE trim(category)<>''").all().map(x=>String(x.category).trim());
const categorySeed=[...new Set(['Filza','3105','iMazing','Premium','Otros',...existingCategories])];
const insertCategory=db.prepare("INSERT OR IGNORE INTO categories(name,sort_order) VALUES(?,?)");
categorySeed.forEach((name,i)=>insertCategory.run(name,i));
if(db.prepare("SELECT COUNT(*) c FROM payment_methods").get().c===0){
 const pm=db.prepare("INSERT INTO payment_methods(name,account,details,sort_order) VALUES(?,?,?,?)");
 const legacyMethod=db.prepare("SELECT value FROM settings WHERE key='payment_method'").get()?.value || 'Banreservas';
 const legacyAccount=db.prepare("SELECT value FROM settings WHERE key='payment_account'").get()?.value || '9605206264';
 pm.run(legacyMethod,legacyAccount,'',0);
}
const compatCount=db.prepare('SELECT COUNT(*) c FROM compatibility_rules').get().c;
if(!compatCount){
 const ins=db.prepare('INSERT INTO compatibility_rules(label,min_version,max_version,compatible,enabled) VALUES(?,?,?,?,1)');
 db.transaction(()=>{
  ins.run('iOS 14.0.0 → 18.6.1','14.0.0','18.6.1',1);
  ins.run('iOS 18.7.1 → 18.7.10','18.7.1','18.7.10',0);
  ins.run('iOS 26.0.1 → 26.6.2','26.0.1','26.6.2',1);
  ins.run('iOS 27.0.0 beta 1 → beta 6','27.0.0 beta 1','27.0.0 beta 6',1);
 })();
}

const initial=[
["Sensibilidad Alto","Sensibilidades",45,"Ajuste de sensibilidad para iPhone."],
["Sensibilidad cuello","Sensibilidades",40,"Configuración de sensibilidad."],
["Sensibilidad pecho","Sensibilidades",50,"Configuración de sensibilidad."],
["Sensibilidad barriga","Sensibilidades",50,"Configuración de sensibilidad."],
["Sensibilidad mágica","Sensibilidades",50,"Configuración de sensibilidad."],
["Ver arma y personaje","Sensibilidades",15,"Configuración para ver arma y personaje."]
];
if(db.prepare("SELECT COUNT(*) c FROM products").get().c===0){
 const ins=db.prepare("INSERT INTO products(name,category,price,description) VALUES(?,?,?,?)");
 db.transaction(()=>initial.forEach(x=>ins.run(...x)))();
}


// Catálogo solicitado para la tienda pública.
// Mantiene las imágenes, videos y enlaces MediaFire existentes cuando un producto ya existe.
const catalog=[
  ["Sensi Alto (Dcl-BR)","Filza",40,"Sensibilidad disponible para todas las versiones iOS 14–27 excepto iOS 18.7.1–10."],
  ["Sensi cuello (Dcl-BR)","Filza",30,"Sensibilidad disponible para todas las versiones iOS 14–27 excepto iOS 18.7.1–10."],
  ["Sensi pecho (BR)","Filza",45,"Sensibilidad disponible para todas las versiones iOS 14–27 excepto iOS 18.7.1–10."],
  ["Sensi barriga (BR)","Filza",50,"Sensibilidad disponible para todas las versiones iOS 14–27 excepto iOS 18.7.1–10."],
  ["Sensibilidad mágica (BR)","Filza",50,"Sensibilidad disponible para todas las versiones iOS 14–27 excepto iOS 18.7.1–10."],
  ["HOLOGRAMA — Ver arma","Filza",15,"Ver arma · iOS 14/27."],
  ["HOLOGRAMA — Ver personajes","Filza",15,"Ver personajes · iOS 14/27."],
  ["HOLOGRAMA — Ver completo","Filza",20,"Ver completo · iOS 14/26.0.1."],
  ["Sensi Alto (Dcl-BR)","3105",40,"Sensibilidad disponible para todas las versiones iOS 14–27 excepto iOS 18.7.1–10."],
  ["Sensi cuello (Dcl-BR)","3105",30,"Sensibilidad disponible para todas las versiones iOS 14–27 excepto iOS 18.7.1–10."],
  ["Sensi pecho (BR)","3105",45,"Sensibilidad disponible para todas las versiones iOS 14–27 excepto iOS 18.7.1–10."],
  ["Sensi barriga (BR)","3105",50,"Sensibilidad disponible para todas las versiones iOS 14–27 excepto iOS 18.7.1–10."],
  ["Sensibilidad mágica (BR)","3105",50,"Sensibilidad disponible para todas las versiones iOS 14–27 excepto iOS 18.7.1–10."],
  ["HOLOGRAMA — Ver arma","3105",15,"Ver arma · iOS 14/27."],
  ["HOLOGRAMA — Ver personajes","3105",15,"Ver personajes · iOS 14/27."],
  ["HOLOGRAMA — Ver completo","3105",20,"Ver completo · iOS 14/26.0.1."],
  ["Ver arma y personaje","iMazing",15,"Ver arma y personaje · iOS 14/27."]
];
db.prepare("UPDATE products SET active=0 WHERE category='Sensibilidades'").run();
const findProduct=db.prepare("SELECT id FROM products WHERE name=? AND category=? LIMIT 1");
const insertProduct=db.prepare("INSERT INTO products(name,category,price,description,active) VALUES(?,?,?,?,1)");
db.transaction(()=>{
  for(const [name,category,price,description] of catalog){
    const existing=findProduct.get(name,category);
    if(!existing) insertProduct.run(name,category,price,description);
  }
})();

app.use(express.json());
app.use(express.urlencoded({extended:true}));
// Stateless authentication cookie: survives Render Free restarts/sleeping instances.
// The cookie is signed with SESSION_SECRET and does not store passwords.
const SESSION_SECRET=process.env.SESSION_SECRET||"CAMBIAR_SESSION_SECRET";
const COOKIE_NAME="alfred_auth";
function signAuth(payload){
 const body=Buffer.from(JSON.stringify(payload)).toString("base64url");
 const sig=crypto.createHmac("sha256",SESSION_SECRET).update(body).digest("base64url");
 return body+"."+sig;
}
function readAuth(req){
 const raw=(req.headers.cookie||"").split(";").map(x=>x.trim()).find(x=>x.startsWith(COOKIE_NAME+"="));
 if(!raw)return null;
 const token=decodeURIComponent(raw.slice(COOKIE_NAME.length+1));
 const [body,sig]=token.split(".");
 if(!body||!sig)return null;
 const expected=crypto.createHmac("sha256",SESSION_SECRET).update(body).digest("base64url");
 if(!crypto.timingSafeEqual(Buffer.from(sig),Buffer.from(expected)))return null;
 try{
   const payload=JSON.parse(Buffer.from(body,"base64url").toString("utf8"));
   if(!payload.exp||payload.exp<Date.now())return null;
   return payload;
 }catch(e){return null;}
}
function setAuth(res,payload){
 const token=signAuth(payload);
 const secure=process.env.NODE_ENV==="production"?"; Secure":"";
 res.setHeader("Set-Cookie",`${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${secure}`);
}
function clearAuth(res){res.setHeader("Set-Cookie",`${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);}
const UPLOAD_DIR=process.env.UPLOAD_DIR||path.join(DATA_ROOT,"uploads");
fs.mkdirSync(UPLOAD_DIR,{recursive:true});
const upload=multer({dest:UPLOAD_DIR,limits:{fileSize:50*1024*1024}});
app.use((req,res,next)=>{req.auth=readAuth(req);next();});
app.get("/tienda/:slug",(req,res)=>res.sendFile(path.join(__dirname,"public","reseller-store.html")));
app.get("/revendedor",(req,res)=>res.sendFile(path.join(__dirname,"public","reseller.html")));
app.get("/revendedor-panel",(req,res)=>res.sendFile(path.join(__dirname,"public","reseller.html")));
app.get("/revendedor-comprar",(req,res)=>res.sendFile(path.join(__dirname,"public","reseller-buy.html")));
app.use(express.static(path.join(__dirname,"public")));
app.use("/uploads",express.static(UPLOAD_DIR));

function user(req,res,next){if(!req.auth||!req.auth.userId)return res.status(401).json({error:"Debes iniciar sesión."});next();}
function admin(req,res,next){if(!req.auth||!req.auth.admin)return res.status(401).json({error:"Acceso de administrador requerido."});next();}
function reseller(req,res,next){
 if(!req.auth||!req.auth.userId)return res.status(401).json({error:"Debes iniciar sesión."});
 // El creador puede abrir el panel de cualquier revendedor desde su propio panel.
 // Solo se acepta esta vista cuando la sesión actual es realmente de administrador.
 const asId=Number(req.query?.admin_reseller||0);
 if(asId&&req.auth.admin){
   const target=db.prepare("SELECT id,role,reseller_status,reseller_expires_at FROM users WHERE id=?").get(asId);
   if(!target||target.role!=="reseller")return res.status(404).json({error:"Revendedor no encontrado."});
   req.auth.userId=target.id;
 }
 const u=db.prepare("SELECT id,role,reseller_status,reseller_expires_at FROM users WHERE id=?").get(req.auth.userId);
 if(!u||u.role!=="reseller")return res.status(403).json({error:"Cuenta de revendedor requerida."});
 if(u.reseller_status!=="active"||!u.reseller_expires_at||new Date(u.reseller_expires_at).getTime()<Date.now())return res.status(403).json({error:"Tu período de revendedor está vencido o suspendido."});
 next();
}


function versionParts(v){
 const raw=String(v||'').trim().toLowerCase();
 const m=raw.match(/(\d+)(?:\.(\d+))?(?:\.(\d+))?/); if(!m)return null;
 const nums=[Number(m[1]),Number(m[2]||0),Number(m[3]||0)];
 const bm=raw.match(/beta\s*(\d+)/); return {a:nums[0],b:nums[1],c:nums[2],beta:bm?Number(bm[1]):null};
}
function compareVersions(a,b){
 const x=versionParts(a),y=versionParts(b); if(!x||!y)return null;
 for(const k of ['a','b','c']){if(x[k]!==y[k])return x[k]-y[k];}
 if(x.beta!==null || y.beta!==null){ if(x.beta===null)return 1; if(y.beta===null)return -1; return x.beta-y.beta; }
 return 0;
}
function compatibilityFor(version){
 if(!version)return {known:false,compatible:null,message:'Indica tu versión exacta de iOS.'};
 const rules=db.prepare('SELECT * FROM compatibility_rules WHERE enabled=1 ORDER BY id').all();
 for(const r of rules){const lo=compareVersions(version,r.min_version),hi=compareVersions(version,r.max_version); if(lo!==null&&hi!==null&&lo>=0&&hi<=0)return {known:true,compatible:!!r.compatible,label:r.label};}
 return {known:false,compatible:null,message:'Esta versión no está configurada en el panel.'};
}

app.get("/api/health",(req,res)=>{try{db.prepare("SELECT 1").get();res.json({ok:true});}catch(e){console.error("HEALTH_ERROR",e);res.status(500).json({ok:false});}});

const DEFAULT_SETTINGS={
 payment_method:"Banreservas",payment_account:"9605206264",delivery_notice:"La entrega puede tardar de 1 a 2 horas.",
 compatibility_notice:"La compatibilidad se consulta según las reglas configuradas en el panel.",
 whatsapp_channel:"https://whatsapp.com/channel/0029VbB1aAQDp2Q5F3dUDH3S",
 whatsapp_support:"https://wa.me/message/YXZINHSERCDNP1"
};
for(const [k,v] of Object.entries(DEFAULT_SETTINGS)) db.prepare("INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)").run(k,v);
function getSettings(){const out={...DEFAULT_SETTINGS};for(const r of db.prepare("SELECT key,value FROM settings").all())out[r.key]=r.value;return out;}
app.get("/api/settings",(req,res)=>res.json(getSettings()));
app.post("/api/admin/settings",admin,(req,res)=>{
 const allowed=['payment_method','payment_account','delivery_notice','whatsapp_channel','whatsapp_support','main_background'];
 const up=db.prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value");
 for(const k of allowed){if(req.body&&req.body[k]!==undefined)up.run(k,String(req.body[k]).trim());}
 for(const k of Object.keys(req.body||{})){if(/^category_image_[A-Za-z0-9 _-]+$/.test(k)&&req.body[k]!==undefined)up.run(k,String(req.body[k]).trim());}
 res.json({ok:true,settings:getSettings()});
});

app.get('/api/categories',(req,res)=>res.json(db.prepare("SELECT id,name,active,sort_order FROM categories WHERE active=1 ORDER BY sort_order,id").all()));
app.post('/api/admin/categories',admin,(req,res)=>{
 const name=String(req.body.name||'').trim().replace(/\s+/g,' ');
 if(!name||name.length>50)return res.status(400).json({error:'Escribe un nombre de categoría válido.'});
 if(db.prepare("SELECT id FROM categories WHERE lower(name)=lower(?)").get(name))return res.status(409).json({error:'Esa categoría ya existe.'});
 const max=db.prepare("SELECT COALESCE(MAX(sort_order),0) m FROM categories").get().m;
 const x=db.prepare("INSERT INTO categories(name,sort_order) VALUES(?,?)").run(name,Number(max)+1);
 res.json({ok:true,id:x.lastInsertRowid,name});
});
app.post('/api/admin/categories/:id',admin,(req,res)=>{
 const id=Number(req.params.id),name=String(req.body.name||'').trim().replace(/\s+/g,' '),active=req.body.active===false?0:1;
 if(!id||!name)return res.status(400).json({error:'Datos inválidos.'});
 if(db.prepare("SELECT id FROM categories WHERE lower(name)=lower(?) AND id<>?").get(name,id))return res.status(409).json({error:'Esa categoría ya existe.'});
 db.prepare("UPDATE categories SET name=?,active=? WHERE id=?").run(name,active,id); res.json({ok:true});
});
app.get('/api/payment-methods',(req,res)=>res.json(db.prepare("SELECT id,name,account,details FROM payment_methods WHERE active=1 ORDER BY sort_order,id").all()));
app.post('/api/admin/payment-methods',admin,(req,res)=>{
 const name=String(req.body.name||'').trim(),account=String(req.body.account||'').trim(),details=String(req.body.details||'').trim();
 if(!name||!account)return res.status(400).json({error:'Nombre y cuenta/dato son obligatorios.'});
 const max=db.prepare("SELECT COALESCE(MAX(sort_order),0) m FROM payment_methods").get().m;
 const x=db.prepare("INSERT INTO payment_methods(name,account,details,sort_order) VALUES(?,?,?,?)").run(name,account,details,Number(max)+1); res.json({ok:true,id:x.lastInsertRowid});
});
app.post('/api/admin/payment-methods/:id',admin,(req,res)=>{
 const id=Number(req.params.id),name=String(req.body.name||'').trim(),account=String(req.body.account||'').trim(),details=String(req.body.details||'').trim(),active=req.body.active===false?0:1;
 if(!id||!name||!account)return res.status(400).json({error:'Nombre y cuenta/dato son obligatorios.'});
 db.prepare("UPDATE payment_methods SET name=?,account=?,details=?,active=? WHERE id=?").run(name,account,details,active,id); res.json({ok:true});
});
app.delete('/api/admin/payment-methods/:id',admin,(req,res)=>{const id=Number(req.params.id);if(!id)return res.status(400).json({error:'Método inválido.'});db.prepare("DELETE FROM payment_methods WHERE id=?").run(id);res.json({ok:true});});

// ===== SISTEMA DE REVENDEDORES =====
const RESELLER_PLANS={1:{months:1,amount:80},2:{months:2,amount:140},3:{months:3,amount:200}};
function slugify(v){return String(v||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,40)||'tienda';}
function uniqueSlug(base){let slug=slugify(base),i=2,trySlug=slug;while(db.prepare("SELECT id FROM users WHERE reseller_slug=?").get(trySlug))trySlug=slug+'-'+i++;return trySlug;}
function addMonths(base,months){const d=new Date(base);d.setMonth(d.getMonth()+Number(months||0));return d.toISOString();}
app.get('/api/reseller-plans',(req,res)=>res.json(Object.values(RESELLER_PLANS)));
app.post('/api/reseller/request',user,upload.single('receipt'),async(req,res)=>{try{
 const u=db.prepare("SELECT * FROM users WHERE id=?").get(req.auth.userId);
 if(!u)return res.status(401).json({error:'Debes iniciar sesión.'});
 if(u.role!=='customer')return res.status(400).json({error:'Esta cuenta ya tiene un estado especial de acceso.'});
 const plan=RESELLER_PLANS[Number(req.body?.plan)],paymentMethodId=Number(req.body?.payment_method_id)||null;
 if(!plan)return res.status(400).json({error:'Plan no válido.'});
 if(!req.file)return res.status(400).json({error:'Debes subir el comprobante de pago.'});
 const mime=String(req.file.mimetype||'');
 if(!(mime.startsWith('image/')||mime==='application/pdf')){try{fs.unlinkSync(req.file.path)}catch(e){}return res.status(400).json({error:'El comprobante debe ser una imagen o PDF.'});}
 if(paymentMethodId&&!db.prepare("SELECT id FROM payment_methods WHERE id=? AND active=1").get(paymentMethodId))return res.status(400).json({error:'Método de pago no válido.'});
 const pending=db.prepare("SELECT id FROM reseller_requests WHERE user_id=? AND status='pending'").get(u.id);
 if(pending){try{fs.unlinkSync(req.file.path)}catch(e){}return res.status(409).json({error:'Ya tienes una solicitud pendiente.'});}
 const ext=path.extname(req.file.originalname||'').toLowerCase()||'.jpg';
 const safe='reseller-payment-'+u.id+'-'+Date.now()+ext;
 const target=path.join(UPLOAD_DIR,safe);fs.renameSync(req.file.path,target);
 const x=db.prepare("INSERT INTO reseller_requests(name,email,password_hash,plan_months,amount,status,user_id,receipt,receipt_mime,payment_method_id) VALUES(?,?,?,?,?,'pending',?,?,?,?)").run(u.name,u.email,u.password_hash,plan.months,plan.amount,u.id,'/uploads/'+safe,mime,paymentMethodId);
 res.json({ok:true,id:x.lastInsertRowid,message:'Solicitud enviada. El administrador revisará el comprobante y activará tu tienda después de confirmar el pago.'});
}catch(e){if(req.file?.path){try{fs.unlinkSync(req.file.path)}catch(_){}}console.error('RESELLER_REQUEST_ERROR',e);res.status(500).json({error:'No se pudo enviar la solicitud.'})}});
app.get('/api/reseller/store/:slug',(req,res)=>{const u=db.prepare("SELECT id,name,store_name,store_color,store_background,reseller_status,reseller_expires_at,reseller_plan_months,reseller_slug FROM users WHERE reseller_slug=? AND role='reseller'").get(req.params.slug);if(!u)return res.status(404).json({error:'Tienda no encontrada.'});if(u.reseller_status!=='active'||!u.reseller_expires_at||new Date(u.reseller_expires_at).getTime()<Date.now())return res.status(403).json({error:'Esta tienda está temporalmente inactiva.'});res.json({id:u.id,name:u.name,store_name:u.store_name||u.name,store_color:u.store_color||'#f7c94b',store_background:u.store_background||'',expires_at:u.reseller_expires_at,slug:u.reseller_slug});});
app.get('/api/reseller/store/:slug/products',(req,res)=>{const u=db.prepare("SELECT id,reseller_status,reseller_expires_at FROM users WHERE reseller_slug=? AND role='reseller'").get(req.params.slug);if(!u)return res.status(404).json({error:'Tienda no encontrada.'});if(u.reseller_status!=='active'||!u.reseller_expires_at||new Date(u.reseller_expires_at).getTime()<Date.now())return res.status(403).json({error:'Esta tienda está temporalmente inactiva.'});res.json(db.prepare("SELECT id,name,category,price,description,image,created_at FROM reseller_products WHERE reseller_id=? AND active=1 ORDER BY id DESC").all(u.id));});
app.post('/api/reseller/settings',reseller,(req,res)=>{const name=String(req.body?.store_name||'').trim().slice(0,60),color=String(req.body?.store_color||'').trim(),background=String(req.body?.store_background||'').trim().slice(0,500);if(!name||!/^#[0-9a-fA-F]{6}$/.test(color))return res.status(400).json({error:'Nombre y color válidos son obligatorios.'});db.prepare("UPDATE users SET store_name=?,store_color=?,store_background=? WHERE id=?").run(name,color,background,req.auth.userId);res.json({ok:true,store_name:name,store_color:color,store_background:background});});
app.get('/api/reseller/me',reseller,(req,res)=>{const u=db.prepare("SELECT id,name,email,store_name,store_color,store_background,reseller_slug,reseller_status,reseller_expires_at,reseller_plan_months FROM users WHERE id=?").get(req.auth.userId);res.json(u);});
app.get('/api/reseller/products',reseller,(req,res)=>res.json(db.prepare("SELECT rp.*,rf.name file_name,rf.url file_url FROM reseller_products rp LEFT JOIN reseller_files rf ON rf.id=rp.file_id WHERE rp.reseller_id=? ORDER BY rp.id DESC").all(req.auth.userId)));
app.get('/api/reseller/customers',reseller,(req,res)=>{
 const rows=db.prepare(`SELECT u.id,u.name,u.email,u.balance,u.created_at,COUNT(rp.id) purchase_count,COALESCE(SUM(rp.price),0) total_spent,MAX(rp.created_at) last_purchase FROM users u LEFT JOIN reseller_purchases rp ON rp.user_id=u.id AND rp.reseller_id=? WHERE u.reseller_id=? OR EXISTS(SELECT 1 FROM reseller_purchases rx WHERE rx.user_id=u.id AND rx.reseller_id=?) GROUP BY u.id ORDER BY COALESCE(MAX(rp.created_at),u.created_at) DESC`).all(req.auth.userId,req.auth.userId,req.auth.userId);
 res.json(rows);
});
app.post('/api/reseller/customers/:id/balance',reseller,(req,res)=>{
 const customerId=Number(req.params.id);
 const mode=String(req.body?.mode||'add');
 const value=Number(req.body?.amount);
 const note=String(req.body?.note||'Ajuste manual del revendedor').trim().slice(0,200);
 if(!Number.isInteger(value)||value<0)return res.status(400).json({error:'El saldo debe ser un número entero mayor o igual a 0.'});
 const belongs=db.prepare(`SELECT u.id,u.balance,u.role FROM users u WHERE u.id=? AND u.role='customer' AND (u.reseller_id=? OR EXISTS(SELECT 1 FROM reseller_purchases rx WHERE rx.user_id=u.id AND rx.reseller_id=?))`).get(customerId,req.auth.userId,req.auth.userId);
 if(!belongs)return res.status(404).json({error:'Cliente no encontrado en tu tienda.'});
 if(mode!=='add'&&mode!=='set')return res.status(400).json({error:'Modo de saldo inválido.'});
 const delta=mode==='set'?value-Number(belongs.balance||0):value;
 db.transaction(()=>{
   if(mode==='set') db.prepare('UPDATE users SET balance=? WHERE id=?').run(value,customerId);
   else db.prepare('UPDATE users SET balance=balance+? WHERE id=?').run(value,customerId);
   if(delta!==0) db.prepare('INSERT INTO balance_adjustments(user_id,amount,note) VALUES(?,?,?)').run(customerId,delta,note||'Ajuste manual del revendedor');
 })();
 res.json({ok:true,balance:mode==='set'?value:Number(belongs.balance||0)+value});
});
app.get('/api/reseller/topups',reseller,(req,res)=>{
 const rid=req.auth.userId;
 res.json(db.prepare(`SELECT t.id,t.user_id,t.amount,t.receipt,t.receipt_mime,t.status,t.created_at,u.name,u.email,pm.name payment_method_name,pm.account payment_method_account FROM topups t JOIN users u ON u.id=t.user_id LEFT JOIN payment_methods pm ON pm.id=t.payment_method_id WHERE t.status='pending' AND (u.reseller_id=? OR EXISTS(SELECT 1 FROM reseller_purchases rp WHERE rp.user_id=u.id AND rp.reseller_id=?)) ORDER BY t.id DESC`).all(rid,rid));
});
app.post('/api/reseller/topup/:id/approve',reseller,(req,res)=>{
 const rid=req.auth.userId;
 const t=db.prepare(`SELECT t.*,u.reseller_id FROM topups t JOIN users u ON u.id=t.user_id WHERE t.id=? AND t.status='pending' AND (u.reseller_id=? OR EXISTS(SELECT 1 FROM reseller_purchases rp WHERE rp.user_id=u.id AND rp.reseller_id=?))`).get(req.params.id,rid,rid);
 if(!t)return res.status(404).json({error:'Recarga no encontrada o no pertenece a tu tienda.'});
 db.transaction(()=>{db.prepare('UPDATE users SET balance=balance+? WHERE id=?').run(t.amount,t.user_id);db.prepare("UPDATE topups SET status='approved' WHERE id=?").run(t.id);})();
 res.json({ok:true});
});
app.post('/api/reseller/topup/:id/reject',reseller,(req,res)=>{
 const rid=req.auth.userId;
 const t=db.prepare(`SELECT t.id FROM topups t JOIN users u ON u.id=t.user_id WHERE t.id=? AND t.status='pending' AND (u.reseller_id=? OR EXISTS(SELECT 1 FROM reseller_purchases rp WHERE rp.user_id=u.id AND rp.reseller_id=?))`).get(req.params.id,rid,rid);
 if(!t)return res.status(404).json({error:'Recarga no encontrada o no pertenece a tu tienda.'});
 db.prepare("UPDATE topups SET status='rejected' WHERE id=? AND status='pending'").run(t.id);
 res.json({ok:true});
});
app.get('/api/reseller/customers/:id/purchases',reseller,(req,res)=>{
 const customerId=Number(req.params.id);
 const belongs=db.prepare(`SELECT u.id FROM users u WHERE u.id=? AND (u.reseller_id=? OR EXISTS(SELECT 1 FROM reseller_purchases rx WHERE rx.user_id=u.id AND rx.reseller_id=?))`).get(customerId,req.auth.userId,req.auth.userId);
 if(!belongs)return res.status(404).json({error:'Cliente no encontrado.'});
 res.json(db.prepare(`SELECT rp.id,rp.price,rp.created_at,p.name product_name,p.category,rf.original_name file_name,rf.url file_url FROM reseller_purchases rp JOIN reseller_products p ON p.id=rp.product_id LEFT JOIN reseller_files rf ON rf.id=p.file_id WHERE rp.user_id=? AND rp.reseller_id=? ORDER BY rp.id DESC`).all(customerId,req.auth.userId));
});
app.get('/api/reseller/files',reseller,(req,res)=>res.json(db.prepare("SELECT rf.*,rp.name product_name FROM reseller_files rf LEFT JOIN reseller_products rp ON rp.file_id=rf.id WHERE rf.reseller_id=? ORDER BY rf.id DESC").all(req.auth.userId)));
app.get('/api/reseller/sales',reseller,(req,res)=>res.json(db.prepare(`SELECT rp.id,rp.price,rp.created_at,u.name client_name,u.email client_email,p.name product_name,p.category,rf.original_name file_name FROM reseller_purchases rp JOIN users u ON u.id=rp.user_id JOIN reseller_products p ON p.id=rp.product_id LEFT JOIN reseller_files rf ON rf.id=p.file_id WHERE rp.reseller_id=? ORDER BY rp.id DESC`).all(req.auth.userId)));
app.post('/api/reseller/upload-image',reseller,upload.single('file'),(req,res)=>{if(!req.file)return res.status(400).json({error:'No se recibió ninguna imagen.'});const mime=String(req.file.mimetype||'');if(!mime.startsWith('image/')){try{fs.unlinkSync(req.file.path)}catch(e){}return res.status(400).json({error:'Solo se permiten imágenes.'});}const ext=path.extname(req.file.originalname||'').toLowerCase()||'.jpg';const safe='reseller-img-'+req.auth.userId+'-'+Date.now()+ext;const target=path.join(UPLOAD_DIR,safe);fs.renameSync(req.file.path,target);res.json({ok:true,url:'/uploads/'+safe,name:req.file.originalname||safe});});
app.post('/api/reseller/upload-file',reseller,upload.single('file'),(req,res)=>{if(!req.file)return res.status(400).json({error:'No se recibió ningún archivo.'});const ext=path.extname(req.file.originalname||'').toLowerCase(),allowed=['.ipa','.zip','.rar','.7z','.pdf','.dmg'];if(!allowed.includes(ext)){try{fs.unlinkSync(req.file.path)}catch(e){}return res.status(400).json({error:'Tipo de archivo no permitido.'});}const original=path.basename(req.file.originalname||('archivo'+ext)),safe=original.replace(/[^a-zA-Z0-9._ -]/g,'_').replace(/\\s+/g,' ').trim()||('archivo'+ext);let target=path.join(UPLOAD_DIR,'reseller-'+req.auth.userId+'-'+safe);if(fs.existsSync(target))target=path.join(UPLOAD_DIR,'reseller-'+req.auth.userId+'-'+Date.now()+'-'+safe);fs.renameSync(req.file.path,target);const x=db.prepare("INSERT INTO reseller_files(reseller_id,name,url,original_name) VALUES(?,?,?,?)").run(req.auth.userId,path.basename(target),'/uploads/'+path.basename(target),original);res.json({ok:true,id:x.lastInsertRowid,url:'/uploads/'+path.basename(target),name:original});});
app.post('/api/reseller/products',reseller,(req,res)=>{const name=String(req.body?.name||'').trim(),category=String(req.body?.category||'Otros').trim(),price=Number(req.body?.price),description=String(req.body?.description||'').trim(),fileId=Number(req.body?.file_id||0)||null,image=String(req.body?.image||'').trim().slice(0,500);if(!name||!Number.isInteger(price)||price<0)return res.status(400).json({error:'Datos de producto inválidos.'});if(fileId&&!db.prepare("SELECT id FROM reseller_files WHERE id=? AND reseller_id=?").get(fileId,req.auth.userId))return res.status(400).json({error:'Archivo no válido.'});const x=db.prepare("INSERT INTO reseller_products(reseller_id,name,category,price,description,file_id,image) VALUES(?,?,?,?,?,?,?)").run(req.auth.userId,name,category,price,description,fileId,image);res.json({ok:true,id:x.lastInsertRowid});});
app.post('/api/reseller/buy/:id',user,(req,res)=>{const rp=db.prepare("SELECT rp.*,u.reseller_status,u.reseller_expires_at FROM reseller_products rp JOIN users u ON u.id=rp.reseller_id WHERE rp.id=? AND rp.active=1").get(req.params.id);if(!rp)return res.status(404).json({error:'Producto no encontrado.'});if(rp.reseller_status!=='active'||!rp.reseller_expires_at||new Date(rp.reseller_expires_at).getTime()<Date.now())return res.status(403).json({error:'La tienda está vencida o suspendida.'});const u=db.prepare("SELECT id,balance,reseller_id,role FROM users WHERE id=?").get(req.auth.userId);if(u.role==='reseller')return res.status(403).json({error:'Una cuenta de revendedor no puede comprar productos desde otra tienda de revendedor.'});if(u.reseller_id&&Number(u.reseller_id)!==Number(rp.reseller_id))return res.status(403).json({error:'Esta cuenta pertenece a otra tienda de revendedor. No puedes comprar desde esta tienda.'});if(u.balance<rp.price)return res.status(400).json({error:'Saldo insuficiente. Agrega saldo primero.'});db.transaction(()=>{db.prepare("UPDATE users SET balance=balance-? WHERE id=?").run(rp.price,u.id);db.prepare("INSERT INTO reseller_purchases(user_id,reseller_id,product_id,price) VALUES(?,?,?,?)").run(u.id,rp.reseller_id,rp.id,rp.price);if(!u.reseller_id)db.prepare("UPDATE users SET reseller_id=? WHERE id=?").run(rp.reseller_id,u.id);})();res.json({ok:true,message:'Compra realizada. El archivo ya está disponible.'});});
app.post('/api/reseller/products/:id',(req,res)=>{if(!req.auth?.userId)return res.status(401).json({error:'Debes iniciar sesión.'});const u=db.prepare("SELECT role,reseller_status,reseller_expires_at FROM users WHERE id=?").get(req.auth.userId);if(u?.role!=='reseller'||u.reseller_status!=='active'||!u.reseller_expires_at||new Date(u.reseller_expires_at).getTime()<Date.now())return res.status(403).json({error:'Tu período de revendedor está vencido o suspendido.'});const id=Number(req.params.id),name=String(req.body?.name||'').trim(),category=String(req.body?.category||'Otros').trim(),price=Number(req.body?.price),description=String(req.body?.description||'').trim(),fileId=Number(req.body?.file_id||0)||null,image=String(req.body?.image||'').trim().slice(0,500),active=req.body?.active===false?0:1;if(!name||!Number.isInteger(price)||price<0)return res.status(400).json({error:'Datos inválidos.'});if(fileId&&!db.prepare("SELECT id FROM reseller_files WHERE id=? AND reseller_id=?").get(fileId,req.auth.userId))return res.status(400).json({error:'Archivo no válido.'});const r=db.prepare("UPDATE reseller_products SET name=?,category=?,price=?,description=?,file_id=?,image=?,active=? WHERE id=? AND reseller_id=?").run(name,category,price,description,fileId,image,active,id,req.auth.userId);if(!r.changes)return res.status(404).json({error:'Producto no encontrado.'});res.json({ok:true});});

app.get("/api/products",(req,res)=>{
 const c=req.query.category;
 const rows=c&&c!=="Todas"?db.prepare("SELECT * FROM products WHERE active=1 AND lower(trim(category))=lower(trim(?)) ORDER BY id DESC").all(c):db.prepare("SELECT * FROM products WHERE active=1 ORDER BY id DESC").all();
 res.json(rows);
});
app.post("/api/register",async(req,res)=>{
 try{
   const name=String(req.body?.name||'').trim();
   const email=String(req.body?.email||'').trim().toLowerCase();
   const password=String(req.body?.password||'');
   const resellerSlug=String(req.body?.reseller_slug||'').trim();
   if(name.length<2)return res.status(400).json({error:"Escribe tu nombre."});
   if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return res.status(400).json({error:"Escribe un correo válido."});
   if(password.length<8)return res.status(400).json({error:"La contraseña debe tener 8 caracteres o más."});
   const existing=db.prepare("SELECT id FROM users WHERE lower(email)=lower(?) LIMIT 1").get(email);
   if(existing)return res.status(409).json({error:"Ese correo ya está registrado. Inicia sesión o usa otro correo."});
   const h=await bcrypt.hash(password,12);
   let x;
   try{
     const owner=resellerSlug?db.prepare("SELECT id FROM users WHERE reseller_slug=? AND role='reseller' AND reseller_status='active' AND reseller_expires_at>?").get(resellerSlug,new Date().toISOString()):null;
     x=db.prepare("INSERT INTO users(name,email,password_hash,reseller_id) VALUES(?,?,?,?)").run(name,email,h,owner?.id||null);
   }catch(e){
     if(String(e.code||'').includes('SQLITE_CONSTRAINT')){
       return res.status(409).json({error:"Ese correo ya está registrado. Inicia sesión o usa otro correo."});
     }
     throw e;
   }
   setAuth(res,{userId:Number(x.lastInsertRowid),exp:Date.now()+31536000000});
   res.json({ok:true});
 }catch(e){
   console.error("REGISTER_ERROR",e);
   res.status(500).json({error:"No se pudo crear la cuenta en este momento. Revisa la conexión e inténtalo nuevamente."});
 }
});
app.post("/api/login",async(req,res)=>{
 const loginEmail=String(req.body?.email||"").trim().toLowerCase();
 const resellerSlug=String(req.body?.reseller_slug||"").trim();
 const u=db.prepare("SELECT * FROM users WHERE lower(email)=lower(?)").get(loginEmail);
 if(!u||!(await bcrypt.compare(req.body.password||"",u.password_hash)))return res.status(401).json({error:"Correo o contraseña incorrectos."});
 if(resellerSlug){
  const owner=db.prepare("SELECT id FROM users WHERE reseller_slug=? AND role='reseller' AND reseller_status='active' AND reseller_expires_at>?").get(resellerSlug,new Date().toISOString());
  if(!owner)return res.status(404).json({error:"Esta tienda de revendedor no está disponible."});
  if(u.role==='reseller'){
    if(Number(u.id)!==Number(owner.id))return res.status(403).json({error:"Esta cuenta de revendedor pertenece a otra tienda."});
  }else if(u.reseller_id){
    if(Number(u.reseller_id)!==Number(owner.id))return res.status(403).json({error:"Tu cuenta de cliente está vinculada a otra tienda de revendedor. No puedes iniciar sesión desde esta tienda."});
  }else{
    db.prepare("UPDATE users SET reseller_id=? WHERE id=?").run(owner.id,u.id);
  }
 }
 setAuth(res,{userId:u.id,exp:Date.now()+31536000000});res.json({ok:true});
});
app.post("/api/logout",(req,res)=>{clearAuth(res);res.json({ok:true});});
app.get("/api/me",user,(req,res)=>{
 const u=db.prepare("SELECT id,name,email,balance,iphone_model,ios_version,created_at,role,reseller_status,reseller_expires_at,reseller_slug,store_name,store_color,reseller_plan_months FROM users WHERE id=?").get(req.auth.userId);
 res.json({...u,compatibility:compatibilityFor(u.ios_version)});
});
app.get("/api/my-device",user,(req,res)=>res.json(db.prepare("SELECT iphone_model,ios_version FROM users WHERE id=?").get(req.auth.userId)));
app.post("/api/my-device",user,(req,res)=>{
 const model=String(req.body.iphone_model||'').trim(), version=String(req.body.ios_version||'').trim();
 if(!model||!version)return res.status(400).json({error:'Indica el modelo y la versión exacta de iOS.'});
 const compatibility=compatibilityFor(version);
 db.prepare('UPDATE users SET iphone_model=?,ios_version=? WHERE id=?').run(model,version,req.auth.userId);
 res.json({ok:true,iphone_model:model,ios_version:version,compatibility});
});
app.get("/api/compatibility",(req,res)=>res.json(db.prepare('SELECT * FROM compatibility_rules WHERE enabled=1 ORDER BY id').all()));
app.get("/api/my-products",user,(req,res)=>{
 const rows=db.prepare(`SELECT pu.id purchase_id,pu.status,pu.created_at purchased_at,p.id product_id,p.name,p.price,p.category,p.mediafire_url,p.mega_url,p.file_password,p.file_url,p.file_name,p.image,p.video,
 CASE WHEN pu.status='delivered' THEN (SELECT ipa_url FROM category_downloads cd WHERE cd.category=p.category) ELSE '' END AS ipa_url,
(SELECT ipa_name FROM category_downloads cd WHERE cd.category=p.category) AS ipa_name,'' AS reseller_store
 FROM purchases pu JOIN products p ON p.id=pu.product_id WHERE pu.user_id=?
 UNION ALL
 SELECT rp.id purchase_id,'delivered' status,rp.created_at purchased_at,rp.product_id product_id,p.name,p.price,p.category,'' mediafire_url,'' mega_url,'' file_password,rf.url file_url,rf.original_name file_name,'' image,'' video,'' ipa_url,'' ipa_name,r.store_name reseller_store
 FROM reseller_purchases rp JOIN reseller_products p ON p.id=rp.product_id JOIN users r ON r.id=rp.reseller_id LEFT JOIN reseller_files rf ON rf.id=p.file_id WHERE rp.user_id=?
 ORDER BY purchase_id DESC`).all(req.auth.userId,req.auth.userId);
 res.json(rows);
});
app.get("/api/my-topups",user,(req,res)=>res.json(db.prepare("SELECT t.id,t.amount,t.receipt,t.receipt_mime,t.status,t.created_at,t.payment_method_id,pm.name payment_method_name,pm.account payment_method_account FROM topups t LEFT JOIN payment_methods pm ON pm.id=t.payment_method_id WHERE t.user_id=? ORDER BY t.id DESC").all(req.auth.userId)));
app.post("/api/topup",user,upload.single("receipt"),(req,res)=>{
 const amount=Number(req.body.amount);
 if(!Number.isInteger(amount)||amount<1||!req.file)return res.status(400).json({error:"Indica un monto y sube el comprobante."});
 const ext=path.extname(req.file.originalname||"").toLowerCase();
 const safeBase=(path.basename(req.file.originalname||"comprobante",ext).replace(/[^a-zA-Z0-9._ -]/g,'_').replace(/\s+/g,' ').trim()||'comprobante');
 const finalName=`comprobante-${Date.now()}-${safeBase}${ext||''}`;
 const finalPath=path.join(UPLOAD_DIR,finalName);
 fs.renameSync(req.file.path,finalPath);
 const paymentMethodId=req.body.payment_method_id?Number(req.body.payment_method_id):null;
 const paymentExists=paymentMethodId?db.prepare("SELECT id FROM payment_methods WHERE id=? AND active=1").get(paymentMethodId):null;
 if(paymentMethodId&&!paymentExists)return res.status(400).json({error:"Método de pago no válido."});
 db.prepare("INSERT INTO topups(user_id,amount,receipt,receipt_mime,payment_method_id) VALUES(?,?,?,?,?)").run(req.auth.userId,amount,"/uploads/"+finalName,req.file.mimetype||"",paymentMethodId);
 res.json({ok:true,message:"Comprobante enviado. Queda pendiente de verificación."});
});
app.post("/api/buy",user,(req,res)=>{
 const p=db.prepare("SELECT * FROM products WHERE id=? AND active=1").get(Number(req.body.productId));
 if(!p)return res.status(404).json({error:"Producto no encontrado."});
 const u=db.prepare("SELECT balance FROM users WHERE id=?").get(req.auth.userId);
 if(u.balance<p.price)return res.status(400).json({error:"Saldo insuficiente. Agrega saldo primero."});
 db.transaction(()=>{
   db.prepare("UPDATE users SET balance=balance-? WHERE id=?").run(p.price,req.auth.userId);
   db.prepare("INSERT INTO purchases(user_id,product_id,price,status) VALUES(?,?,?,'delivered')").run(req.auth.userId,p.id,p.price);
 })();
 res.json({ok:true,message:"Compra realizada. Tus archivos ya están disponibles en tu cuenta.",delivered:true});
});

app.post("/api/buy-cart",user,(req,res)=>{
 const ids=Array.isArray(req.body.productIds)?req.body.productIds.map(Number).filter(Number.isInteger):[];
 if(!ids.length)return res.status(400).json({error:"El carrito está vacío."});
 const unique=[...new Set(ids)];
 const placeholders=unique.map(()=>'?').join(',');
 const products=db.prepare(`SELECT * FROM products WHERE active=1 AND id IN (${placeholders})`).all(...unique);
 if(products.length!==unique.length)return res.status(400).json({error:"Uno de los productos ya no está disponible."});
 const total=products.reduce((sum,x)=>sum+Number(x.price||0),0);
 const u=db.prepare("SELECT balance FROM users WHERE id=?").get(req.auth.userId);
 if(Number(u.balance||0)<total)return res.status(400).json({error:"Saldo insuficiente para completar todo el carrito."});
 db.transaction(()=>{
   db.prepare("UPDATE users SET balance=balance-? WHERE id=?").run(total,req.auth.userId);
   const add=db.prepare("INSERT INTO purchases(user_id,product_id,price,status) VALUES(?,?,?,'delivered')");
   for(const product of products)add.run(req.auth.userId,product.id,product.price);
 })();
 res.json({ok:true,message:"Compra realizada. Todos los archivos ya están disponibles en tu cuenta.",delivered:true,total,count:products.length});
});

app.post("/api/admin/login",(req,res)=>{
 if(req.body.email===ADMIN_EMAIL&&req.body.password===ADMIN_PASSWORD){setAuth(res,{admin:true,exp:Date.now()+31536000000});return res.json({ok:true});}
 res.status(401).json({error:"Credenciales incorrectas."});
});
app.post("/api/admin/logout",(req,res)=>{clearAuth(res);res.json({ok:true});});
app.get('/api/admin/resellers/:id/products',admin,(req,res)=>res.json(db.prepare(`SELECT rp.*,rf.original_name file_name,rf.url file_url FROM reseller_products rp LEFT JOIN reseller_files rf ON rf.id=rp.file_id WHERE rp.reseller_id=? ORDER BY rp.id DESC`).all(req.params.id)));
app.post('/api/admin/resellers/:id/products/:productId',admin,(req,res)=>{const id=Number(req.params.productId),rid=Number(req.params.id);const name=String(req.body?.name||'').trim(),category=String(req.body?.category||'Otros').trim(),price=Number(req.body?.price),description=String(req.body?.description||'').trim(),fileId=Number(req.body?.file_id||0)||null,image=String(req.body?.image||'').trim().slice(0,500),active=req.body?.active===false?0:1;if(!name||!Number.isInteger(price)||price<0)return res.status(400).json({error:'Datos de producto inválidos.'});if(fileId&&!db.prepare('SELECT id FROM reseller_files WHERE id=? AND reseller_id=?').get(fileId,rid))return res.status(400).json({error:'Archivo no válido.'});const r=db.prepare('UPDATE reseller_products SET name=?,category=?,price=?,description=?,file_id=?,image=?,active=? WHERE id=? AND reseller_id=?').run(name,category,price,description,fileId,image,active,id,rid);if(!r.changes)return res.status(404).json({error:'Producto no encontrado.'});res.json({ok:true});});
app.delete('/api/admin/resellers/:id/products/:productId',admin,(req,res)=>{const r=db.prepare('DELETE FROM reseller_products WHERE id=? AND reseller_id=?').run(req.params.productId,req.params.id);if(!r.changes)return res.status(404).json({error:'Producto no encontrado.'});res.json({ok:true});});
app.get('/api/admin/resellers/:id/customers',admin,(req,res)=>res.json(db.prepare(`SELECT u.id,u.name,u.email,u.balance,u.created_at,COUNT(rp.id) purchase_count,COALESCE(SUM(rp.price),0) total_spent FROM users u LEFT JOIN reseller_purchases rp ON rp.user_id=u.id AND rp.reseller_id=? WHERE u.reseller_id=? OR EXISTS(SELECT 1 FROM reseller_purchases rx WHERE rx.user_id=u.id AND rx.reseller_id=?) GROUP BY u.id ORDER BY u.id DESC`).all(req.params.id,req.params.id,req.params.id)));
app.post('/api/admin/resellers/:id/customers/:customerId/balance',admin,(req,res)=>{const rid=Number(req.params.id),cid=Number(req.params.customerId),mode=String(req.body?.mode||'add'),value=Number(req.body?.amount),note=String(req.body?.note||'Ajuste manual del creador a cliente de revendedor').trim().slice(0,200);if(!Number.isInteger(value)||value<0)return res.status(400).json({error:'El saldo debe ser un número entero mayor o igual a 0.'});const u=db.prepare(`SELECT u.id,u.balance FROM users u WHERE u.id=? AND u.role='customer' AND (u.reseller_id=? OR EXISTS(SELECT 1 FROM reseller_purchases rx WHERE rx.user_id=u.id AND rx.reseller_id=?))`).get(cid,rid,rid);if(!u)return res.status(404).json({error:'Cliente no encontrado en esta tienda.'});if(!['add','set'].includes(mode))return res.status(400).json({error:'Modo inválido.'});const delta=mode==='set'?value-Number(u.balance||0):value;db.transaction(()=>{if(mode==='set')db.prepare('UPDATE users SET balance=? WHERE id=?').run(value,cid);else db.prepare('UPDATE users SET balance=balance+? WHERE id=?').run(value,cid);if(delta)db.prepare('INSERT INTO balance_adjustments(user_id,amount,note) VALUES(?,?,?)').run(cid,delta,note);})();res.json({ok:true});});
app.get('/api/admin/resellers',admin,(req,res)=>res.json(db.prepare("SELECT id,name,email,store_name,store_color,store_background,reseller_slug,reseller_status,reseller_expires_at,reseller_plan_months,created_at FROM users WHERE role='reseller' ORDER BY id DESC").all()));
app.get('/api/admin/reseller-requests',admin,(req,res)=>res.json(db.prepare("SELECT id,name,email,plan_months,amount,status,created_at,reviewed_at FROM reseller_requests ORDER BY id DESC").all()));
function seedResellerCatalog(resellerId){
 const products=db.prepare("SELECT * FROM products WHERE active=1 ORDER BY id").all();
 const addFile=db.prepare("INSERT INTO reseller_files(reseller_id,name,url,original_name,product_id) VALUES(?,?,?,?,?)");
 const addProduct=db.prepare("INSERT INTO reseller_products(reseller_id,name,category,price,description,file_id,image,active) VALUES(?,?,?,?,?,?,?,1)");
 for(const p of products){
   let fileId=null;
   const source=String(p.file_url||p.mediafire_url||p.mega_url||p.ipa_url||'').trim();
   if(source){
     let url=source;
     const original=String(p.file_name||p.ipa_name||path.basename(source.split('?')[0])||p.name).trim()||p.name;
     if(source.startsWith('/uploads/')){
       const src=path.join(UPLOAD_DIR,path.basename(source));
       if(fs.existsSync(src)){
         const ext=path.extname(original||src)||path.extname(src)||'';
         const safe=('reseller-'+resellerId+'-'+Date.now()+'-'+path.basename(original||('archivo'+ext))).replace(/[^a-zA-Z0-9._-]/g,'_');
         const dest=path.join(UPLOAD_DIR,safe);fs.copyFileSync(src,dest);url='/uploads/'+safe;
       }
     }
     const f=addFile.run(resellerId,path.basename(url),url,original,null);fileId=f.lastInsertRowid;
   }
   const x=addProduct.run(resellerId,p.name,p.category,p.price,p.description||'',fileId,p.image||'');
   if(fileId)db.prepare("UPDATE reseller_files SET product_id=? WHERE id=?").run(x.lastInsertRowid,fileId);
 }
}
app.post('/api/admin/reseller-requests/:id/approve',admin,(req,res)=>{const q=db.prepare("SELECT * FROM reseller_requests WHERE id=? AND status='pending'").get(req.params.id);if(!q)return res.status(404).json({error:'Solicitud no encontrada.'});const u=db.prepare("SELECT * FROM users WHERE id=?").get(q.user_id);if(!u)return res.status(404).json({error:'La cuenta del cliente no existe.'});if(u.role!=='customer')return res.status(409).json({error:'La cuenta ya no es una cuenta de cliente.'});const slug=uniqueSlug(u.name),now=new Date(),expires=addMonths(now,q.plan_months);db.transaction(()=>{db.prepare("UPDATE users SET role='reseller',reseller_status='active',reseller_expires_at=?,reseller_slug=?,store_name='ALFRED IOS STORE',store_color='#f7c94b',reseller_plan_months=? WHERE id=?").run(expires,slug,q.plan_months,u.id);seedResellerCatalog(u.id);db.prepare("UPDATE reseller_requests SET status='approved',user_id=?,reviewed_at=CURRENT_TIMESTAMP WHERE id=?").run(u.id,q.id);})();res.json({ok:true,slug,expires});});
app.post('/api/admin/resellers/:id/renew',admin,(req,res)=>{const months=Number(req.body?.months);if(![1,2,3].includes(months))return res.status(400).json({error:'Solo se permiten 1, 2 o 3 meses.'});const u=db.prepare("SELECT * FROM users WHERE id=? AND role='reseller'").get(req.params.id);if(!u)return res.status(404).json({error:'Revendedor no encontrado.'});const base=u.reseller_expires_at&&new Date(u.reseller_expires_at).getTime()>Date.now()?u.reseller_expires_at:new Date().toISOString(),expires=addMonths(base,months);db.prepare("UPDATE users SET reseller_status='active',reseller_expires_at=?,reseller_plan_months=? WHERE id=?").run(expires,months,u.id);res.json({ok:true,expires});});
app.post('/api/admin/resellers/:id/status',admin,(req,res)=>{const status=['active','suspended'].includes(req.body?.status)?req.body.status:'suspended';const r=db.prepare("UPDATE users SET reseller_status=? WHERE id=? AND role='reseller'").run(status,req.params.id);if(!r.changes)return res.status(404).json({error:'Revendedor no encontrado.'});res.json({ok:true});});
app.post('/api/admin/resellers/:id/settings',admin,(req,res)=>{const name=String(req.body?.store_name||'').trim().slice(0,60),color=String(req.body?.store_color||'').trim(),background=String(req.body?.store_background||'').trim().slice(0,500);if(!name||!/^#[0-9a-fA-F]{6}$/.test(color))return res.status(400).json({error:'Datos inválidos.'});db.prepare("UPDATE users SET store_name=?,store_color=?,store_background=? WHERE id=? AND role='reseller'").run(name,color,background,req.params.id);res.json({ok:true});});
app.get('/api/admin/resellers/:id/files',admin,(req,res)=>res.json(db.prepare("SELECT rf.*,rp.name product_name FROM reseller_files rf LEFT JOIN reseller_products rp ON rp.file_id=rf.id WHERE rf.reseller_id=? ORDER BY rf.id DESC").all(req.params.id)));
app.post('/api/admin/resellers/:id/upload-file',admin,upload.single('file'),(req,res)=>{if(!req.file)return res.status(400).json({error:'No se recibió ningún archivo.'});const ext=path.extname(req.file.originalname||'').toLowerCase(),allowed=['.ipa','.zip','.rar','.7z','.pdf','.dmg'];if(!allowed.includes(ext)){try{fs.unlinkSync(req.file.path)}catch(e){}return res.status(400).json({error:'Tipo de archivo no permitido.'});}const original=path.basename(req.file.originalname||('archivo'+ext)),safe=original.replace(/[^a-zA-Z0-9._ -]/g,'_').replace(/\s+/g,' ').trim()||('archivo'+ext);let target=path.join(UPLOAD_DIR,'admin-reseller-'+req.params.id+'-'+safe);if(fs.existsSync(target))target=path.join(UPLOAD_DIR,'admin-reseller-'+req.params.id+'-'+Date.now()+'-'+safe);fs.renameSync(req.file.path,target);const x=db.prepare("INSERT INTO reseller_files(reseller_id,name,url,original_name) VALUES(?,?,?,?)").run(req.params.id,path.basename(target),'/uploads/'+path.basename(target),original);res.json({ok:true,id:x.lastInsertRowid,url:'/uploads/'+path.basename(target),name:original});});
app.post('/api/admin/reseller-files/:id/replace',admin,upload.single('file'),(req,res)=>{const old=db.prepare("SELECT * FROM reseller_files WHERE id=?").get(req.params.id);if(!old)return res.status(404).json({error:'Archivo no encontrado.'});if(!req.file)return res.status(400).json({error:'No se recibió ningún archivo.'});const ext=path.extname(req.file.originalname||'').toLowerCase(),allowed=['.ipa','.zip','.rar','.7z','.pdf','.dmg'];if(!allowed.includes(ext)){try{fs.unlinkSync(req.file.path)}catch(e){}return res.status(400).json({error:'Tipo de archivo no permitido.'});}try{const oldPath=path.join(UPLOAD_DIR,path.basename(old.url||''));if(fs.existsSync(oldPath))fs.unlinkSync(oldPath)}catch(e){}const original=path.basename(req.file.originalname||('archivo'+ext)),safe=original.replace(/[^a-zA-Z0-9._ -]/g,'_').replace(/\s+/g,' ').trim()||('archivo'+ext);let target=path.join(UPLOAD_DIR,'reseller-'+old.reseller_id+'-'+safe);if(fs.existsSync(target))target=path.join(UPLOAD_DIR,'reseller-'+old.reseller_id+'-'+Date.now()+'-'+safe);fs.renameSync(req.file.path,target);db.prepare("UPDATE reseller_files SET name=?,url=?,original_name=? WHERE id=?").run(path.basename(target),'/uploads/'+path.basename(target),original,old.id);res.json({ok:true,url:'/uploads/'+path.basename(target),name:original});});
app.delete('/api/admin/reseller-files/:id',admin,(req,res)=>{const f=db.prepare("SELECT * FROM reseller_files WHERE id=?").get(req.params.id);if(!f)return res.status(404).json({error:'Archivo no encontrado.'});try{const fp=path.join(UPLOAD_DIR,path.basename(f.url||''));if(fs.existsSync(fp))fs.unlinkSync(fp)}catch(e){}db.prepare("DELETE FROM reseller_files WHERE id=?").run(f.id);res.json({ok:true});});
app.get("/api/admin/data",admin,(req,res)=>res.json({
 users:db.prepare("SELECT id,name,email,balance,iphone_model,ios_version,created_at FROM users ORDER BY id DESC").all(),
 products:db.prepare("SELECT * FROM products ORDER BY id DESC").all(), categories:db.prepare("SELECT * FROM categories ORDER BY sort_order,id").all(), payment_methods:db.prepare("SELECT * FROM payment_methods ORDER BY sort_order,id").all(), category_downloads:db.prepare("SELECT * FROM category_downloads ORDER BY category").all(),
 topups:db.prepare("SELECT t.*,u.name,u.email,pm.name payment_method_name,pm.account payment_method_account FROM topups t JOIN users u ON u.id=t.user_id LEFT JOIN payment_methods pm ON pm.id=t.payment_method_id ORDER BY t.id DESC").all(),
 purchases:db.prepare("SELECT pu.*,u.name,u.email,p.name product_name FROM purchases pu JOIN users u ON u.id=pu.user_id JOIN products p ON p.id=pu.product_id ORDER BY pu.id DESC").all(),
 compatibility_rules:db.prepare("SELECT * FROM compatibility_rules ORDER BY id").all(),
 resellers:db.prepare("SELECT id,name,email,store_name,store_color,store_background,reseller_slug,reseller_status,reseller_expires_at,reseller_plan_months,created_at FROM users WHERE role='reseller' ORDER BY id DESC").all(),
 reseller_requests:db.prepare("SELECT rr.id,rr.name,rr.email,rr.plan_months,rr.amount,rr.status,rr.created_at,rr.reviewed_at,rr.user_id,rr.receipt,rr.receipt_mime,pm.name payment_method_name,pm.account payment_method_account FROM reseller_requests rr LEFT JOIN payment_methods pm ON pm.id=rr.payment_method_id ORDER BY rr.id DESC").all(),
 reseller_purchases:db.prepare("SELECT rp.*,u.name client_name,u.email client_email,r.name reseller_name,p.name product_name FROM reseller_purchases rp JOIN users u ON u.id=rp.user_id JOIN users r ON r.id=rp.reseller_id JOIN reseller_products p ON p.id=rp.product_id ORDER BY rp.id DESC").all()
}));
app.post("/api/admin/topup/:id/approve",admin,(req,res)=>{
 const t=db.prepare("SELECT * FROM topups WHERE id=?").get(req.params.id);
 if(!t||t.status!=="pending")return res.status(400).json({error:"Recarga no disponible."});
 db.transaction(()=>{db.prepare("UPDATE users SET balance=balance+? WHERE id=?").run(t.amount,t.user_id);db.prepare("UPDATE topups SET status='approved' WHERE id=?").run(t.id)})();
 res.json({ok:true});
});
app.post("/api/admin/topup/:id/reject",admin,(req,res)=>{db.prepare("UPDATE topups SET status='rejected' WHERE id=? AND status='pending'").run(req.params.id);res.json({ok:true})});
app.post("/api/admin/purchase/:id/deliver",admin,(req,res)=>{db.prepare("UPDATE purchases SET status='delivered' WHERE id=?").run(req.params.id);res.json({ok:true})});
app.post("/api/admin/upload-media",admin,upload.single("file"),(req,res)=>{
 if(!req.file)return res.status(400).json({error:"No se recibió ningún archivo."});
 const mime=req.file.mimetype||"";
 if(!mime.startsWith("image/")&&!mime.startsWith("video/")){try{fs.unlinkSync(req.file.path)}catch(e){} return res.status(400).json({error:"Solo se permiten imágenes o videos."});}
 res.json({ok:true,type:mime.startsWith("image/")?"image":"video",url:"/uploads/"+path.basename(req.file.path)});
});
app.post("/api/admin/upload-file",admin,upload.single("file"),(req,res)=>{
 if(!req.file)return res.status(400).json({error:"No se recibió ningún archivo."});
 const ext=path.extname(req.file.originalname||"").toLowerCase();
 const allowed=['.ipa','.zip','.rar','.7z','.pdf','.dmg'];
 if(!allowed.includes(ext)){try{fs.unlinkSync(req.file.path)}catch(e){} return res.status(400).json({error:"Tipo de archivo no permitido. Usa IPA, ZIP, RAR, 7Z, PDF o DMG."});}
 const original=path.basename(req.file.originalname||('archivo'+ext));
 const safeName=original.replace(/[^a-zA-Z0-9._ -]/g,'_').replace(/\s+/g,' ').trim() || ('archivo'+ext);
 let target=path.join(UPLOAD_DIR,safeName);
 if(fs.existsSync(target)){
   const base=path.basename(safeName,ext), stamp=Date.now();
   target=path.join(UPLOAD_DIR,`${base}-${stamp}${ext}`);
 }
 fs.renameSync(req.file.path,target);
 res.json({ok:true,url:"/uploads/"+path.basename(target),name:path.basename(target)});
});
app.post("/api/admin/category-downloads",admin,(req,res)=>{
 const category=String(req.body.category||'').trim();
 const ipa_url=String(req.body.ipa_url||'').trim();
 const ipa_name=String(req.body.ipa_name||'').trim() || category+' IPA';
 if(!['Filza','3105','iMazing'].includes(category)) return res.status(400).json({error:"Categoría no válida."});
 db.prepare("INSERT INTO category_downloads(category,ipa_url,ipa_name) VALUES(?,?,?) ON CONFLICT(category) DO UPDATE SET ipa_url=excluded.ipa_url,ipa_name=excluded.ipa_name").run(category,ipa_url,ipa_name);
 res.json({ok:true});
});
app.post("/api/admin/products",admin,(req,res)=>{
 const {name,category,price,description,image,video,mediafire_url,mega_url,file_password,ipa_url,file_url,file_name}=req.body;
 if(!name||!category||!Number.isInteger(Number(price)))return res.status(400).json({error:"Datos inválidos."});
 const x=db.prepare("INSERT INTO products(name,category,price,description,image,video,mediafire_url,mega_url,file_password,ipa_url,file_url,file_name) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").run(name,category,Number(price),description||"",image||"",video||"",mediafire_url||"",mega_url||"",file_password||"",ipa_url||"",file_url||"",file_name||"");
 res.json({ok:true,id:x.lastInsertRowid});
});
app.post("/api/admin/products/:id",admin,(req,res)=>{
 const {name,category,price,description,image,video,mediafire_url,mega_url,file_password,ipa_url,file_url,file_name,active}=req.body;
 if(!name||!category||!Number.isInteger(Number(price))||Number(price)<0)return res.status(400).json({error:"Datos inválidos."});
 const result=db.prepare("UPDATE products SET name=?,category=?,price=?,description=?,image=?,video=?,mediafire_url=?,mega_url=?,file_password=?,ipa_url=?,file_url=?,file_name=?,active=? WHERE id=?").run(name.trim(),category,Number(price),description||"",image||"",video||"",mediafire_url||"",mega_url||"",file_password||"",ipa_url||"",file_url||"",file_name||"",active?1:0,req.params.id);
 if(!result.changes)return res.status(404).json({error:"Producto no encontrado."});
 res.json({ok:true});
});
app.post('/api/admin/compatibility/:id',admin,(req,res)=>{
 const id=Number(req.params.id), label=String(req.body.label||'').trim(), min_version=String(req.body.min_version||'').trim(), max_version=String(req.body.max_version||'').trim();
 const compatible=req.body.compatible?1:0, enabled=req.body.enabled===false?0:1;
 if(!label||!versionParts(min_version)||!versionParts(max_version))return res.status(400).json({error:'Regla de versión inválida.'});
 if(compareVersions(min_version,max_version)>0)return res.status(400).json({error:'La versión mínima no puede ser mayor que la máxima.'});
 const r=db.prepare('UPDATE compatibility_rules SET label=?,min_version=?,max_version=?,compatible=?,enabled=? WHERE id=?').run(label,min_version,max_version,compatible,enabled,id);
 if(!r.changes)return res.status(404).json({error:'Regla no encontrada.'}); res.json({ok:true});
});
app.post('/api/admin/compatibility',admin,(req,res)=>{
 const label=String(req.body.label||'').trim(), min_version=String(req.body.min_version||'').trim(), max_version=String(req.body.max_version||'').trim(), compatible=req.body.compatible?1:0;
 if(!label||!versionParts(min_version)||!versionParts(max_version)||compareVersions(min_version,max_version)>0)return res.status(400).json({error:'Datos de compatibilidad inválidos.'});
 const x=db.prepare('INSERT INTO compatibility_rules(label,min_version,max_version,compatible,enabled) VALUES(?,?,?,?,1)').run(label,min_version,max_version,compatible); res.json({ok:true,id:x.lastInsertRowid});
});

app.post("/api/admin/users/:id/balance",admin,(req,res)=>{
 const mode=String(req.body.mode||'add');
 const value=Number(req.body.amount);
 const note=(req.body.note||"Ajuste manual del administrador").trim();
 if(!Number.isInteger(value)||value<0)return res.status(400).json({error:"El saldo debe ser un número entero mayor o igual a 0."});
 const u=db.prepare("SELECT id,balance FROM users WHERE id=?").get(req.params.id);
 if(!u)return res.status(404).json({error:"Cliente no encontrado."});
 const delta=mode==='set'?value-u.balance:value;
 db.transaction(()=>{
   if(mode==='set') db.prepare("UPDATE users SET balance=? WHERE id=?").run(value,u.id);
   else db.prepare("UPDATE users SET balance=balance+? WHERE id=?").run(value,u.id);
   if(delta!==0) db.prepare("INSERT INTO balance_adjustments(user_id,amount,note) VALUES(?,?,?)").run(u.id,delta,note);
 })();
 res.json({ok:true,balance:mode==='set'?value:u.balance+value});
});

app.listen(PORT,()=>console.log("ALFRED IOS STORES en puerto "+PORT));
