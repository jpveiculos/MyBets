import { randomBytes, randomInt } from "node:crypto";
import { pool } from "../db.js";
import { consumePlayCredits, addWithdrawableWinnings } from "../finance.js";

const money = value => { const n = Number(value); if (!Number.isFinite(n)) throw new Error("Valor financeiro inválido."); return Math.round(n * 100) / 100; };

const DEFAULT_GROUP_ROULETTE_CONFIG = { enabled: true, maxPlayers: 10, stakeOptions: [1, 2, 5, 10, 20], prizePercent: 100 };

export async function getGroupRouletteConfig() {
  const result = await pool.query("SELECT setting_key,setting_value FROM site_settings WHERE setting_key = ANY($1::text[])", [["group_roulette_enabled", "group_roulette_max_players", "group_roulette_stakes", "group_roulette_prize_percent"]]);
  const values = Object.fromEntries(result.rows.map(row => [row.setting_key, row.setting_value]));
  let stakeOptions = DEFAULT_GROUP_ROULETTE_CONFIG.stakeOptions;
  try { const parsed = JSON.parse(values.group_roulette_stakes || ""); if (Array.isArray(parsed) && parsed.length) stakeOptions = parsed.map(Number); } catch {}
  return { enabled: String(values.group_roulette_enabled ?? "true").toLowerCase() === "true", maxPlayers: Number(values.group_roulette_max_players || 10), stakeOptions, prizePercent: Number(values.group_roulette_prize_percent ?? 100) };
}
export async function updateGroupRouletteConfig({ config, adminId }) {
  const enabled = config?.enabled === true || String(config?.enabled).toLowerCase() === "true";
  const maxPlayers = Number(config?.maxPlayers), prizePercent = Number(config?.prizePercent);
  const stakeOptions = Array.isArray(config?.stakeOptions) ? [...new Set(config.stakeOptions.map(v => Math.round(Number(v)*100)/100))].sort((a,b)=>a-b) : [];
  if (!Number.isInteger(maxPlayers) || maxPlayers < 2 || maxPlayers > 100) throw new Error("A quantidade de participantes deve ficar entre 2 e 100.");
  if (!Number.isFinite(prizePercent) || prizePercent < 1 || prizePercent > 100) throw new Error("O percentual do prêmio deve ficar entre 1% e 100%.");
  if (!stakeOptions.length || stakeOptions.length > 10 || stakeOptions.some(v => !Number.isFinite(v) || v < 0.01 || v > 10000)) throw new Error("Informe de 1 a 10 valores de participação entre R$ 0,01 e R$ 10.000,00.");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const settings = [["group_roulette_enabled",String(enabled)],["group_roulette_max_players",String(maxPlayers)],["group_roulette_stakes",JSON.stringify(stakeOptions)],["group_roulette_prize_percent",String(prizePercent)]];
    for (const [key,value] of settings) await client.query("INSERT INTO site_settings(setting_key,setting_value,updated_at) VALUES($1,$2,CURRENT_TIMESTAMP) ON CONFLICT(setting_key) DO UPDATE SET setting_value=EXCLUDED.setting_value,updated_at=CURRENT_TIMESTAMP",[key,value]);
    await client.query("INSERT INTO audit_logs(actor_type,actor_id,action,target_type,target_id,details) VALUES('admin',$1,'group_roulette_config_updated','site','group_roulette',$2)",[adminId,JSON.stringify({enabled,maxPlayers,stakeOptions,prizePercent})]);
    await client.query("COMMIT"); return {enabled,maxPlayers,stakeOptions,prizePercent};
  } catch(error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

const newRoomCode = () => randomBytes(5).toString("hex").toUpperCase();

async function tableById(client, id) {
  const result = await client.query("SELECT t.*, (SELECT COUNT(*)::int FROM group_roulette_table_players p WHERE p.table_id=t.id) AS player_count FROM group_roulette_tables t WHERE t.id=$1", [id]);
  const row = result.rows[0]; if (!row) return null;
  const p = await client.query("SELECT username_snapshot AS username, seat_number AS \"seatNumber\", status FROM group_roulette_table_players WHERE table_id=$1 ORDER BY seat_number", [id]);
  return { id:Number(row.id), roomCode:row.room_code, stakeAmount:Number(row.stake_amount), maxPlayers:Number(row.max_players), playerCount:Number(row.player_count), status:row.status, players:p.rows.map(x=>({username:x.username,seatNumber:Number(x.seatNumber),status:x.status})), winnerSeat:row.winning_seat == null ? null : Number(row.winning_seat), winnerUsername:row.winner_username || null, prizeAmount:row.prize_amount == null ? null : Number(row.prize_amount), createdAt:row.created_at, startedAt:row.started_at, finishedAt:row.finished_at };
}

export async function getGroupRouletteLobby() {
  const config = await getGroupRouletteConfig();
  const waiting = await pool.query("SELECT t.*, COUNT(p.id)::int AS player_count, COALESCE(json_agg(json_build_object('username',p.username_snapshot,'seatNumber',p.seat_number) ORDER BY p.seat_number) FILTER (WHERE p.id IS NOT NULL), '[]'::json) AS players FROM group_roulette_tables t LEFT JOIN group_roulette_table_players p ON p.table_id=t.id AND p.status='paid' WHERE t.status='waiting' GROUP BY t.id ORDER BY t.created_at ASC LIMIT 20");
  const finished = await pool.query("SELECT * FROM group_roulette_tables WHERE status='finished' ORDER BY finished_at DESC LIMIT 8");
  return { enabled:config.enabled, maxPlayers:config.maxPlayers, allowedStakes:config.stakeOptions, prizePercent:config.prizePercent, waitingTables:waiting.rows.map(r=>({id:Number(r.id),roomCode:r.room_code,stakeAmount:Number(r.stake_amount),maxPlayers:Number(r.max_players),playerCount:Number(r.player_count),status:r.status,players:(r.players||[]).map(p=>({username:p.username,seatNumber:Number(p.seatNumber),status:"paid"})),winnerSeat:null,winnerUsername:null,prizeAmount:null,createdAt:r.created_at})), recentResults:finished.rows.map(r=>({id:Number(r.id),roomCode:r.room_code,stakeAmount:Number(r.stake_amount),maxPlayers:Number(r.max_players),playerCount:Number(r.max_players),status:r.status,players:[],winnerSeat:Number(r.winning_seat),winnerUsername:r.winner_username,prizeAmount:Number(r.prize_amount),createdAt:r.created_at,finishedAt:r.finished_at})) };
}

export async function getGroupRouletteTableByCode(roomCode) {
  const code=String(roomCode||"").trim().toUpperCase(); if(!/^[A-F0-9]{10}$/.test(code)) return null;
  const r=await pool.query("SELECT id FROM group_roulette_tables WHERE room_code=$1",[code]); return r.rows[0] ? tableById(pool,r.rows[0].id) : null;
}

export async function getMyGroupRouletteTable(userId) {
  const r=await pool.query("SELECT t.id FROM group_roulette_table_players p JOIN group_roulette_tables t ON t.id=p.table_id WHERE p.user_id=$1 ORDER BY p.joined_at DESC,p.id DESC LIMIT 1",[userId]); return r.rows[0] ? tableById(pool,r.rows[0].id) : null;
}

export async function joinGroupRoulette({userId,stakeAmount,roomCode=null}) {
  const config = await getGroupRouletteConfig();
  if (!config.enabled) throw new Error("A Roleta em Grupo está temporariamente desativada.");
  const stake=money(stakeAmount); if(!config.stakeOptions.includes(stake) && !roomCode) throw new Error("Escolha um dos valores de participação disponíveis.");
  const client=await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",["group-roulette:"+stake.toFixed(2)]);
    const ur=await client.query("SELECT id,username,play_credits,cash_balance,reserved_balance FROM users WHERE id=$1 AND is_banned=FALSE AND is_deleted=FALSE FOR UPDATE",[userId]);
    const user=ur.rows[0]; if(!user) throw new Error("Usuário não encontrado ou indisponível.");
    const active=await client.query("SELECT t.id FROM group_roulette_table_players p JOIN group_roulette_tables t ON t.id=p.table_id WHERE p.user_id=$1 AND p.status='paid' AND t.status='waiting' LIMIT 1",[userId]);
    if(active.rows[0]) { const table=await tableById(client,active.rows[0].id); await client.query("COMMIT"); return {table,alreadyJoined:true}; }
    const credits=money(user.play_credits||0); if(credits<stake) throw new Error("Créditos insuficientes. Adicione créditos na sua conta antes de entrar na mesa.");
    let tableId=null;
    if(roomCode) {
      const requested=await client.query("SELECT id,stake_amount,status,max_players FROM group_roulette_tables WHERE room_code=$1 FOR UPDATE",[String(roomCode).trim().toUpperCase()]);
      if(!requested.rows[0]) throw new Error("Esta mesa não foi encontrada.");
      if(requested.rows[0].status!=="waiting") throw new Error("Esta rodada já terminou. Entre na fila para a próxima rodada.");
      if(money(requested.rows[0].stake_amount)!==stake) throw new Error("O valor de entrada não corresponde ao valor desta mesa.");
      const occupied=await client.query("SELECT COUNT(*)::int AS count FROM group_roulette_table_players WHERE table_id=$1 AND status='paid'",[requested.rows[0].id]);
      if(Number(occupied.rows[0].count)>=Number(requested.rows[0].max_players)) throw new Error("Esta mesa está cheia. Entre na fila para a próxima mesa."); tableId=requested.rows[0].id;
    } else {
      const available=await client.query("SELECT t.id FROM group_roulette_tables t WHERE t.status='waiting' AND t.stake_amount=$1 AND (SELECT COUNT(*) FROM group_roulette_table_players p WHERE p.table_id=t.id AND p.status='paid') < t.max_players ORDER BY t.created_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED",[stake]);
      if(available.rows[0]) tableId=available.rows[0].id;
      else { const created=await client.query("INSERT INTO group_roulette_tables(room_code,stake_amount,max_players,status) VALUES($1,$2,$3,'waiting') RETURNING id",[newRoomCode(),stake,config.maxPlayers]); tableId=created.rows[0].id; }
    }
    const tableConfig=await client.query("SELECT max_players FROM group_roulette_tables WHERE id=$1",[tableId]);
    const tableMaxPlayers=Number(tableConfig.rows[0]?.max_players||config.maxPlayers);
    const seat=await client.query("SELECT s.n AS seat_number FROM generate_series(1,$2) AS s(n) WHERE NOT EXISTS (SELECT 1 FROM group_roulette_table_players p WHERE p.table_id=$1 AND p.seat_number=s.n) ORDER BY s.n LIMIT 1",[tableId,tableMaxPlayers]);
    if(!seat.rows[0]) throw new Error("Não há vaga disponível nesta mesa.");
    const remaining=await consumePlayCredits({client,userId,betAmount:stake});
    await client.query("INSERT INTO transactions(user_id,type,amount,balance_after,note) VALUES($1,'group_roulette_entry',$2,$3,$4)",[userId,-stake,remaining,"Entrada paga na roleta em grupo."]);
    await client.query("INSERT INTO group_roulette_table_players(table_id,user_id,username_snapshot,seat_number,stake_amount,status) VALUES($1,$2,$3,$4,$5,'paid')",[tableId,userId,user.username,Number(seat.rows[0].seat_number),stake]);
    const count=await client.query("SELECT COUNT(*)::int AS count FROM group_roulette_table_players WHERE table_id=$1 AND status='paid'",[tableId]);
    if(Number(count.rows[0].count)===tableMaxPlayers) {
      const pr=await client.query("SELECT user_id,username_snapshot,seat_number FROM group_roulette_table_players WHERE table_id=$1 AND status='paid' ORDER BY seat_number FOR UPDATE",[tableId]);
      const players=pr.rows, winner=players[randomInt(players.length)], prize=money(stake*tableMaxPlayers*config.prizePercent/100);
      const cashAfter=await addWithdrawableWinnings({client,userId:winner.user_id,amount:prize});
      const winnerUser=await client.query("SELECT reserved_balance FROM users WHERE id=$1",[winner.user_id]);
      const withdrawableAfter=money(cashAfter-Number(winnerUser.rows[0]?.reserved_balance||0));
      await client.query("UPDATE group_roulette_table_players SET status=CASE WHEN user_id=$2 THEN 'winner' ELSE 'lost' END WHERE table_id=$1 AND status='paid'",[tableId,winner.user_id]);
      await client.query("UPDATE group_roulette_tables SET status='finished',winning_seat=$2,winner_user_id=$3,winner_username=$4,prize_amount=$5,started_at=CURRENT_TIMESTAMP,finished_at=CURRENT_TIMESTAMP WHERE id=$1 AND status='waiting'",[tableId,winner.seat_number,winner.user_id,winner.username_snapshot,prize]);
      await client.query("INSERT INTO transactions(user_id,type,amount,balance_after,note) VALUES($1,'group_roulette_win',$2,$3,$4)",[winner.user_id,prize,withdrawableAfter,"Prêmio da roleta em grupo: mesa completa de 10 participantes."]);
    }
    const table=await tableById(client,tableId); await client.query("COMMIT"); return {table,alreadyJoined:false};
  } catch(error) { try { await client.query("ROLLBACK"); } catch {} throw error; } finally { client.release(); }
}

