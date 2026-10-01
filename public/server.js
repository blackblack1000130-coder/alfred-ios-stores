const express=require("express");
const bcrypt=require("bcryptjs");
const multer=require("multer");
const path=require("path");
const fs=require("fs");
const crypto=require("crypto");
const Database=require("better-sqlite3");

const app=express();
const PORT=process.env.PORT||10000;
const DB_PATH=process.env.DB_PATH||path.join(__dirname,"data","store.db");
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
`);

// Campos de entrega digital. Se agregan sin borrar datos existentes.
for (const [col, type] of [['mega_url',"TEXT DEFAULT ''"],['file_password',"TEXT DEFAULT ''"],['ipa_url',"TEXT DEFAULT ''"],['file_url',"TEXT DEFAULT ''"],['file_name',"TEXT DEFAULT ''"]]) {
  const exists = db.prepare(`PRAGMA table_info(products)`).all().some(x => x.name === col);
  if (!exists) db.exec(`ALTER TABLE products ADD COLUMN ${col} ${type}`);
}
for (const [col, type] of [['iphone_model',"TEXT DEFAULT ''"],['ios_version',"TEXT DEFAULT ''"]]) {
  const exists = db.prepare(`PRAGMA table_info(users)`).all().some(x => x.name === col);
  if (!exists) db.exec(`ALTER TABLE users ADD COLUMN ${col} ${type}`);
}
db.exec(`CREATE TABLE IF NOT EXISTS category_downloads(category TEXT PRIMARY KEY, ipa_url TEXT DEFAULT '', ipa_name TEXT DEFAULT '')`);
for (const c of ['Filza','3105','iMazing']) db.prepare("INSERT OR IGNORE INTO category_downloads(category) VALUES(?)").run(c);
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
app.use((req,res,next)=>{req.auth=readAuth(req);next();});
app.use(express.static(path.join(__dirname,"public")));

const UPLOAD_DIR=process.env.UPLOAD_DIR||path.join(__dirname,"data","uploads");
fs.mkdirSync(UPLOAD_DIR,{recursive:true});
app.use("/uploads",express.static(UPLOAD_DIR));
const upload=multer({dest:UPLOAD_DIR,limits:{fileSize:50*1024*1024}});

function user(req,res,next){if(!req.auth||!req.auth.userId)return res.status(401).json({error:"Debes iniciar sesión."});next();}
function admin(req,res,next){if(!req.auth||!req.auth.admin)return res.status(401).json({error:"Acceso de administrador requerido."});next();}


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
 const allowed=['payment_method','payment_account','delivery_notice','whatsapp_channel'];
 const up=db.prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value");
 for(const k of allowed){if(req.body&&req.body[k]!==undefined)up.run(k,String(req.body[k]).trim());}
 res.json({ok:true,settings:getSettings()});
});

app.get("/api/products",(req,res)=>{
 const c=req.query.category;
 const rows=c&&c!=="Todas"?db.prepare("SELECT * FROM products WHERE active=1 AND category=? ORDER BY id DESC").all(c):db.prepare("SELECT * FROM products WHERE active=1 ORDER BY id DESC").all();
 res.json(rows);
});
app.post("/api/register",async(req,res)=>{
 try{
   const name=String(req.body?.name||'').trim();
   const email=String(req.body?.email||'').trim().toLowerCase();
   const password=String(req.body?.password||'');
   if(name.length<2)return res.status(400).json({error:"Escribe tu nombre."});
   if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return res.status(400).json({error:"Escribe un correo válido."});
   if(password.length<8)return res.status(400).json({error:"La contraseña debe tener 8 caracteres o más."});
   const existing=db.prepare("SELECT id FROM users WHERE lower(email)=lower(?) LIMIT 1").get(email);
   if(existing)return res.status(409).json({error:"Ese correo ya está registrado. Inicia sesión o usa otro correo."});
   const h=await bcrypt.hash(password,12);
   let x;
   try{
     x=db.prepare("INSERT INTO users(name,email,password_hash) VALUES(?,?,?)").run(name,email,h);
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
 const u=db.prepare("SELECT * FROM users WHERE email=?").get((req.body.email||"").toLowerCase());
 if(!u||!(await bcrypt.compare(req.body.password||"",u.password_hash)))return res.status(401).json({error:"Correo o contraseña incorrectos."});
 setAuth(res,{userId:u.id,exp:Date.now()+31536000000});res.json({ok:true});
});
app.post("/api/logout",(req,res)=>{clearAuth(res);res.json({ok:true});});
app.get("/api/me",user,(req,res)=>{
 const u=db.prepare("SELECT id,name,email,balance,iphone_model,ios_version,created_at FROM users WHERE id=?").get(req.auth.userId);
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
(SELECT ipa_name FROM category_downloads cd WHERE cd.category=p.category) AS ipa_name
 FROM purchases pu JOIN products p ON p.id=pu.product_id WHERE pu.user_id=? ORDER BY pu.id DESC`).all(req.auth.userId);
 res.json(rows);
});
app.get("/api/my-topups",user,(req,res)=>res.json(db.prepare("SELECT id,amount,status,created_at FROM topups WHERE user_id=? ORDER BY id DESC").all(req.auth.userId)));
app.post("/api/topup",user,upload.single("receipt"),(req,res)=>{
 const amount=Number(req.body.amount);
 if(!Number.isInteger(amount)||amount<1||!req.file)return res.status(400).json({error:"Indica un monto y sube el comprobante."});
 db.prepare("INSERT INTO topups(user_id,amount,receipt) VALUES(?,?,?)").run(req.auth.userId,amount,"/uploads/"+path.basename(req.file.path));
 res.json({ok:true,message:"Comprobante enviado. Queda pendiente de verificación."});
});
app.post("/api/buy",user,(req,res)=>{
 const p=db.prepare("SELECT * FROM products WHERE id=? AND active=1").get(Number(req.body.productId));
 if(!p)return res.status(404).json({error:"Producto no encontrado."});
 const u=db.prepare("SELECT balance FROM users WHERE id=?").get(req.auth.userId);
 if(u.balance<p.price)return res.status(400).json({error:"Saldo insuficiente. Agrega saldo primero."});
 db.transaction(()=>{
   db.prepare("UPDATE users SET balance=balance-? WHERE id=?").run(p.price,req.auth.userId);
   db.prepare("INSERT INTO purchases(user_id,product_id,price) VALUES(?,?,?)").run(req.auth.userId,p.id,p.price);
 })();
 res.json({ok:true,message:"Compra realizada. La entrega puede tardar de 1 a 2 horas."});
});

