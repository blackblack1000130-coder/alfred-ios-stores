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

const upload=multer({dest:path.join(__dirname,"public","uploads"),limits:{fileSize:10*1024*1024}});

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
 try{const h=await bcrypt.hash(password,12);const x=db.prepare("INSERT INTO users(name,email,password_hash) VALUES(?,?,?)").run(name.trim(),email.trim().toLowerCase(),h);setAuth(res,{userId:x.lastInsertRowid,exp:Date.now()+604800000});res.json({ok:true});}
 catch(e){res.status(400).json({error:"Ese correo ya está registrado."});}
});
app.post("/api/login",async(req,res)=>{
 const u=db.prepare("SELECT * FROM users WHERE email=?").get((req.body.email||"").toLowerCase());
 if(!u||!(await bcrypt.compare(req.body.password||"",u.password_hash)))return res.status(401).json({error:"Correo o contraseña incorrectos."});
 setAuth(res,{userId:u.id,exp:Date.now()+604800000});res.json({ok:true});
});
app.post("/api/logout",(req,res)=>{clearAuth(res);res.json({ok:true});});
app.get("/api/me",user,(req,res)=>res.json(db.prepare("SELECT id,name,email,balance,created_at FROM users WHERE id=?").get(req.auth.userId)));
app.get("/api/my-products",user,(req,res)=>res.json(db.prepare(`SELECT pu.id purchase_id,pu.status,pu.created_at purchased_at,p.id product_id,p.name,p.price,p.mediafire_url,p.image,p.video FROM purchases pu JOIN products p ON p.id=pu.product_id WHERE pu.user_id=? ORDER BY pu.id DESC`).all(req.auth.userId)));
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
 if(req.body.email===ADMIN_EMAIL&&req.body.password===ADMIN_PASSWORD){setAuth(res,{admin:true,exp:Date.now()+604800000});return res.json({ok:true});}
 res.status(401).json({error:"Credenciales incorrectas."});
});
app.post("/api/admin/logout",(req,res)=>{clearAuth(res);res.json({ok:true});});
app.get("/api/admin/data",admin,(req,res)=>res.json({
 users:db.prepare("SELECT id,name,email,balance,created_at FROM users ORDER BY id DESC").all(),
 products:db.prepare("SELECT * FROM products ORDER BY id DESC").all(),
 topups:db.prepare("SELECT t.*,u.name,u.email FROM topups t JOIN users u ON u.id=t.user_id ORDER BY t.id DESC").all(),
 purchases:db.prepare("SELECT pu.*,u.name,u.email,p.name product_name FROM purchases pu JOIN users u ON u.id=pu.user_id JOIN products p ON p.id=pu.product_id ORDER BY pu.id DESC").all()
}));
app.post("/api/admin/topup/:id/approve",admin,(req,res)=>{
 const t=db.prepare("SELECT * FROM topups WHERE id=?").get(req.params.id);
 if(!t||t.status!=="pending")return res.status(400).json({error:"Recarga no disponible."});
 db.transaction(()=>{db.prepare("UPDATE users SET balance=balance+? WHERE id=?").run(t.amount,t.user_id);db.prepare("UPDATE topups SET status='approved' WHERE id=?").run(t.id)})();
 res.json({ok:true});
});
app.post("/api/admin/topup/:id/reject",admin,(req,res)=>{db.prepare("UPDATE topups SET status='rejected' WHERE id=? AND status='pending'").run(req.params.id);res.json({ok:true})});
app.post("/api/admin/purchase/:id/deliver",admin,(req,res)=>{db.prepare("UPDATE purchases SET status='delivered' WHERE id=?").run(req.params.id);res.json({ok:true})});
app.post("/api/admin/products",admin,(req,res)=>{
 const {name,category,price,description,image,video,mediafire_url}=req.body;
 if(!name||!category||!Number.isInteger(Number(price)))return res.status(400).json({error:"Datos inválidos."});
 const x=db.prepare("INSERT INTO products(name,category,price,description,image,video,mediafire_url) VALUES(?,?,?,?,?,?,?)").run(name,category,Number(price),description||"",image||"",video||"",mediafire_url||"");
 res.json({ok:true,id:x.lastInsertRowid});
});
app.post("/api/admin/products/:id",admin,(req,res)=>{
 const {name,category,price,description,image,video,mediafire_url,active}=req.body;
 if(!name||!category||!Number.isInteger(Number(price))||Number(price)<0)return res.status(400).json({error:"Datos inválidos."});
 const result=db.prepare("UPDATE products SET name=?,category=?,price=?,description=?,image=?,video=?,mediafire_url=?,active=? WHERE id=?").run(name.trim(),category,Number(price),description||"",image||"",video||"",mediafire_url||"",active?1:0,req.params.id);
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
