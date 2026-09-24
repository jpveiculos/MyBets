import { pool } from "./db.js";
import { grantBonus } from "./finance.js";

export async function listUsers() {
  const result=await pool.query(
    `SELECT id,username,cpf,cash_balance,bonus_balance,reserved_balance,deposit_principal_remaining,
            GREATEST(0,cash_balance-reserved_balance-deposit_principal_remaining) AS withdrawable_balance,
            (cash_balance+bonus_balance) AS total_balance,
            is_banned,banned_at,banned_reason,is_deleted,
            created_at,updated_at
       FROM users WHERE COALESCE(is_deleted,FALSE)=FALSE ORDER BY id DESC`
  );
  return result.rows;
}

export async function listDeposits() {
  const result=await pool.query(
    `SELECT d.*,u.username FROM deposits d
       JOIN users u ON u.id=d.user_id
      ORDER BY d.created_at DESC`
  );
  return result.rows;
}

export async function listWithdrawals() {
  const result=await pool.query(
    `SELECT w.*,u.username,u.cpf,u.cash_balance,u.bonus_balance,u.bonus_wager_progress,
            u.bonus_origin_amount,u.post_bonus_wager_requirement,u.post_bonus_wager_progress,
            u.withdrawal_bonus_lock
       FROM withdrawals w
       JOIN users u ON u.id=w.user_id
      ORDER BY w.created_at DESC`
  );
  return result.rows;
}

