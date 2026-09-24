const GAME=window.MYBETS_GAME;
const $=id=>document.getElementById(id);
const money=v=>Number(v||0).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
let config=null,account=null,bet=1,spinning=false;

function updatePlayability(message=null){
  if(!config)return;
  const available=Number(account?.play_credits||0);
  const insufficient=available<Number(bet);
  $("spin").disabled=Boolean(spinning||insufficient);
  if(insufficient&&!spinning){
    $("result").className="result";
    $("result").textContent=message||"Créditos para jogar insuficientes. A máquina foi parada.";
  }
}

async function refreshAccount(){
  try{
    const a=await api("/api/account");
    account=a.account;
    $("balance").textContent=money(account.play_credits);
    updatePlayability();
    return account;
  }catch{return null;}
}
async function api(url,options={}){const r=await fetch(url,{credentials:"same-origin",cache:"no-store",...options});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.message||"Erro na operação.");return d}
function renderPaytable(){
  const table=$("paytable");
  if(!table||!config?.symbols)return;
  table.innerHTML=config.symbols.map(symbol=>'<div class="pay"><span class="sym">'+symbol.label+'</span><small>'+symbol.multiplier+'x</small></div>').join("");
}
function draw(grid){$("reels").innerHTML=grid.map(s=>'<div class="reel" data-id="'+s.id+'">'+s.label+"</div>").join("")}
function initial(){const symbols=config.symbols,n=config.rows*config.columns;draw(Array.from({length:n},(_,i)=>symbols[i%symbols.length]))}
async function load(){try{const c=await api("/api/games/"+GAME.id+"/config"),a=await api("/api/account");config=c.game;account=a.account;bet=Math.max(config.minBet,1);$("balance").textContent=money(account.play_credits);$("bet").textContent=money(bet);renderPaytable();initial();updatePlayability()}catch(e){$("result").textContent=e.message||"Faça login para jogar.";$("spin").disabled=true}}
function changeBet(delta){if(!config||spinning)return;bet=Math.min(config.maxBet,Math.max(config.minBet,Number((bet+delta).toFixed(2))));$("bet").textContent=money(bet);updatePlayability()}
async function animate(){let t=0;return new Promise(resolve=>{const timer=setInterval(()=>{const n=config.rows*config.columns;draw(Array.from({length:n},()=>config.symbols[Math.floor(Math.random()*config.symbols.length)]));document.querySelectorAll(".reel").forEach(x=>x.classList.add("spinfx"));if(++t>=16){clearInterval(timer);resolve()}},55)})}
async function spin(){
  if(spinning||!config)return;
  const available=Number(account?.play_credits||0);
  if(available<Number(bet)){
    updatePlayability("Créditos para jogar insuficientes. A máquina foi parada.");
    return;
  }
  spinning=true;$("spin").disabled=true;$("minus").disabled=true;$("plus").disabled=true;$("result").className="result";$("result").textContent="Girando...";await animate();try{const d=await api("/api/games/"+GAME.id+"/spin",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({betAmount:bet})});account=d.user;account.play_credits=account.playCredits;$("balance").textContent=money(account.play_credits);draw(d.spin.grid);if(d.spin.won){document.querySelectorAll('.reel[data-id="'+CSS.escape(d.spin.winningSymbol)+'"]').forEach(x=>x.classList.add("win"));$("result").className="result win";$("result").textContent="PRÊMIO: R$ "+money(d.spin.prize)+" · "+d.spin.multiplier+"x"}else{$("result").textContent="Não foi dessa vez."}}catch(e){const latest=await refreshAccount();$("result").textContent=latest&&Number(latest.play_credits||0)<Number(bet)?"Créditos para jogar insuficientes. A máquina foi parada.":(e.message||"Erro ao jogar.")}finally{spinning=false;$("minus").disabled=false;$("plus").disabled=false;updatePlayability()}}
$("minus").onclick=()=>changeBet(-1);$("plus").onclick=()=>changeBet(1);$("spin").onclick=spin;load();