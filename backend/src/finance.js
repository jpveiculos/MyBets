import { pool } from "./db.js";
import { sendAdminPush } from "./push.js";

export const DEPOSIT_BONUS_PERCENT = 10;

function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error("Valor financeiro inválido.");
  return Math.round(n * 100) / 100;
}

export async function getAccount(userId) {
  const result = await pool.query(
    `SELECT id, username,
            cash_balance,
            reserved_balance,
            play_credits,
            (cash_balance + play_credits) AS total_balance,
            play_credits AS available_balance,
            GREATEST(0, cash_balance - reserved_balance) AS withdrawable_balance,
            play_credits AS withdrawal_unlock_remaining
       FROM users
      WHERE id = $1`,
    [userId]
  );
  return result.rows[0] || null;
}

export async function grantBonus({client,userId,amount,type="promotional_bonus",note=null,referenceId=null}) {
  const value = money(amount);
  if (value <= 0) throw new Error("O valor do bônus deve ser maior que zero.");

  const result = await client.query(
    "SELECT id,play_credits FROM users WHERE id=$1 FOR UPDATE",
    [userId]
  );
  const user = result.rows[0];
  if (!user) throw new Error("Usuário não encontrado.");

  const newCredits = money(Number(user.play_credits || 0) + value);

  await client.query(
    "UPDATE users SET play_credits=$1,updated_at=CURRENT_TIMESTAMP WHERE id=$2",
    [newCredits,userId]
  );

  await client.query(
    "INSERT INTO transactions(user_id,type,amount,balance_after,reference_id,note) VALUES($1,$2,$3,$4,$5,$6)",
    [userId,type,value,newCredits,referenceId,note||"Créditos promocionais concedidos."]
  );

  return {bonusValue:value,playCredits:newCredits};
}

export async function addDepositCredits({client,userId,amount,referenceId=null}) {
  const value = money(amount);
  if (value <= 0) throw new Error("O valor do depósito deve ser maior que zero.");

  const result = await client.query(
    "SELECT id,play_credits FROM users WHERE id=$1 FOR UPDATE",
    [userId]
  );
  const user = result.rows[0];
  if (!user) throw new Error("Usuário não encontrado.");

  const settingsResult = await client.query("SELECT setting_value FROM site_settings WHERE setting_key=$1 LIMIT 1",["deposit_bonus_percent"]);
  const bonusPercent = Number(settingsResult.rows[0]?.setting_value ?? DEPOSIT_BONUS_PERCENT);
  if (!Number.isFinite(bonusPercent) || bonusPercent < 0) throw new Error("A porcentagem de bônus de depósito está inválida.");
  const multiplier = 1 + (bonusPercent / 100);
  const creditsAdded = money(value * multiplier);
  const newCredits = money(Number(user.play_credits || 0) + creditsAdded);

  await client.query(
    "UPDATE users SET play_credits=$1,updated_at=CURRENT_TIMESTAMP WHERE id=$2",
    [newCredits,userId]
  );

  await client.query(
    `INSERT INTO transactions(user_id,type,amount,balance_after,reference_id,note)
     VALUES($1,'deposit_credits',$2,$3,$4,$5)`,
    [userId,creditsAdded,newCredits,referenceId,`Depósito de R$ ${value.toFixed(2)} convertido em ${creditsAdded.toFixed(2)} créditos para jogar (depósito + ${bonusPercent.toFixed(2)}% de bônus).`]
  );

  return {depositAmount:value,bonusPercent,creditsAdded,newPlayCredits:newCredits};
}

