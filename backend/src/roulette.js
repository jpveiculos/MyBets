import { randomInt } from "node:crypto";
import { pool } from "./db.js";
import { consumePlayCredits, addWithdrawableWinnings } from "./finance.js";

const TOTAL_SECTORS=80;
const GROUP_SIZE=5;
const PRIZE_SECTORS=TOTAL_SECTORS/GROUP_SIZE;
const LOSS_SECTORS=TOTAL_SECTORS-PRIZE_SECTORS;
const PRIZE_INDEXES=Array.from({length:TOTAL_SECTORS},(_,i)=>i).filter(i=>i%GROUP_SIZE===0);
const LOSS_INDEXES=Array.from({length:TOTAL_SECTORS},(_,i)=>i).filter(i=>i%GROUP_SIZE!==0);

// Configuração fixa da roleta: 4x 2, 4x 3, 4x 4 e 4x 5 em 16 grupos de prêmio.
const DEFAULT_PRIZES=[2,3,4,5,2,3,4,5,2,3,4,5,2,3,4,5];

const DEFAULT_MIN_BET=.50;
const DEFAULT_MAX_BET=100;
const DRAW_DENOMINATOR=TOTAL_SECTORS;

async function getSetting(key,fallback){
  const r=await pool.query("SELECT setting_value FROM site_settings WHERE setting_key=$1 LIMIT 1",[key]);
  return r.rows[0]?.setting_value??fallback;
}

async function getConfig(){
  const prizes=[...DEFAULT_PRIZES];
  const minRaw=Number(await getSetting("roulette_min_bet",String(DEFAULT_MIN_BET)));
  const maxRaw=Number(await getSetting("roulette_max_bet",String(DEFAULT_MAX_BET)));
  const minBet=Number.isFinite(minRaw)&&minRaw>=DEFAULT_MIN_BET?Number(minRaw.toFixed(2)):DEFAULT_MIN_BET;
  const maxBet=Number.isFinite(maxRaw)&&maxRaw>=minBet?Number(maxRaw.toFixed(2)):DEFAULT_MAX_BET;
  return {prizes,minBet,maxBet};
}

function sortearSetor(){
  // Cada um dos 80 setores tem exatamente a mesma probabilidade: 1/80.
  return randomInt(DRAW_DENOMINATOR);
}

export async function rouletteConfig(){
  const {prizes,minBet,maxBet}=await getConfig();
  return {
    id:"roulette",
    totalSectors:TOTAL_SECTORS,
    prizeSectors:PRIZE_SECTORS,
    lossSectors:LOSS_SECTORS,
    prizeIndexes:PRIZE_INDEXES,
    minBet,
    maxBet,
    prizes,
    prizeDistribution:{2:4,3:4,4:4,5:4},
    probability:{2:5,3:5,4:5,5:5}
  };
}

export async function spinRoulette({userId,betAmount}){
  const {prizes,minBet,maxBet}=await getConfig();
  const bet=Number(Number(betAmount).toFixed(2));
  if(!Number.isFinite(bet))throw new Error("Informe um valor de aposta válido.");
  if(bet<minBet)throw new Error(`A aposta mínima é R$ ${minBet.toFixed(2).replace(".",",")}.`);
  if(bet>maxBet)throw new Error(`A aposta máxima é R$ ${maxBet.toFixed(2).replace(".",",")}.`);

  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    const r=await client.query(
      "SELECT id,username,play_credits,cash_balance,reserved_balance FROM users WHERE id=$1 FOR UPDATE",
      [userId]
    );
    if(!r.rows.length)throw new Error("Usuário não encontrado.");
    const user=r.rows[0];
    if(Number(user.play_credits||0)<bet)throw new Error("Créditos para jogar insuficientes.");

    const sector=sortearSetor();
    const position=PRIZE_INDEXES.indexOf(sector);
    const multiplier=position>=0?Number(prizes[position]):0;
    const payout=multiplier>0?Number((bet*multiplier).toFixed(2)):0;

    const creditsAfter=await consumePlayCredits({client,userId,betAmount:bet});
    const cashAfter=payout>0?await addWithdrawableWinnings({client,userId,amount:payout}):Number(user.cash_balance||0);

    const spin=await client.query(
      `INSERT INTO spins(
         user_id,game_id,result,result_code,multiplier,bet_amount,payout_amount
       ) VALUES($1,'roulette',$2,$3,$4,$5,$6)
       RETURNING id,created_at`,
      [userId,sector,multiplier>0?'PRIZE':'LOSS',multiplier,bet,payout]
    );

    await client.query(
      "INSERT INTO transactions(user_id,type,amount,balance_after,reference_id,note) VALUES($1,$2,$3,$4,$5,$6)",
      [
        userId,
        multiplier>0?"roulette_win":"roulette_loss",
        payout,
        Number((cashAfter-Number(user.reserved_balance||0)).toFixed(2)),
        spin.rows[0].id,
        multiplier>0?`Roleta — ${multiplier}x`:"Roleta — perda"
      ]
    );

    await client.query("COMMIT");

    return {
      id:spin.rows[0].id,
      sector,
      resultType:multiplier>0?"prize":"loss",
      multiplier,
      prize:payout,
      netResult:Number((payout-bet).toFixed(2)),
      betAmount:bet,
      playCreditsAfter:creditsAfter,
      withdrawableBalanceAfter:cashAfter,
      totalSectors:TOTAL_SECTORS,
      prizeSectors:PRIZE_INDEXES,
      prizes
    };
  }catch(error){
    try{await client.query("ROLLBACK")}catch{}
    throw error;
  }finally{client.release()}
}
