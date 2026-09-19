import { pool } from "./db.js";

function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error("Valor financeiro inválido.");
  return Math.round(n * 100) / 100;
}

export async function getAccount(userId) {
  const result = await pool.query(
    `SELECT id, username,
            cash_balance, bonus_balance, reserved_balance,
            (cash_balance + bonus_balance) AS total_balance,
            (cash_balance - reserved_balance + bonus_balance) AS available_balance,
            bonus_wager_progress
       FROM users
      WHERE id = $1`,
    [userId]
  );
  return result.rows[0] || null;
}

export async function requestDeposit({ userId, amount, playerNote = null }) {
  const value = money(amount);
  if (value <= 0) throw new Error("O valor do depósito deve ser maior que zero.");
  const enabled = await pool.query("SELECT setting_value FROM site_settings WHERE setting_key='pix_enabled'");
  if (String(enabled.rows[0]?.setting_value || "true") !== "true") throw new Error("Depósitos via Pix estão desativados.");

  const result = await pool.query(
    `INSERT INTO deposits (user_id, amount, player_note)
     VALUES ($1, $2, $3)
     RETURNING id, user_id, amount, status, payment_method, created_at`,
    [userId, value, playerNote]
  );

  return result.rows[0];
}

export async function requestWithdrawal({ userId, amount, pixKey, playerNote = null }) {
  const value = money(amount);
  if (value <= 0) throw new Error("O valor do saque deve ser maior que zero.");
  if (!pixKey || !String(pixKey).trim()) throw new Error("A chave Pix é obrigatória.");

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const userResult = await client.query(
      `SELECT id, cash_balance, bonus_balance, reserved_balance,
              bonus_wager_progress
         FROM users
        WHERE id = $1
        FOR UPDATE`,
      [userId]
    );

    const user = userResult.rows[0];
    if (!user) throw new Error("Usuário não encontrado.");

    const availableCash = Number(user.cash_balance) - Number(user.reserved_balance);
    if (value > availableCash) {
      throw new Error("Saldo disponível insuficiente para o saque.");
    }

    const requirement = await client.query(
      "SELECT setting_value FROM site_settings WHERE setting_key = 'bonus_wager_requirement'"
    );
    const wagerRequirement = Number(requirement.rows[0]?.setting_value || 0);

    if (Number(user.bonus_balance) > 0 && Number(user.bonus_wager_progress) < wagerRequirement) {
      throw new Error("O requisito de movimentação do bônus ainda não foi cumprido.");
    }

    await client.query(
      `UPDATE users
          SET reserved_balance = reserved_balance + $1,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $2`,
      [value, userId]
    );

    const withdrawal = await client.query(
      `INSERT INTO withdrawals
        (user_id, amount, pix_key, player_note)
       VALUES ($1, $2, $3, $4)
       RETURNING id, user_id, amount, status, withdrawal_method, pix_key, created_at`,
      [userId, value, String(pixKey).trim(), playerNote]
    );

    await client.query(
      `INSERT INTO transactions
        (user_id, type, amount, balance_after, reference_id, note)
       VALUES ($1, 'withdrawal_reserved', $2, $3, $4, $5)`,
      [
        userId,
        value,
        Number(user.cash_balance) + Number(user.bonus_balance) - Number(user.reserved_balance) - value,
        withdrawal.rows[0].id,
        "Saldo reservado para saque"
      ]
    );

    await client.query("COMMIT");
    return withdrawal.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}


export async function getTransactions(userId) {
  const result = await pool.query(
    `SELECT id,type,amount,balance_after,reference_id,note,created_at
       FROM transactions WHERE user_id=$1
       ORDER BY created_at DESC,id DESC LIMIT 200`,
    [userId]
  );
  return result.rows;
}
