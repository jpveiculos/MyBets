import crypto from "node:crypto";
import { pool } from "./db.js";

const SESSION_DAYS = 30;

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return `scrypt:${salt}:${derived}`;
}

function verifyPassword(password, stored) {
  const parts = String(stored || "").split(":");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const derived = crypto.scryptSync(String(password), parts[1], 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(derived, "hex"), Buffer.from(parts[2], "hex"));
}

function newSessionId() {
  return crypto.randomBytes(32).toString("hex");
}

function setSessionCookie(res, sessionId, kind="player") {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  const name=kind==="admin"?"mybets_admin_session":"mybets_player_session";
  res.setHeader("Set-Cookie", `${name}=${sessionId}; HttpOnly; Path=/; SameSite=Lax; Max-Age=2592000${secure}`);
}

function clearSessionCookie(res, kind="player") {
  const name=kind==="admin"?"mybets_admin_session":"mybets_player_session";
  res.setHeader("Set-Cookie", `${name}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
}

function parseCookies(req) {
  const header = req.headers.cookie || "";
  return Object.fromEntries(header.split(";").filter(Boolean).map(part => {
    const i = part.indexOf("=");
    return [part.slice(0, i).trim(), decodeURIComponent(part.slice(i + 1).trim())];
  }));
}

async function createSession({ userId = null, adminId = null }) {
  const id = newSessionId();
  await pool.query(
    `INSERT INTO sessions(id,user_id,admin_id,expires_at)
     VALUES($1,$2,$3,CURRENT_TIMESTAMP + INTERVAL '${SESSION_DAYS} days')`,
    [id, userId, adminId]
  );
  return id;
}

export async function requireUser(req, res, next) {
  try {
    const cookies = parseCookies(req);
    const result = await pool.query(
      `SELECT s.id, u.id AS user_id, u.username, u.is_banned, u.is_deleted, u.banned_reason
         FROM sessions s
         JOIN users u ON u.id=s.user_id
        WHERE s.id=$1 AND s.expires_at>CURRENT_TIMESTAMP`,
      [cookies.mybets_player_session]
    );
    if (!result.rows[0]) return res.status(401).json({ message:"Sessão do jogador inválida ou expirada." });
    if (result.rows[0].is_deleted || result.rows[0].is_banned) {
      await pool.query("DELETE FROM sessions WHERE id=$1",[result.rows[0].id]);
      return res.status(403).json({ message: result.rows[0].is_deleted ? "Usuário removido pelo administrador." : (result.rows[0].banned_reason ? `Usuário banido. Motivo: ${result.rows[0].banned_reason}` : "Usuário banido.") });
    }
    req.user = { id: result.rows[0].user_id, username: result.rows[0].username };
    await pool.query("UPDATE sessions SET expires_at=CURRENT_TIMESTAMP + INTERVAL '30 days' WHERE id=$1",[result.rows[0].id]);
    setSessionCookie(res,result.rows[0].id,"player");
    next();
  } catch (error) { next(error); }
}

export async function requireUserPage(req, res, next) {
  try {
    const cookies = parseCookies(req);
    const result = await pool.query(
      `SELECT s.id, u.is_banned, u.is_deleted
         FROM sessions s
         JOIN users u ON u.id=s.user_id
        WHERE s.id=$1 AND s.expires_at>CURRENT_TIMESTAMP`,
      [cookies.mybets_player_session]
    );
    if (!result.rows[0]) return res.redirect("/?login=1");
    if (result.rows[0].is_deleted || result.rows[0].is_banned) {
      await pool.query("DELETE FROM sessions WHERE id=$1",[result.rows[0].id]);
      return res.redirect("/?login=1");
    }
    await pool.query("UPDATE sessions SET expires_at=CURRENT_TIMESTAMP + INTERVAL '30 days' WHERE id=$1",[result.rows[0].id]);
    setSessionCookie(res,result.rows[0].id,"player");
    next();
  } catch (error) { next(error); }
}

export async function requireAdmin(req, res, next) {
  try {
    const cookies = parseCookies(req);
    const result = await pool.query(
      `SELECT s.id, a.id AS admin_id, a.username
         FROM sessions s
         JOIN admins a ON a.id=s.admin_id
        WHERE s.id=$1 AND s.expires_at>CURRENT_TIMESTAMP`,
      [cookies.mybets_admin_session]
    );
    if (!result.rows[0]) return res.status(401).json({ message:"Sessão administrativa inválida ou expirada." });
    req.admin = { id: result.rows[0].admin_id, username: result.rows[0].username };
    await pool.query("UPDATE sessions SET expires_at=CURRENT_TIMESTAMP + INTERVAL '30 days' WHERE id=$1",[result.rows[0].id]);
    setSessionCookie(res,result.rows[0].id,"admin");
    next();
  } catch (error) { next(error); }
}

function normalizeCPF(value) {
  return String(value || "").replace(/\D/g, "");
}

const BLOCKED_TEST_CPFS = new Set([
  "01234567890",
  "12345678909",
  "98765432100"
]);

function isValidCPF(value) {
  const cpf = normalizeCPF(value);
  if (!/^\d{11}$/.test(cpf)) return false;
  if (BLOCKED_TEST_CPFS.has(cpf)) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(cpf[i]) * (10 - i);
  let digit = (sum * 10) % 11;
  if (digit === 10) digit = 0;
  if (digit !== Number(cpf[9])) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += Number(cpf[i]) * (11 - i);
  digit = (sum * 10) % 11;
  if (digit === 10) digit = 0;
  return digit === Number(cpf[10]);
}

export async function register({ username, password, cpf }) {
  const name = String(username || "").trim();
  if (!/^[A-Za-z0-9_.-]{3,50}$/.test(name)) throw new Error("Usuário inválido.");
  if (String(password || "").length < 6) throw new Error("A senha deve ter pelo menos 6 caracteres.");
  const normalizedCPF = normalizeCPF(cpf);
  if (!isValidCPF(normalizedCPF)) throw new Error("Informe um CPF válido.");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const existingCPF = await client.query(
      "SELECT id FROM users WHERE cpf=$1 LIMIT 1",
      [normalizedCPF]
    );
    if (existingCPF.rows[0]) throw new Error("Este CPF já possui uma conta cadastrada.");

    const claimedBonus = await client.query(
      "SELECT id FROM signup_bonus_claims WHERE cpf=$1 LIMIT 1",
      [normalizedCPF]
    );
    if (claimedBonus.rows[0]) throw new Error("Este CPF já utilizou o bônus de cadastro.");

    const setting = await client.query(
      "SELECT setting_value FROM site_settings WHERE setting_key='signup_bonus_amount'"
    );
    const signupBonus = Math.max(0, Math.round(Number(setting.rows[0]?.setting_value || 100) * 100) / 100);
    if (!Number.isFinite(signupBonus)) throw new Error("Valor do bônus de cadastro inválido.");

    const result = await client.query(
      `INSERT INTO users(username,password_hash,cpf,bonus_balance)
       VALUES($1,$2,$3,$4)
       RETURNING id,username,bonus_balance`,
      [name, hashPassword(password), normalizedCPF, signupBonus]
    );

    if (signupBonus > 0) {
      await client.query(
        `INSERT INTO transactions(user_id,type,amount,balance_after,note)
         VALUES($1,'signup_bonus',$2,$2,$3)`,
        [result.rows[0].id, signupBonus, "Bônus de cadastro concedido automaticamente."]
      );
    }

    await client.query(
      `INSERT INTO signup_bonus_claims(cpf,user_id,bonus_amount)
       VALUES($1,$2,$3)`,
      [normalizedCPF, result.rows[0].id, signupBonus]
    );

    await client.query("COMMIT");
    return result.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    if (error?.code === "23505" && (error?.constraint === "uq_users_cpf" || error?.constraint === "signup_bonus_claims_cpf_key")) {
      throw new Error("Este CPF já possui uma conta cadastrada ou já utilizou o bônus de cadastro.");
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function loginPlayer({ username, password }) {
  const result = await pool.query("SELECT id,username,password_hash,is_banned,is_deleted,banned_reason FROM users WHERE username=$1",[String(username || "").trim()]);
  const user=result.rows[0];
  if (!user || !verifyPassword(password,user.password_hash)) throw new Error("Usuário ou senha inválidos.");
  if (user.is_deleted) throw new Error("Usuário removido pelo administrador.");
  if (user.is_banned) throw new Error(user.banned_reason ? `Usuário banido. Motivo: ${user.banned_reason}` : "Usuário banido.");
  const sessionId=await createSession({userId:user.id});
  return { user:{id:user.id,username:user.username}, sessionId };
}

export async function loginAdmin({ username, password }) {
  const name=String(username || "").trim();
  const configuredUser=process.env.ADMIN_USER || "admin";
  const configuredPassword=process.env.ADMIN_PASSWORD;
  let admin;
  if (configuredPassword && name===configuredUser && String(password)===configuredPassword) {
    const result=await pool.query(
      `INSERT INTO admins(username,password_hash) VALUES($1,$2)
       ON CONFLICT(username) DO UPDATE SET password_hash=EXCLUDED.password_hash
       RETURNING id,username`,
      [configuredUser,hashPassword(configuredPassword)]
    );
    admin=result.rows[0];
  } else {
    const result=await pool.query("SELECT id,username,password_hash FROM admins WHERE username=$1",[name]);
    admin=result.rows[0];
    if (!admin || !verifyPassword(password,admin.password_hash)) throw new Error("Credenciais administrativas inválidas.");
  }
  const sessionId=await createSession({adminId:admin.id});
  return { admin:{id:admin.id,username:admin.username}, sessionId };
}

export async function logout(req,res,kind="player") {
  const cookies=parseCookies(req);
  const name=kind==="admin"?"mybets_admin_session":"mybets_player_session";
  if (cookies[name]) await pool.query("DELETE FROM sessions WHERE id=$1",[cookies[name]]);
  clearSessionCookie(res,kind);
}

export { setSessionCookie };
