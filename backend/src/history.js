import { pool } from "./db.js";

const DEFAULT_AUDIT_RETENTION_DAYS = 30;

export async function getUserHistory(userId) {
  const id = Number(userId);
  if (!Number.isInteger(id) || id <= 0) throw new Error("Usuário inválido.");

  const userResult = await pool.query(
    `SELECT id,username,cash_balance,bonus_balance,reserved_balance,
            (cash_balance+bonus_balance) AS total_balance,
            bonus_wager_progress,is_banned,is_deleted,created_at,updated_at
       FROM users WHERE id=$1`,
    [id]
  );
  const user = userResult.rows[0];
  if (!user) throw new Error("Usuário não encontrado.");

  const [transactions, deposits, withdrawals, spins, audits, bonusClaim] = await Promise.all([
    pool.query(`SELECT id,type,amount,balance_after,reference_id,note,created_at
                  FROM transactions WHERE user_id=$1 ORDER BY created_at DESC,id DESC`, [id]),
    pool.query(`SELECT id,amount,approved_amount,status,payment_method,player_note,admin_note,
                       approved_at,rejected_at,created_at,updated_at
                  FROM deposits WHERE user_id=$1 ORDER BY created_at DESC,id DESC`, [id]),
    pool.query(`SELECT id,amount,status,withdrawal_method,pix_key,player_note,admin_note,
                       rejection_reason,approved_at,paid_at,rejected_at,created_at,updated_at
                  FROM withdrawals WHERE user_id=$1 ORDER BY created_at DESC,id DESC`, [id]),
    pool.query(`SELECT id,game_id,result_code,result,multiplier,bet_amount,payout_amount,created_at
                  FROM spins WHERE user_id=$1 ORDER BY created_at DESC,id DESC`, [id]),
    pool.query(`SELECT id,actor_type,actor_id,action,target_type,target_id,details,created_at
                  FROM audit_logs
                 WHERE target_type='user' AND target_id=$1
                 ORDER BY created_at DESC,id DESC`, [id]),
    pool.query(`SELECT id,bonus_amount,created_at
                  FROM signup_bonus_claims WHERE user_id=$1
                 ORDER BY created_at DESC,id DESC LIMIT 1`, [id])
  ]);

  return {
    user,
    bonusClaim: bonusClaim.rows[0] || null,
    transactions: transactions.rows,
    deposits: deposits.rows,
    withdrawals: withdrawals.rows,
    spins: spins.rows,
    audits: audits.rows
  };
}

export async function searchTransactionHistory({ query="", type="", from="", to="", limit=500 } = {}) {
  const q = String(query || "").trim();
  const eventType = String(type || "").trim();
  const safeLimit = Math.min(Math.max(Number(limit) || 500, 1), 1000);
  const values = [];
  const where = [];

  if (q) {
    values.push(`%${q}%`);
    where.push(`u.username ILIKE $${values.length}`);
  }
  if (eventType) {
    values.push(eventType);
    where.push(`t.type=$${values.length}`);
  }
  if (from) {
    values.push(from);
    where.push(`t.created_at >= $${values.length}::date`);
  }
  if (to) {
    values.push(to);
    where.push(`t.created_at < ($${values.length}::date + INTERVAL '1 day')`);
  }

  values.push(safeLimit);
  const result = await pool.query(
    `SELECT t.id,t.user_id,u.username,t.type,t.amount,t.balance_after,
            t.reference_id,t.note,t.created_at
       FROM transactions t JOIN users u ON u.id=t.user_id
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY t.created_at DESC,t.id DESC LIMIT $${values.length}`,
    values
  );
  return result.rows;
}

export async function pruneOldAuditLogs() {
  const setting = await pool.query(
    "SELECT setting_value FROM site_settings WHERE setting_key='audit_log_retention_days'"
  );
  const configured = Number(setting.rows[0]?.setting_value);
  const days = Number.isFinite(configured) && configured >= 7 && configured <= 3650
    ? Math.floor(configured)
    : DEFAULT_AUDIT_RETENTION_DAYS;

  const result = await pool.query(
    "DELETE FROM audit_logs WHERE created_at < CURRENT_TIMESTAMP - ($1 * INTERVAL '1 day')",
    [days]
  );
  return { days, deleted: result.rowCount || 0 };
}
