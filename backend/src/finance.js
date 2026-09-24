import { pool } from "./db.js";
import { sendAdminPush } from "./push.js";

function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error("Valor financeiro inválido.");
  return Math.round(n * 100) / 100;
}

export async function getAccount(userId) {
  const result = await pool.query(
    `SELECT id, username,
            cash_balance, bonus_balance, reserved_balance, deposit_principal_remaining,
            (cash_balance + bonus_balance) AS total_balance,
            (cash_balance - reserved_balance + bonus_balance) AS available_balance,
            GREATEST(0, cash_balance - reserved_balance - deposit_principal_remaining) AS withdrawable_balance,
            bonus_wager_progress, bonus_origin_amount, post_bonus_wager_requirement,
            post_bonus_wager_progress, withdrawal_bonus_lock
       FROM users
      WHERE id = $1`,
    [userId]
  );
  return result.rows[0] || null;
}

export async function grantBonus({client,userId,amount,type="promotional_bonus",note=null,referenceId=null}) {
  const value=money(amount);
  if(value<=0) throw new Error("O valor do bônus deve ser maior que zero.");

  const result=await client.query(
    "SELECT id,cash_balance,bonus_balance,reserved_balance,bonus_origin_amount,post_bonus_wager_requirement,post_bonus_wager_progress FROM users WHERE id=$1 FOR UPDATE",
    [userId]
  );
  const user=result.rows[0];
  if(!user) throw new Error("Usuário não encontrado.");

  const newBonus=money(Number(user.bonus_balance||0)+value);
  const newOrigin=money(Number(user.bonus_origin_amount||0)+value);
  const newRequirement=money(Number(user.post_bonus_wager_requirement||0)+value);
  const newProgress=money(Math.min(newRequirement,Number(user.post_bonus_wager_progress||0)));

  await client.query(
    "UPDATE users SET bonus_balance=$1,bonus_origin_amount=$2,post_bonus_wager_requirement=$3,post_bonus_wager_progress=$4,withdrawal_bonus_lock=TRUE,updated_at=CURRENT_TIMESTAMP WHERE id=$5",
    [newBonus,newOrigin,newRequirement,newProgress,userId]
  );

  await client.query(
    "INSERT INTO transactions(user_id,type,amount,balance_after,reference_id,note) VALUES($1,$2,$3,$4,$5,$6)",
    [userId,type,value,money(Number(user.cash_balance||0)+newBonus-Number(user.reserved_balance||0)),referenceId,note||"Bônus promocional concedido."]
  );

  await client.query(
    `INSERT INTO bonus_events(
       user_id,type,amount,bonus_balance_after,bonus_origin_amount_after,
       post_bonus_wager_requirement_after,post_bonus_wager_progress_after,
       withdrawal_bonus_lock_after,reference_id,note
     ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      userId,type,value,newBonus,newOrigin,newRequirement,newProgress,
      true,referenceId,note||"Bônus promocional concedido."
    ]
  );

  return {bonusValue:value,bonusBalance:newBonus,bonusOriginAmount:newOrigin,postBonusWagerRequirement:newRequirement,postBonusWagerProgress:newProgress,withdrawalBonusLock:true};
}
export async function applyDepositPrincipalWager({client,user,cashUsed}) {
  const current=Number(user.deposit_principal_remaining||0);
  const used=Number(cashUsed||0);
  const remaining=Number(Math.max(0,current-used).toFixed(2));
  await client.query(
    "UPDATE users SET deposit_principal_remaining=$1,updated_at=CURRENT_TIMESTAMP WHERE id=$2",
    [remaining,user.id]
  );
  return remaining;
}

export async function applyPostBonusWager({client,user,betAmount,bonusUsed}) {
  const newBonus=Number((Number(user.bonus_balance||0)-Number(bonusUsed||0)).toFixed(2));
  let progress=Number(user.post_bonus_wager_progress||0),lock=Boolean(user.withdrawal_bonus_lock);
  const requirement=Number(user.post_bonus_wager_requirement||0);
  if(lock && newBonus<=0 && requirement>0){
    const wagerAfterBonus=Number(bonusUsed||0)>0?Math.max(0,Number(betAmount)-Number(bonusUsed)):Number(betAmount);
    progress=Number(Math.min(requirement,progress+wagerAfterBonus).toFixed(2));
    if(progress>=requirement)lock=false;
  }
  await client.query("UPDATE users SET post_bonus_wager_progress=$1,withdrawal_bonus_lock=$2,updated_at=CURRENT_TIMESTAMP WHERE id=$3",[progress,lock,user.id]);
  return {progress,requirement,lock};
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

  const deposit=result.rows[0];
  const player=await pool.query("SELECT username FROM users WHERE id=$1",[userId]);
  const username=player.rows[0]?.username||`ID #${userId}`;
  const pending=await pool.query("SELECT (SELECT COUNT(*) FROM deposits WHERE status='pending')::int + (SELECT COUNT(*) FROM withdrawals WHERE status='pending')::int AS count");
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
      `SELECT id, cash_balance, bonus_balance, reserved_balance, deposit_principal_remaining,
              bonus_wager_progress, withdrawal_bonus_lock, post_bonus_wager_progress, post_bonus_wager_requirement
         FROM users
        WHERE id = $1
        FOR UPDATE`,
      [userId]
    );

    const user = userResult.rows[0];
    if (!user) throw new Error("Usuário não encontrado.");

    const availableCash = Number(user.cash_balance) - Number(user.reserved_balance);
    const withdrawableCash = Math.max(0, availableCash - Number(user.deposit_principal_remaining||0));
    if (value > withdrawableCash) {
      throw new Error("Esse valor inclui a parte do depósito ainda bloqueada. Aposte 50% do valor depositado para liberar essa parte; depois de cumprir as regras do bônus, o saque poderá incluir os 50% liberados e os ganhos gerados nas apostas.");
    }

    if (Number(user.bonus_balance) > 0) {
      throw new Error("O saque está bloqueado enquanto houver saldo de bônus.");
    }
    if (Boolean(user.withdrawal_bonus_lock)) {
      const progress=Number(user.post_bonus_wager_progress||0), requirement=Number(user.post_bonus_wager_requirement||0);
      throw new Error("O saque está bloqueado. Aposte mais R$ "+Math.max(0,requirement-progress).toFixed(2).replace(".",",")+" para liberar.");
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