export async function leaveGroupRoulette({userId}) {
  const client=await pool.connect();
  try {
    await client.query("BEGIN");
    const r=await client.query("SELECT p.id AS player_id,p.table_id,p.stake_amount,t.room_code FROM group_roulette_table_players p JOIN group_roulette_tables t ON t.id=p.table_id WHERE p.user_id=$1 AND p.status='paid' AND t.status='waiting' ORDER BY p.joined_at DESC LIMIT 1 FOR UPDATE OF p,t",[userId]);
    if(!r.rows[0]) throw new Error("Você não tem uma vaga aguardando início para sair.");
    const e=r.rows[0], stake=money(e.stake_amount);
    const u=await client.query("UPDATE users SET play_credits=play_credits+$1,updated_at=CURRENT_TIMESTAMP WHERE id=$2 RETURNING play_credits",[stake,userId]);
    await client.query("DELETE FROM group_roulette_table_players WHERE id=$1",[e.player_id]);
    await client.query("INSERT INTO transactions(user_id,type,amount,balance_after,note) VALUES($1,'group_roulette_refund',$2,$3,$4)",[userId,stake,Number(u.rows[0].play_credits),"Devolução da entrada ao sair da mesa "+e.room_code+"."]);
    const remaining=await client.query("SELECT COUNT(*)::int AS count FROM group_roulette_table_players WHERE table_id=$1",[e.table_id]);
    if(Number(remaining.rows[0].count)===0) await client.query("DELETE FROM group_roulette_tables WHERE id=$1 AND status='waiting'",[e.table_id]);
    await client.query("COMMIT"); return {refunded:stake,roomCode:e.room_code};
  } catch(error) { try { await client.query("ROLLBACK"); } catch {} throw error; } finally { client.release(); }
}