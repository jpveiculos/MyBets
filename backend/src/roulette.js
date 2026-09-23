import { randomInt } from "node:crypto";
import { pool } from "./db.js";
import { applyPostBonusWager } from "./finance.js";

const TOTAL_SECTORS=64;
const GROUP_SIZE=4;
const PRIZE_SECTORS=TOTAL_SECTORS/GROUP_SIZE;
const LOSS_SECTORS=TOTAL_SECTORS-PRIZE_SECTORS;
const PRIZE_INDEXES=Array.from({length:TOTAL_SECTORS},(_,i)=>i).filter(i=>i%GROUP_SIZE===0);
const LOSS_INDEXES=Array.from({length:TOTAL_SECTORS},(_,i)=>i).filter(i=>i%GROUP_SIZE!==0);

// Configuração fixa da roleta: 4x 2, 4x 3, 4x 4, 3x 5 e 1x 10.
const DEFAULT_PRIZES=[2,3,4,5,2,3,4,5,2,3,4,5,2,3,4,10];

// Pesos dos multiplicadores dentro dos 16 setores de prêmio.
// Mantém o 10x com 0,25% de ocorrência no total da roleta.
const PRIZE_WEIGHTS={2:5.525,3:5.525,4:5,5:3.75,10:.2};

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
  const draw=randomInt(DRAW_DENOMINATOR);

  // 16 setores de prêmio e 48 setores de perda.
  if(draw>=PRIZE_SECTORS){
    return LOSS_INDEXES[randomInt(LOSS_INDEXES.length)];
  }

  const weightedGroups=Object.entries(PRIZE_WEIGHTS).map(([multiplier,weight])=>({
    multiplier:Number(multiplier),weight
  }));
  const totalWeight=weightedGroups.reduce((sum,item)=>sum+item.weight,0);
  let pick=(randomInt(1000000)/1000000)*totalWeight;
  let selected=weightedGroups[weightedGroups.length-1].multiplier;

  for(const group of weightedGroups){
    if(pick<group.weight){
      selected=group.multiplier;
      break;
    }
    pick-=group.weight;
  }

  const matching=PRIZE_INDEXES.filter((_,index)=>Number(DEFAULT_PRIZES[index])===selected);
  return matching[randomInt(matching.length)];
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
    prizeDistribution:{2:4,3:4,4:4,5:3,10:1},
    probability:{2:6.90625,3:6.90625,4:6.25,5:4.6875,10:.25}
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
    const r=await client.query(`SELECT id,username,cash_balance,bonus_balance,reserved_balance,bonus_wager_progress
      FROM users WHERE id=$1 FOR UPDATE`,[userId]);
    if(!r.rows.length)throw new Error("Usuário não encontrado.");
    const user=r.rows[0];
    const cash=Number(user.cash_balance||0);
    const bonus=Number(user.bonus_balance||0);
    const reserved=Number(user.reserved_balance||0);
    const available=Number((cash+bonus-reserved).toFixed(2));
    if(available<bet)throw new Error("Saldo disponível insuficiente.");

    const sector=sortearSetor();
    const position=PRIZE_INDEXES.indexOf(sector);
    const multiplier=position>=0?Number(prizes[position]):0;
    const payout=multiplier>0?Number((bet*multiplier).toFixed(2)):0;

    const bonusUsed=Math.min(bonus,bet);
    const cashUsed=bet-bonusUsed;
    const newBonus=Number((bonus-bonusUsed).toFixed(2));
    const newCash=Number((cash-cashUsed+payout).toFixed(2));
    const newBalance=Number((newBonus+newCash).toFixed(2));

    await applyPostBonusWager({client,user,betAmount:bet,bonusUsed});
    await client.query(`UPDATE users SET cash_balance=$1,bonus_balance=$2,updated_at=CURRENT_TIMESTAMP WHERE id=$3`,[newCash,newBonus,userId]);

    const spin=await client.query(`INSERT INTO spins(user_id,result,multiplier,bet_amount,payout_amount) VALUES($1,$2,$3,$4,$5) RETURNING id,created_at`,[userId,sector,multiplier,bet,payout]);
    const net=Number((payout-bet).toFixed(2));
    await client.query(`INSERT INTO transactions(user_id,type,amount,balance_after,reference_id,note) VALUES($1,$2,$3,$4,$5,$6)`,[
      userId,multiplier>0?"roulette_win":"roulette_loss",net,Number((newBalance-reserved).toFixed(2)),spin.rows[0].id,multiplier>0?`Roleta da sorte — ${multiplier}x`:"Roleta da sorte — perda"
    ]);
    await client.query("COMMIT");

    return {
      id:spin.rows[0].id,sector,resultType:multiplier>0?"prize":"loss",multiplier,prize:payout,
      netResult:net,betAmount:bet,totalSectors:TOTAL_SECTORS,prizeSectors:PRIZE_INDEXES,prizes
    };
  }catch(error){
    try{await client.query("ROLLBACK")}catch{}
    throw error;
  }finally{client.release()}
}