export async function purchasePlayCredits({userId,amount}) {
  const value=money(amount);
  if (value <= 0) throw new Error("Informe um valor válido para comprar créditos.");

  const client=await pool.connect();
  try {
    await client.query("BEGIN");
    const result=await client.query(
      `SELECT id,cash_balance,reserved_balance,play_credits
         FROM users WHERE id=$1 FOR UPDATE`,
      [userId]
    );
    const user=result.rows[0];
    if(!user) throw new Error("Usuário não encontrado.");

    const availableCash=Math.max(0,Number(user.cash_balance||0)-Number(user.reserved_balance||0));
    if(value>availableCash) throw new Error("O valor informado é maior que o saldo disponível para saque.");

    const newCash=money(Number(user.cash_balance||0)-value);
    const newCredits=money(Number(user.play_credits||0)+value);

    await client.query(
      `UPDATE users
          SET cash_balance=$1,play_credits=$2,updated_at=CURRENT_TIMESTAMP
        WHERE id=$3`,
      [newCash,newCredits,userId]
    );

    await client.query(
      `INSERT INTO transactions(user_id,type,amount,balance_after,note)
       VALUES($1,'credits_purchase',$2,$3,$4)`,
      [userId,value,newCash,`Compra de créditos para jogar: R$ ${value.toFixed(2)} convertido em ${value.toFixed(2)} créditos.`]
    );

    await client.query("COMMIT");
    return {
      amount:value,
      creditsAdded:value,
      newCashBalance:newCash,
      newPlayCredits:newCredits,
      availableCash:money(newCash-Number(user.reserved_balance||0))
    };
  } catch(error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function consumePlayCredits({client,userId,betAmount}) {
  const bet = money(betAmount);
  if (bet <= 0) throw new Error("O valor da aposta deve ser maior que zero.");

  const result = await client.query(
    "SELECT id,play_credits FROM users WHERE id=$1 FOR UPDATE",
    [userId]
  );
  const user = result.rows[0];
  if (!user) throw new Error("Usuário não encontrado.");

  const credits = money(user.play_credits || 0);
  if (credits < bet) throw new Error("Créditos para jogar insuficientes.");

  const remaining = money(credits - bet);

  await client.query(
    "UPDATE users SET play_credits=$1,updated_at=CURRENT_TIMESTAMP WHERE id=$2",
    [remaining,userId]
  );

  return remaining;
}

export async function addWithdrawableWinnings({client,userId,amount}) {
  const value = money(amount);
  if (value <= 0) return 0;

  const result = await client.query(
    "SELECT id,cash_balance FROM users WHERE id=$1 FOR UPDATE",
    [userId]
  );
  const user = result.rows[0];
  if (!user) throw new Error("Usuário não encontrado.");

  const newCash = money(Number(user.cash_balance || 0) + value);

  await client.query(
    "UPDATE users SET cash_balance=$1,updated_at=CURRENT_TIMESTAMP WHERE id=$2",
    [newCash,userId]
  );

  return newCash;
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

  const deposit = result.rows[0];
  const player = await pool.query("SELECT username FROM users WHERE id=$1",[userId]);
  const username = player.rows[0]?.username || `ID #${userId}`;
  const pending = await pool.query("SELECT (SELECT COUNT(*) FROM deposits WHERE status='pending')::int + (SELECT COUNT(*) FROM withdrawals WHERE status='pending')::int AS count");
  try {
    await sendAdminPush({title:"MyBets • Novo depósito",body:`Jogador ${username} • depósito #${deposit.id} aguardando conferência.`,tag:"new-deposit",unreadCount:Number(pending.rows[0].count)});
  } catch (error) {
    console.error("Falha ao enviar notificação de novo depósito:", error);
  }
  return deposit;
}

export async function requestWithdrawal({ userId, amount, pixKey, playerNote = null }) {
  const value = money(amount);
  if (value <= 0) throw new Error("O valor do saque deve ser maior que zero.");
  if (!pixKey || !String(pixKey).trim()) throw new Error("A chave Pix é obrigatória.");

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const userResult = await client.query(
      `SELECT id, cash_balance, reserved_balance, play_credits
         FROM users
        WHERE id = $1
        FOR UPDATE`,
      [userId]
    );

    const user = userResult.rows[0];
    if (!user) throw new Error("Usuário não encontrado.");

    const availableCash = Math.max(0, Number(user.cash_balance) - Number(user.reserved_balance));
    if (value > availableCash) {
      throw new Error("O valor solicitado é maior que o saldo disponível para saque.");
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
        availableCash - value,
        withdrawal.rows[0].id,
        "Valor reservado para saque"
      ]
    );

    await client.query("COMMIT");
    const pending=await pool.query("SELECT (SELECT COUNT(*) FROM deposits WHERE status='pending')::int + (SELECT COUNT(*) FROM withdrawals WHERE status='pending')::int AS count");
    try {
      await sendAdminPush({title:"MyBets • Novo saque",body:`Novo saque #${withdrawal.rows[0].id} aguardando análise.`,tag:"new-withdrawal",unreadCount:Number(pending.rows[0].count)});
    } catch (error) {
      console.error("Falha ao enviar notificação de novo saque:", error);
    }
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
