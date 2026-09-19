import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initDatabase, pool } from "./db.js";
import { register, loginPlayer, loginAdmin, logout, requireUser, requireAdmin, setSessionCookie } from "./auth.js";
import { getAccount, requestDeposit, requestWithdrawal, getTransactions } from "./finance.js";
import { listUsers, listDeposits, listWithdrawals, approveDeposit, rejectDeposit, approveWithdrawal, rejectWithdrawal, adjustBalance, getSettings, getPublicSettings, updateSetting, listTransactions } from "./admin.js";
import { getVapidPublicKey, saveAdminSubscription, removeAdminSubscription } from "./push.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 10000);

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: false, limit: "100kb" }));

const asyncRoute = fn => (req,res,next) => Promise.resolve(fn(req,res,next)).catch(next);

app.get("/api/health", asyncRoute(async (_req,res) => {
  await pool.query("SELECT 1");
  res.json({ok:true,service:"mybets-roulette",database:"connected",timestamp:new Date().toISOString()});
}));

app.get("/api/settings/public", asyncRoute(async (_req,res) => {
  res.json({ok:true,settings:await getPublicSettings()});
}));

app.post("/api/auth/register", asyncRoute(async (req,res) => {
  const user=await register(req.body);
  const logged=await loginPlayer(req.body);
  setSessionCookie(res,logged.sessionId);
  res.status(201).json({ok:true,user:logged.user});
}));

app.post("/api/auth/login", asyncRoute(async (req,res) => {
  const logged=await loginPlayer(req.body);
  setSessionCookie(res,logged.sessionId);
  res.json({ok:true,user:logged.user});
}));

app.post("/api/auth/admin-login", asyncRoute(async (req,res) => {
  const logged=await loginAdmin(req.body);
  setSessionCookie(res,logged.sessionId);
  res.json({ok:true,admin:logged.admin});
}));

app.post("/api/auth/logout", asyncRoute(async (req,res) => {
  await logout(req,res);
  res.json({ok:true});
}));

app.get("/api/account", requireUser, asyncRoute(async (req,res) => {
  const account=await getAccount(req.user.id);
  res.json({ok:true,account});
}));

app.post("/api/deposits", requireUser, asyncRoute(async (req,res) => {
  const deposit=await requestDeposit({userId:req.user.id,amount:req.body.amount,playerNote:req.body.playerNote});
  res.status(201).json({ok:true,deposit});
}));

app.post("/api/withdrawals", requireUser, asyncRoute(async (req,res) => {
  const withdrawal=await requestWithdrawal({userId:req.user.id,amount:req.body.amount,pixKey:req.body.pixKey,playerNote:req.body.playerNote});
  res.status(201).json({ok:true,withdrawal});
}));

app.get("/api/transactions", requireUser, asyncRoute(async (req,res) => {
  res.json({ok:true,transactions:await getTransactions(req.user.id)});
}));

app.get("/api/admin/users", requireAdmin, asyncRoute(async (_req,res) => {
  res.json({ok:true,users:await listUsers()});
}));
app.get("/api/admin/deposits", requireAdmin, asyncRoute(async (_req,res) => {
  res.json({ok:true,deposits:await listDeposits()});
}));
app.get("/api/admin/withdrawals", requireAdmin, asyncRoute(async (_req,res) => {
  res.json({ok:true,withdrawals:await listWithdrawals()});
}));
app.post("/api/admin/deposits/:id/approve", requireAdmin, asyncRoute(async (req,res) => {
  res.json({ok:true,result:await approveDeposit({
    id:req.params.id,
    adminId:req.admin.id,
    approvedAmount:req.body.approvedAmount,
    adminNote:req.body.adminNote
  })});
}));
app.post("/api/admin/deposits/:id/reject", requireAdmin, asyncRoute(async (req,res) => {
  res.json({ok:true,result:await rejectDeposit({id:req.params.id,adminId:req.admin.id,adminNote:req.body.adminNote})});
}));
app.post("/api/admin/withdrawals/:id/approve", requireAdmin, asyncRoute(async (req,res) => {
  res.json({ok:true,result:await approveWithdrawal({id:req.params.id,adminId:req.admin.id,adminNote:req.body.adminNote})});
}));
app.post("/api/admin/withdrawals/:id/reject", requireAdmin, asyncRoute(async (req,res) => {
  res.json({ok:true,result:await rejectWithdrawal({id:req.params.id,adminId:req.admin.id,rejectionReason:req.body.rejectionReason,adminNote:req.body.adminNote})});
}));
app.post("/api/admin/users/:id/balance", requireAdmin, asyncRoute(async (req,res) => {
  res.json({ok:true,result:await adjustBalance({userId:req.params.id,amount:req.body.amount,kind:req.body.kind,adminId:req.admin.id,note:req.body.note})});
}));
app.get("/api/push/public-key", asyncRoute(async (_req,res) => {
  res.json({ok:true,publicKey:getVapidPublicKey()});
}));
app.post("/api/admin/push/subscribe", requireAdmin, asyncRoute(async (req,res) => {
  res.json(await saveAdminSubscription({adminId:req.admin.id,subscription:req.body}));
}));
app.post("/api/admin/push/unsubscribe", requireAdmin, asyncRoute(async (req,res) => {
  await removeAdminSubscription({adminId:req.admin.id,endpoint:req.body?.endpoint});
  res.json({ok:true});
}));
app.get("/api/admin/notifications/count", requireAdmin, asyncRoute(async (_req,res) => {
  const [d,w]=await Promise.all([
    pool.query("SELECT COUNT(*)::int AS count FROM deposits WHERE status='pending'"),
    pool.query("SELECT COUNT(*)::int AS count FROM withdrawals WHERE status='pending'")
  ]);
  res.json({ok:true,count:Number(d.rows[0].count)+Number(w.rows[0].count)});
}));
app.get("/api/admin/settings", requireAdmin, asyncRoute(async (_req,res) => {
  res.json({ok:true,settings:await getSettings()});
}));
app.put("/api/admin/settings/:key", requireAdmin, asyncRoute(async (req,res) => {
  res.json({ok:true,setting:await updateSetting(req.params.key,req.body.value)});
}));

const frontendPath=path.join(__dirname,"../frontend");
app.use(express.static(frontendPath));
app.get("/",(_req,res)=>res.sendFile(path.join(frontendPath,"index.html")));

app.use((err,_req,res,_next)=>{
  console.error("Erro:",err);
  const status=/inválid|insuficiente|obrigat|não encontrado|já foi|desativados|movimentação|negativo|Reserva|senha|usuário|valor/.test(String(err.message))?400:500;
  res.status(status).json({message:err.message||"Erro interno do servidor."});
});
app.get("/api/admin/transactions", requireAdmin, asyncRoute(async (_req,res) => {
  res.json({ok:true,transactions:await listTransactions()});
}));

let server;
async function start(){
  if(!process.env.DATABASE_URL) throw new Error("DATABASE_URL não configurada.");
  await initDatabase();
  server=app.listen(PORT,"0.0.0.0",()=>console.log(`MyBets Roulette rodando na porta ${PORT}.`));
}
async function shutdown(signal){
  console.log(`Recebido ${signal}. Encerrando servidor...`);
  if(server) await new Promise(resolve=>server.close(resolve));
  await pool.end();
  process.exit(0);
}
process.on("SIGTERM",()=>shutdown("SIGTERM"));
process.on("SIGINT",()=>shutdown("SIGINT"));
start().catch(error=>{console.error("Falha ao iniciar MyBets Roulette:",error);process.exit(1);});