export async function approveDeposit({id,adminId,approvedAmount,adminNote=null}) {
  const client=await pool.connect();
  try {
    await client.query("BEGIN");

    const r=await client.query(`SELECT * FROM deposits WHERE id=$1 FOR UPDATE`,[id]);
    const d=r.rows[0];
    if(!d) throw new Error("Depósito não encontrado.");
    if(d.status!=="pending") throw new Error("Este depósito já foi processado.");

    const declaredAmount=Number(d.amount);
    const value=approvedAmount === undefined || approvedAmount === null || approvedAmount === ""
      ? declaredAmount
      : Math.round(Number(approvedAmount)*100)/100;

    if(!Number.isFinite(value) || value<=0) {
      throw new Error("O valor confirmado do depósito é inválido.");
    }

    const u=await client.query("SELECT * FROM users WHERE id=$1 FOR UPDATE",[d.user_id]);
    const user=u.rows[0];
    if(!user) throw new Error("Usuário não encontrado.");

    const bonusSetting=await client.query("SELECT setting_value FROM site_settings WHERE setting_key='deposit_bonus_percent'");
    const bonusPercent=Math.max(0,Number(bonusSetting.rows[0]?.setting_value ?? 100));
    if(!Number.isFinite(bonusPercent)) throw new Error("Percentual de bônus de depósito inválido.");
    const bonusValue=Math.round(value*bonusPercent)/100;
    const newCash=Number(user.cash_balance)+value;
    const depositPrincipalPercent=50;
    const depositPrincipalValue=Math.round(value*depositPrincipalPercent)/100;
    const newDepositPrincipal=Number(user.deposit_principal_remaining||0)+depositPrincipalValue;

    await client.query(
      `UPDATE users
          SET cash_balance=$1,deposit_principal_remaining=$2,updated_at=CURRENT_TIMESTAMP
        WHERE id=$3`,
      [newCash,newDepositPrincipal,d.user_id]
    );

    if(bonusValue>0){
      await grantBonus({
        client,
        userId:d.user_id,
        amount:bonusValue,
        type:"deposit_bonus",
        referenceId:id,
        note:`Bônus de depósito de ${bonusPercent.toFixed(2)}% aplicado sobre R$ ${value.toFixed(2)}.`
      });
    }

    await client.query(
      `UPDATE deposits
          SET status='approved',
              approved_amount=$1,
              admin_note=$2,
              approved_by=$3,
              approved_at=CURRENT_TIMESTAMP,
              updated_at=CURRENT_TIMESTAMP
        WHERE id=$4`,
      [value,adminNote,adminId,id]
    );

    await client.query(
      `INSERT INTO transactions(user_id,type,amount,balance_after,reference_id,note)
       VALUES($1,'deposit_approved',$2,$3,$4,$5)`,
      [
        d.user_id,
        value,
        newCash+Number(user.bonus_balance),
        id,
        `Depósito conferido e aprovado pelo administrador. Valor informado: R$ ${declaredAmount.toFixed(2)}; créditos: R$ ${value.toFixed(2)}; principal bloqueado para saque: R$ ${depositPrincipalValue.toFixed(2)} (50%); bônus de recarga: R$ ${bonusValue.toFixed(2)}.`
      ]
    );

    await client.query(
      `INSERT INTO audit_logs(actor_type,actor_id,action,target_type,target_id,details)
       VALUES('admin',$1,'deposit_approved','deposit',$2,$3)`,
      [
        adminId,
        id,
        JSON.stringify({declaredAmount,approvedAmount:value,depositPrincipalPercent,depositPrincipalValue,bonusPercent,bonusValue,adminNote})
      ]
    );

    await client.query("COMMIT");
    return {id,status:"approved",declaredAmount,approvedAmount:value,bonusPercent,bonusValue,totalCredited:value+bonusValue};
  } catch(e){
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export async function rejectDeposit({id,adminId,adminNote=null}) {
  const client=await pool.connect();
  try {
    await client.query("BEGIN");
    const r=await client.query(
      `UPDATE deposits
          SET status='rejected',
              admin_note=$1,
              rejected_by=$2,
              rejected_at=CURRENT_TIMESTAMP,
              updated_at=CURRENT_TIMESTAMP
        WHERE id=$3 AND status='pending'
        RETURNING id,user_id,amount`,
      [adminNote,adminId,id]
    );
    if(!r.rows[0]) throw new Error("Depósito não encontrado ou já processado.");

    await client.query(
      `INSERT INTO audit_logs(actor_type,actor_id,action,target_type,target_id,details)
       VALUES('admin',$1,'deposit_rejected','deposit',$2,$3)`,
      [adminId,id,JSON.stringify({declaredAmount:Number(r.rows[0].amount),adminNote})]
    );

    await client.query("COMMIT");
    return {id,status:"rejected"};
  } catch(e){
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export async function approveWithdrawal({id,adminId,adminNote=null}) {
  const client=await pool.connect();
  try {
    await client.query("BEGIN");
    const r=await client.query("SELECT * FROM withdrawals WHERE id=$1 FOR UPDATE",[id]);
    const w=r.rows[0];
    if(!w) throw new Error("Saque não encontrado.");
    if(w.status!=="pending") throw new Error("Este saque já foi processado.");
    const u=await client.query("SELECT * FROM users WHERE id=$1 FOR UPDATE",[w.user_id]);
    const user=u.rows[0];
    if(Number(user.bonus_balance)>0) throw new Error("O saque permanece bloqueado enquanto houver saldo de bônus.");
    if(Boolean(user.withdrawal_bonus_lock)) throw new Error("O saque permanece bloqueado até o cumprimento da meta de apostas.");
    if(Number(user.reserved_balance)<Number(w.amount)) throw new Error("Reserva de saldo inconsistente.");
    if(Number(user.cash_balance)<Number(w.amount)) throw new Error("Saldo em dinheiro insuficiente.");
    const newCash=Number(user.cash_balance)-Number(w.amount);
    const newReserved=Number(user.reserved_balance)-Number(w.amount);
    await client.query(`UPDATE users SET cash_balance=$1,reserved_balance=$2,updated_at=CURRENT_TIMESTAMP WHERE id=$3`,[newCash,newReserved,w.user_id]);
    await client.query(`UPDATE withdrawals SET status='approved',admin_note=$1,approved_by=$2,approved_at=CURRENT_TIMESTAMP,paid_by=$2,paid_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=$3`,[adminNote,adminId,id]);
    await client.query(`INSERT INTO transactions(user_id,type,amount,balance_after,reference_id,note)
       VALUES($1,'withdrawal_approved',$2,$3,$4,$5)`,
      [w.user_id,-Number(w.amount),newCash+Number(user.bonus_balance)-newReserved,id,"Saque aprovado e reserva consumida"]);
    await client.query("COMMIT");
    return {id,status:"approved"};
  } catch(e){await client.query("ROLLBACK");throw e} finally{client.release()}
}

export async function rejectWithdrawal({id,adminId,rejectionReason=null,adminNote=null}) {
  const client=await pool.connect();
  try {
    await client.query("BEGIN");
    const r=await client.query("SELECT * FROM withdrawals WHERE id=$1 FOR UPDATE",[id]);
    const w=r.rows[0];
    if(!w) throw new Error("Saque não encontrado.");
    if(w.status!=="pending") throw new Error("Este saque já foi processado.");
    const u=await client.query("SELECT * FROM users WHERE id=$1 FOR UPDATE",[w.user_id]);
    const user=u.rows[0];
    if(Number(user.reserved_balance)<Number(w.amount)) throw new Error("Reserva de saldo inconsistente.");
    const newReserved=Number(user.reserved_balance)-Number(w.amount);
    await client.query(`UPDATE users SET reserved_balance=$1,updated_at=CURRENT_TIMESTAMP WHERE id=$2`,[newReserved,w.user_id]);
    await client.query(`UPDATE withdrawals SET status='rejected',admin_note=$1,rejection_reason=$2,rejected_by=$3,rejected_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=$4`,[adminNote,rejectionReason,adminId,id]);
    await client.query(`INSERT INTO transactions(user_id,type,amount,balance_after,reference_id,note)
       VALUES($1,'withdrawal_released',$2,$3,$4,$5)`,
      [w.user_id,Number(w.amount),Number(user.cash_balance)+Number(user.bonus_balance)-newReserved,id,"Saque rejeitado; reserva liberada"]);
    await client.query("COMMIT");
    return {id,status:"rejected"};
  } catch(e){await client.query("ROLLBACK");throw e} finally{client.release()}
}

export async function adjustBalance({userId,amount,kind="cash",note=null,adminId}) {
  const value=Number(amount);
  if(!Number.isFinite(value)||value===0) throw new Error("Valor inválido.");
  if(!["cash","bonus"].includes(kind)) throw new Error("Tipo de saldo inválido.");
  const client=await pool.connect();
  try {
    await client.query("BEGIN");
    const r=await client.query("SELECT * FROM users WHERE id=$1 FOR UPDATE",[userId]);
    const u=r.rows[0]; if(!u) throw new Error("Usuário não encontrado.");

    // "+ saldo" segue a mesma regra financeira de uma recarga aprovada:
    // o percentual configurado em deposit_bonus_percent é aplicado automaticamente.
    if(kind==="cash" && value>0){
      const bonusSetting=await client.query("SELECT setting_value FROM site_settings WHERE setting_key='deposit_bonus_percent'");
      const bonusPercent=Math.max(0,Number(bonusSetting.rows[0]?.setting_value ?? 100));
      if(!Number.isFinite(bonusPercent)) throw new Error("Percentual de bônus de depósito inválido.");
      const bonusValue=Math.round(value*bonusPercent)/100;

      const newCash=Number(u.cash_balance)+value;
      const depositPrincipalValue=Math.round(value*50)/100;
      const newDepositPrincipal=Number(u.deposit_principal_remaining||0)+depositPrincipalValue;

      await client.query(
        `UPDATE users
            SET cash_balance=$1,deposit_principal_remaining=$2,updated_at=CURRENT_TIMESTAMP
          WHERE id=$3`,
        [newCash,newDepositPrincipal,userId]
      );

      if(bonusValue>0){
        await grantBonus({
          client,
          userId,
          amount:bonusValue,
          type:"deposit_bonus",
          note:note||`Bônus automático de ${bonusPercent.toFixed(2)}% aplicado ao saldo adicionado pelo administrador.`
        });
      }

      await client.query(
        `INSERT INTO transactions(user_id,type,amount,balance_after,note)
         VALUES($1,'admin_cash_adjustment',$2,$3,$4)`,
        [
          userId,
          value,
          newCash+Number(u.bonus_balance)+bonusValue-Number(u.reserved_balance),
          note||`Saldo adicionado pelo administrador com bônus automático de ${bonusPercent.toFixed(2)}%: R$ ${bonusValue.toFixed(2)}.`
        ]
      );
      await client.query(
        `INSERT INTO audit_logs(actor_type,actor_id,action,target_type,target_id,details)
         VALUES('admin',$1,'balance_adjustment','user',$2,$3)`,
        [adminId,userId,JSON.stringify({amount:value,kind,note,bonusPercent,bonusValue,depositPrincipalPercent:50,depositPrincipalValue})]
      );
      await client.query("COMMIT");
      return {userId,kind,amount:value,newBalance:newCash,bonusPercent,bonusValue,totalCredited:value+bonusValue};
    }

    if(kind==="bonus" && value>0){
      const granted=await grantBonus({
        client,
        userId,
        amount:value,
        type:"admin_bonus_adjustment",
        note:note||"Bônus promocional concedido pelo administrador."
      });
      await client.query(
        `INSERT INTO audit_logs(actor_type,actor_id,action,target_type,target_id,details)
         VALUES('admin',$1,'balance_adjustment','user',$2,$3)`,
        [adminId,userId,JSON.stringify({amount:value,kind,note})]
      );
      await client.query("COMMIT");
      return {userId,kind,amount:value,newBalance:granted.bonusBalance};
    }

    const column=kind==="cash"?"cash_balance":"bonus_balance";
    const next=Number(u[column])+value;
    if(next<0) throw new Error("O saldo não pode ficar negativo.");
    await client.query(`UPDATE users SET ${column}=$1,updated_at=CURRENT_TIMESTAMP WHERE id=$2`,[next,userId]);
    await client.query(
      `INSERT INTO transactions(user_id,type,amount,balance_after,note)
       VALUES($1,$2,$3,$4,$5)`,
      [userId,kind==="cash"?"admin_cash_adjustment":"admin_bonus_adjustment",value,next+Number(u[column==="cash_balance"?"bonus_balance":"cash_balance"]),note||"Ajuste manual do administrador"]);
    await client.query(
      `INSERT INTO audit_logs(actor_type,actor_id,action,target_type,target_id,details)
       VALUES('admin',$1,'balance_adjustment','user',$2,$3)`,
      [adminId,userId,JSON.stringify({amount:value,kind,note})]);
    await client.query("COMMIT");
    return {userId,kind,amount:value,newBalance:next};
  } catch(e){await client.query("ROLLBACK");throw e} finally{client.release()}
}

export async function getSettings() {
  const r=await pool.query("SELECT setting_key,setting_value,updated_at FROM site_settings ORDER BY setting_key");
  return r.rows;
}

export async function getPublicSettings() {
  const r=await pool.query(
    `SELECT setting_key,setting_value
       FROM site_settings
      WHERE setting_key IN ('pix_enabled','pix_key','pix_key_type','pix_receiver_name','pix_city','pix_description','pix_instructions')`
  );
  return Object.fromEntries(r.rows.map(row=>[row.setting_key,row.setting_value]));
}

export async function updateSetting(key,value) {
  const r=await pool.query(
    `INSERT INTO site_settings(setting_key,setting_value,updated_at)
     VALUES($1,$2,CURRENT_TIMESTAMP)
     ON CONFLICT(setting_key) DO UPDATE SET setting_value=EXCLUDED.setting_value,updated_at=CURRENT_TIMESTAMP
     RETURNING setting_key,setting_value,updated_at`,[String(key),String(value)]);
  return r.rows[0];
}


export async function banUser({userId,adminId,reason}) {
  const client=await pool.connect();
  try {
    await client.query("BEGIN");
    const cleanReason=String(reason||"").trim();
    if(!cleanReason) throw new Error("Informe o motivo do banimento.");
    const r=await client.query("SELECT id FROM users WHERE id=$1 AND COALESCE(is_deleted,FALSE)=FALSE FOR UPDATE",[userId]);
    if(!r.rows[0]) throw new Error("Usuário não encontrado.");
    await client.query("UPDATE users SET is_banned=TRUE,banned_at=CURRENT_TIMESTAMP,banned_reason=$1,updated_at=CURRENT_TIMESTAMP WHERE id=$2",[cleanReason,userId]);
    await client.query("DELETE FROM sessions WHERE user_id=$1",[userId]);
    await client.query("INSERT INTO audit_logs(actor_type,actor_id,action,target_type,target_id,details) VALUES('admin',$1,'user_banned','user',$2,$3)",[adminId,userId,JSON.stringify({reason:cleanReason})]);
    await client.query("COMMIT");
    return {userId,status:"banned"};
  } catch(e){await client.query("ROLLBACK");throw e} finally{client.release()}
}

export async function unbanUser({userId,adminId}) {
  const client=await pool.connect();
  try {
    await client.query("BEGIN");
    const r=await client.query("SELECT id FROM users WHERE id=$1 AND COALESCE(is_deleted,FALSE)=FALSE FOR UPDATE",[userId]);
    if(!r.rows[0]) throw new Error("Usuário não encontrado.");
    await client.query("UPDATE users SET is_banned=FALSE,banned_at=NULL,banned_reason=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=$1",[userId]);
    await client.query("INSERT INTO audit_logs(actor_type,actor_id,action,target_type,target_id,details) VALUES('admin',$1,'user_unbanned','user',$2,'{}')",[adminId,userId]);
    await client.query("COMMIT");
    return {userId,status:"active"};
  } catch(e){await client.query("ROLLBACK");throw e} finally{client.release()}
}

export async function deleteUser({userId,adminId}) {
  const client=await pool.connect();
  try {
    await client.query("BEGIN");
    const r=await client.query("SELECT id,username FROM users WHERE id=$1 AND COALESCE(is_deleted,FALSE)=FALSE FOR UPDATE",[userId]);
    if(!r.rows[0]) throw new Error("Usuário não encontrado.");
    await client.query("UPDATE users SET is_deleted=TRUE,is_banned=TRUE,banned_at=CURRENT_TIMESTAMP,banned_reason=$1,updated_at=CURRENT_TIMESTAMP WHERE id=$2",["Usuário removido pelo administrador.",userId]);
    await client.query("DELETE FROM sessions WHERE user_id=$1",[userId]);
    await client.query("INSERT INTO audit_logs(actor_type,actor_id,action,target_type,target_id,details) VALUES('admin',$1,'user_deleted','user',$2,$3)",[adminId,userId,JSON.stringify({username:r.rows[0].username})]);
    await client.query("COMMIT");
    return {userId,status:"deleted"};
  } catch(e){await client.query("ROLLBACK");throw e} finally{client.release()}
}