app.post("/api/admin/login",(req,res)=>{
 if(req.body.email===ADMIN_EMAIL&&req.body.password===ADMIN_PASSWORD){setAuth(res,{admin:true,exp:Date.now()+31536000000});return res.json({ok:true});}
 res.status(401).json({error:"Credenciales incorrectas."});
});
app.post("/api/admin/logout",(req,res)=>{clearAuth(res);res.json({ok:true});});
app.get("/api/admin/data",admin,(req,res)=>res.json({
 users:db.prepare("SELECT id,name,email,balance,iphone_model,ios_version,created_at FROM users ORDER BY id DESC").all(),
 products:db.prepare("SELECT * FROM products ORDER BY id DESC").all(), category_downloads:db.prepare("SELECT * FROM category_downloads ORDER BY category").all(),
 topups:db.prepare("SELECT t.*,u.name,u.email FROM topups t JOIN users u ON u.id=t.user_id ORDER BY t.id DESC").all(),
 purchases:db.prepare("SELECT pu.*,u.name,u.email,p.name product_name FROM purchases pu JOIN users u ON u.id=pu.user_id JOIN products p ON p.id=pu.product_id ORDER BY pu.id DESC").all(),
 compatibility_rules:db.prepare("SELECT * FROM compatibility_rules ORDER BY id").all()
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
