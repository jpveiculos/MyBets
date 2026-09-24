import { randomInt } from "node:crypto";
import { pool } from "../db.js";
import { consumePlayCredits, addWithdrawableWinnings } from "../finance.js";

function money(value){const n=Number(value);if(!Number.isFinite(n))throw new Error("Valor financeiro inválido.");return Math.round(n*100)/100;}
function pickOutcome(table,scale){const ticket=randomInt(scale);let total=0;for(const item of table){total+=item.weight;if(ticket<total)return item;}return null;}
function shuffle(items){const a=[...items];for(let i=a.length-1;i>0;i--){const j=randomInt(i+1);[a[i],a[j]]=[a[j],a[i]];}return a;}
function buildGrid(config,outcome){
 const ids=config.symbols.map(s=>s.id);
 if(config.columns===3&&config.rows===1){
  if(outcome)return [outcome.symbol,outcome.symbol,outcome.symbol].map(id=>config.symbols.find(s=>s.id===id));
  const shuffled=shuffle(ids);return [shuffled[0],shuffled[1],shuffled[2]].map(id=>config.symbols.find(s=>s.id===id));
 }
 const poolIds=[];const winId=outcome&&outcome.symbol;
 if(winId)poolIds.push(winId,winId,winId);
 const others=ids.filter(id=>id!==winId);
 for(let i=poolIds.length;i<config.rows*config.columns;i++)poolIds.push(others[i%others.length]);
 return shuffle(poolIds).map(id=>config.symbols.find(s=>s.id===id));
}
export function validateConfig(config){
 const weightSum=config.outcomes.reduce((n,x)=>n+x.weight,0);
 const payoutSum=config.outcomes.reduce((n,x)=>n+x.weight*x.multiplier,0);
 if(payoutSum!==config.scale*config.rtpBps/10000)throw new Error("Matemática inválida em "+config.id+": RTP incompatível.");
 if(weightSum>=config.scale)throw new Error("Matemática inválida em "+config.id+": probabilidades excedem 100%.");
}
export function publicGameConfig(config){
 validateConfig(config);
 return {id:config.id,name:config.name,type:"SLOT",rows:config.rows,columns:config.columns,minBet:config.minBet,maxBet:config.maxBet,theoreticalRtp:config.rtpBps/10000,theoreticalHouseEdge:1-config.rtpBps/10000,symbols:config.symbols.map(x=>({id:x.id,label:x.label,multiplier:x.multiplier})),outcomes:config.outcomes.map(x=>({symbol:x.symbol,multiplier:x.multiplier,probability:x.weight/config.scale}))};
}
export async function spinGame(config,args){
 validateConfig(config);
 const bet=money(args.betAmount);
 if(!Number.isFinite(bet)||bet<config.minBet)throw new Error("A aposta mínima é R$ "+config.minBet.toFixed(2).replace(".",",")+".");
 if(bet>config.maxBet)throw new Error("A aposta máxima é R$ "+config.maxBet.toFixed(2).replace(".",",")+".");
 const client=await pool.connect();
 try{
  await client.query("BEGIN");
  const r=await client.query("SELECT id,username,play_credits,cash_balance,reserved_balance FROM users WHERE id=$1 FOR UPDATE",[args.userId]);
  if(!r.rows.length)throw new Error("Usuário não encontrado.");
  const user=r.rows[0];
  const credits=money(user.play_credits||0);
  if(credits<bet)throw new Error("Créditos para jogar insuficientes.");

  const outcome=pickOutcome(config.outcomes,config.scale);
  const multiplier=outcome?outcome.multiplier:0;
  const payout=money(bet*multiplier);
  const creditsAfter=await consumePlayCredits({client,userId:args.userId,betAmount:bet});
  const cashAfter=payout>0?await addWithdrawableWinnings({client,userId:args.userId,amount:payout}):money(user.cash_balance||0);

  const grid=buildGrid(config,outcome),resultCode=outcome?outcome.symbol:"LOSS";
  const spin=await client.query(
    \`INSERT INTO spins(
       user_id,game_id,result_code,result,multiplier,bet_amount,payout_amount
     ) VALUES($1,$2,$3,0,$4,$5,$6)
     RETURNING id,created_at\`,
    [args.userId,config.id,resultCode,multiplier,bet,payout,bet,cashAfter]
  );

  const net=money(payout-bet);
  await client.query(
    "INSERT INTO transactions(user_id,type,amount,balance_after,reference_id,note) VALUES($1,$2,$3,$4,$5,$6)",
    [args.userId,outcome?config.id+"_win":config.id+"_loss",payout,money(cashAfter-Number(user.reserved_balance||0)),spin.rows[0].id,outcome?config.name+" — "+multiplier+"x":"Aposta perdida"]
  );
  await client.query("COMMIT");

  return {
    id:spin.rows[0].id,
    gameId:config.id,
    grid:grid.map(s=>({id:s.id,label:s.label})),
    won:Boolean(outcome),
    prize:payout,
    netResult:net,
    multiplier,
    winningSymbol:outcome?outcome.symbol:null,
    winningLabel:outcome?outcome.label:null,
    winningCount:outcome?3:0,
    betAmount:bet,
    playCreditsAfter:creditsAfter,
    withdrawableBalanceAfter:cashAfter
  };
 }catch(error){try{await client.query("ROLLBACK");}catch{}throw error;}finally{client.release();}
}
