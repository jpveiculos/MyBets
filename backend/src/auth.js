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

function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", "mybets_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0");
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
      `SELECT s.id, u.id AS user_id, u.username
         FROM sessions s
         JOIN users u ON u.id=s.user_id
        WHERE s.id=$1 AND s.expires_at>CURRENT_TIMESTAMP`,
      [cookies.mybets_player_session]
    );
    if (!result.rows[0]) return res.status(401).json({ message:"Sessão do jogador inválida ou expirada." });
    req.user = { id: result.rows[0].user_id, username: result.rows[0].username };
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

export async function register({ username, password }) {
  const name = String(username || "").trim();
  if (!/^[A-Za-z0-9_.-]{3,50}$/.test(name)) throw new Error("Usuário inválido.");
  if (String(password || "").length < 6) throw new Error("A senha deve ter pelo menos 6 caracteres.");
  const result = await pool.query(
    `INSERT INTO users(username,password_hash) VALUES($1,$2)
     RETURNING id,username`,
    [name, hashPassword(password)]
  );
  return result.rows[0];
}

export async function loginPlayer({ username, password }) {
  const result = await pool.query("SELECT id,username,password_hash FROM users WHERE username=$1",[String(username || "").trim()]);
  const user=result.rows[0];
  if (!user || !verifyPassword(password,user.password_hash)) throw new Error("Usuário ou senha inválidos.");
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

export async function logout(req,res) {
  const cookies=parseCookies(req);
  if (cookies.mybets_session) await pool.query("DELETE FROM sessions WHERE id=$1",[cookies.mybets_session]);
  clearSessionCookie(res);
}

export { setSessionCookie };
