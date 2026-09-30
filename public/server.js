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
const db=new Database(DB_PATH);
db.pragma("journal_mode=WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,balance INTEGER NOT NULL DEFAULT 0,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS products(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,category TEXT NOT NULL,price INTEGER NOT NULL,description TEXT DEFAULT '',image TEXT DEFAULT '',video TEXT DEFAULT '',mediafire_url TEXT DEFAULT '',active INTEGER DEFAULT 1,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS topups(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,amount INTEGER NOT NULL,receipt TEXT NOT NULL,status TEXT DEFAULT 'pending',created_at TEXT DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(user_id) REFERENCES users(id));
CREATE TABLE IF NOT EXISTS purchases(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,product_id INTEGER NOT NULL,price INTEGER NOT NULL,status TEXT DEFAULT 'pending_delivery',created_at TEXT DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(user_id) REFERENCES users(id),FOREIGN KEY(product_id) REFERENCES products(id));
CREATE TABLE IF NOT EXISTS balance_adjustments(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,amount INTEGER NOT NULL,note TEXT DEFAULT '',created_at TEXT DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(user_id) REFERENCES users(id));
`);

for (const [col, type] of [['iphone_model',"TEXT DEFAULT ''"],['ios_version',"TEXT DEFAULT ''"]]) {
  const exists = db.prepare(`PRAGMA table_info(users)`).all().some(x => x.name === col);
  if (!exists) db.exec(`ALTER TABLE users ADD COLUMN ${col} ${type}`);
}
db.exec(`CREATE TABLE IF NOT EXISTS compatibility_settings(id INTEGER PRIMARY KEY CHECK(id=1), allowed_ranges TEXT NOT NULL DEFAULT '14.0.0-18.6.1\n26.0.1-26.6.2\n27.0.0-beta1-27.0.0-beta6', blocked_ranges TEXT NOT NULL DEFAULT '18.7.1-18.7.10', note TEXT NOT NULL DEFAULT '')`);
db.prepare("INSERT OR IGNORE INTO compatibility_settings(id) VALUES(1)").run();

// Campos de entrega digital. Se agregan sin borrar datos existentes.
for (const [col, type] of [['mega_url',"TEXT DEFAULT ''"],['file_password',"TEXT DEFAULT ''"],['ipa_url',"TEXT DEFAULT ''"]]) {
  const exists = db.prepare(`PRAGMA table_info(products)`).all().some(x => x.name === col);
  if (!exists) db.exec(`ALTER TABLE products ADD COLUMN ${col} ${type}`);
}
db.exec(`CREATE TABLE IF NOT EXISTS category_downloads(category TEXT PRIMARY KEY, ipa_url TEXT DEFAULT '', ipa_name TEXT DEFAULT '')`);
for (const c of ['Filza','3105','iMazing']) db.prepare("INSERT OR IGNORE INTO category_downloads(category) VALUES(?)").run(c);

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
const updateProduct=db.prepare("UPDATE products SET price=?,description=?,active=1 WHERE id=?");
const insertProduct=db.prepare("INSERT INTO products(name,category,price,description,active) VALUES(?,?,?,?,1)");
db.transaction(()=>{
  for(const [name,category,price,description] of catalog){
    const existing=findProduct.get(name,category);
    if(existing) updateProduct.run(price,description,existing.id);
    else insertProduct.run(name,category,price,description);
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
 res.setHeader("Set-Cookie",`${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${secure}`);
}
function clearAuth(res){res.setHeader("Set-Cookie",`${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);}
app.use((req,res,next)=>{req.auth=readAuth(req);next();});
app.use(express.static(path.join(__dirname,"public")));

const UPLOAD_DIR=path.join(__dirname,"public","uploads");
fs.mkdirSync(UPLOAD_DIR,{recursive:true});
const upload=multer({dest:UPLOAD_DIR,limits:{fileSize:50*1024*1024}});

function user(req,res,next){if(!req.auth||!req.auth.userId)return res.status(401).json({error:"Debes iniciar sesión."});next();}
function admin(req,res,next){if(!req.auth||!req.auth.admin)return res.status(401).json({error:"Acceso de administrador requerido."});next();}

app.get("/api/settings",(req,res)=>res.json({
 payment_method:"Banreservas",payment_account:"9605206264",
 delivery_notice:"La entrega puede tardar de 1 a 2 horas.",
 compatibility_notice:"Estas sensibilidades son compatibles para todos dispositivos iPhone desde iOS 14 a iOS 27, excepto iOS 18.7.1–18.7.10 por el momento."
}));

app.get("/api/products",(req,res)=>{
 const c=req.query.category;
 const rows=c&&c!=="Todas"?db.prepare("SELECT * FROM products WHERE active=1 AND category=? ORDER BY id DESC").all(c):db.prepare("SELECT * FROM products WHERE active=1 ORDER BY id DESC").all();
 res.json(rows);
});
app.post("/api/register",async(req,res)=>{
 const {name,email,password}=req.body;
 if(!name||!email||!password||password.length<8)return res.status(400).json({error:"Completa los datos. La contraseña debe tener 8 caracteres o más."});
 try{const h=await bcrypt.hash(password,12);const x=db.prepare("INSERT INTO users(name,email,password_hash) VALUES(?,?,?)").run(name.trim(),email.trim().toLowerCase(),h);setAuth(res,{userId:x.lastInsertRowid,exp:Date.now()+2592000000});res.json({ok:true});}
 catch(e){res.status(400).json({error:"Ese correo ya está registrado."});}
});
app.post("/api/login",async(req,res)=>{
 const u=db.prepare("SELECT * FROM users WHERE email=?").get((req.body.email||"").toLowerCase());
 if(!u||!(await bcrypt.compare(req.body.password||"",u.password_hash)))return res.status(401).json({error:"Correo o contraseña incorrectos."});
 setAuth(res,{userId:u.id,exp:Date.now()+2592000000});res.json({ok:true});
});
app.post("/api/logout",(req,res)=>{clearAuth(res);res.json({ok:true});});
app.get("/api/me",user,(req,res)=>res.json(db.prepare("SELECT id,name,email,balance,iphone_model,ios_version,created_at FROM users WHERE id=?").get(req.auth.userId)));
app.get("/api/compatibility",(req,res)=>{
 const s=db.prepare("SELECT allowed_ranges,blocked_ranges,note FROM compatibility_settings WHERE id=1").get();
 res.json(s);
});
app.post("/api/my-device",user,(req,res)=>{
 const model=String(req.body.iphone_model||'').trim().slice(0,100);
 const version=String(req.body.ios_version||'').trim().slice(0,40);
 if(!model||!version)return res.status(400).json({error:"Indica el modelo de iPhone y la versión exacta de iOS."});
 db.prepare("UPDATE users SET iphone_model=?,ios_version=? WHERE id=?").run(model,version,req.auth.userId);
 res.json({ok:true});
});
app.get("/api/my-products",user,(req,res)=>{
 const rows=db.prepare(`SELECT pu.id purchase_id,pu.status,pu.created_at purchased_at,p.id product_id,p.name,p.price,p.category,p.mediafire_url,p.mega_url,p.file_password,p.image,p.video,
 CASE WHEN pu.status='delivered' THEN COALESCE(NULLIF(p.ipa_url,''),(SELECT ipa_url FROM category_downloads cd WHERE cd.category=p.category)) ELSE '' END AS ipa_url
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
 if(req.body.email===ADMIN_EMAIL&&req.body.password===ADMIN_PASSWORD){setAuth(res,{admin:true,exp:Date.now()+2592000000});return res.json({ok:true});}
 res.status(401).json({error:"Credenciales incorrectas."});
});
app.post("/api/admin/logout",(req,res)=>{clearAuth(res);res.json({ok:true});});
app.get("/api/admin/data",admin,(req,res)=>res.json({
 users:db.prepare("SELECT id,name,email,balance,iphone_model,ios_version,created_at FROM users ORDER BY id DESC").all(),
 compatibility:db.prepare("SELECT allowed_ranges,blocked_ranges,note FROM compatibility_settings WHERE id=1").get(),
 products:db.prepare("SELECT * FROM products ORDER BY id DESC").all(), category_downloads:db.prepare("SELECT * FROM category_downloads ORDER BY category").all(),
 topups:db.prepare("SELECT t.*,u.name,u.email FROM topups t JOIN users u ON u.id=t.user_id ORDER BY t.id DESC").all(),
 purchases:db.prepare("SELECT pu.*,u.name,u.email,p.name product_name FROM purchases pu JOIN users u ON u.id=pu.user_id JOIN products p ON p.id=pu.product_id ORDER BY pu.id DESC").all()
}));
app.post("/api/admin/compatibility",admin,(req,res)=>{
 const allowed=String(req.body.allowed_ranges||'').trim();
 const blocked=String(req.body.blocked_ranges||'').trim();
 const note=String(req.body.note||'').trim();
 if(!allowed)return res.status(400).json({error:"Debes indicar al menos un rango compatible."});
 db.prepare("UPDATE compatibility_settings SET allowed_ranges=?,blocked_ranges=?,note=? WHERE id=1").run(allowed,blocked,note);
 res.json({ok:true});
});
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
 const target=path.join(UPLOAD_DIR,crypto.randomBytes(8).toString('hex')+ext);
 fs.renameSync(req.file.path,target);
 res.json({ok:true,url:"/uploads/"+path.basename(target)});
});
app.post("/api/admin/category-downloads",admin,(req,res)=>{
 const category=String(req.body.category||'').trim();
 const ipa_url=String(req.body.ipa_url||'').trim();
 const ipa_name=String(req.body.ipa_name||'').trim();
 if(!['Filza','3105','iMazing'].includes(category)) return res.status(400).json({error:"Categoría no válida."});
 db.prepare("INSERT INTO category_downloads(category,ipa_url,ipa_name) VALUES(?,?,?) ON CONFLICT(category) DO UPDATE SET ipa_url=excluded.ipa_url,ipa_name=excluded.ipa_name").run(category,ipa_url,ipa_name);
 res.json({ok:true});
});
app.post("/api/admin/products",admin,(req,res)=>{
 const {name,category,price,description,image,video,mediafire_url,mega_url,file_password,ipa_url}=req.body;
 if(!name||!category||!Number.isInteger(Number(price)))return res.status(400).json({error:"Datos inválidos."});
 const x=db.prepare("INSERT INTO products(name,category,price,description,image,video,mediafire_url,mega_url,file_password,ipa_url) VALUES(?,?,?,?,?,?,?,?,?,?)").run(name,category,Number(price),description||"",image||"",video||"",mediafire_url||"",mega_url||"",file_password||"",ipa_url||"");
 res.json({ok:true,id:x.lastInsertRowid});
});
app.post("/api/admin/products/:id",admin,(req,res)=>{
 const {name,category,price,description,image,video,mediafire_url,mega_url,file_password,ipa_url,active}=req.body;
 if(!name||!category||!Number.isInteger(Number(price))||Number(price)<0)return res.status(400).json({error:"Datos inválidos."});
 const result=db.prepare("UPDATE products SET name=?,category=?,price=?,description=?,image=?,video=?,mediafire_url=?,mega_url=?,file_password=?,ipa_url=?,active=? WHERE id=?").run(name.trim(),category,Number(price),description||"",image||"",video||"",mediafire_url||"",mega_url||"",file_password||"",ipa_url||"",active?1:0,req.params.id);
 if(!result.changes)return res.status(404).json({error:"Producto no encontrado."});
 res.json({ok:true});
});
app.post("/api/admin/users/:id/balance",admin,(req,res)=>{
 const amount=Number(req.body.amount);
 const note=(req.body.note||"Ajuste manual del administrador").trim();
 if(!Number.isInteger(amount)||amount<1)return res.status(400).json({error:"El monto debe ser un número entero mayor que 0."});
 const u=db.prepare("SELECT id FROM users WHERE id=?").get(req.params.id);
 if(!u)return res.status(404).json({error:"Cliente no encontrado."});
 db.transaction(()=>{
   db.prepare("UPDATE users SET balance=balance+? WHERE id=?").run(amount,u.id);
   db.prepare("INSERT INTO balance_adjustments(user_id,amount,note) VALUES(?,?,?)").run(u.id,amount,note);
 })();
 res.json({ok:true});
});

app.listen(PORT,()=>console.log("ALFRED IOS STORES en puerto "+PORT));
