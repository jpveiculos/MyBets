let financeMode="deposit";
let pixSettings=null;
let playerUsername="";
let playerId="";
let availableBalance=0;
let withdrawableBalance=0;
const $=id=>document.getElementById(id);
const money=v=>Number(v||0).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
async function api(url,options={}){const r=await fetch(url,{credentials:"same-origin",...options});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.message||"Erro na operação.");return d}
async function load(){
  try{
    const a=await api("/api/account");
    playerUsername=a.account.username;
    playerId=String(a.account.id);
    availableBalance=Number(a.account.available_balance||0);
    withdrawableBalance=Number(a.account.withdrawable_balance||0);
    $("welcome").textContent="Olá, "+playerUsername;
    $("balance").textContent=money(availableBalance);
    $("reserved").textContent="Reservado: "+money(a.account.reserved_balance);
    $("bonus").textContent="Bônus: "+money(a.account.bonus_balance);
    $("withdrawAvailableBalance").textContent=money(withdrawableBalance);
    $("withdrawAmount").max=withdrawableBalance>0?withdrawableBalance.toFixed(2):"0.01";
    $("withdrawMax").disabled=withdrawableBalance<=0;
    const hasBonus=Number(a.account.bonus_balance)>0;
    const withdrawalLocked=Boolean(a.account.withdrawal_bonus_lock);
    const remaining=Math.max(0,Number(a.account.post_bonus_wager_requirement||0)-Number(a.account.post_bonus_wager_progress||0));
    const depositPrincipal=Math.max(0,Number(a.account.deposit_principal_remaining||0));
    $("withdrawBtn").disabled=hasBonus||withdrawalLocked||withdrawableBalance<=0;
    $("withdrawBtn").title=hasBonus?"O saque fica bloqueado enquanto houver saldo de bônus.":withdrawalLocked?"Aposte o valor restante para liberar o saque.":depositPrincipal>0?"Aposte o principal de depósito restante para liberar os ganhos.":withdrawableBalance<=0?"Ainda não há ganhos disponíveis para saque.":"Solicitar saque";
    const hint=$("withdrawHint");
    if(hint) hint.textContent=hasBonus
      ? "Bônus atual: "+money(a.account.bonus_balance)+". Após zerar, ainda falta apostar "+money(remaining)+" para liberar o saque. Principal do depósito ainda protegido: "+money(depositPrincipal)+". Aposte 100% do valor depositado para liberar essa parte."
      : withdrawalLocked
        ? "Bônus zerado. Meta pós-bônus: "+money(a.account.post_bonus_wager_progress||0)+" / "+money(a.account.post_bonus_wager_requirement||0)+". Falta "+money(remaining)+". Principal do depósito ainda protegido: "+money(depositPrincipal)+". Aposte 100% do valor depositado para liberar essa parte."
        : depositPrincipal>0
          ? "Principal do depósito ainda protegido: "+money(depositPrincipal)+". É necessário apostar 100% do valor depositado para liberar essa parte para saque."
          : withdrawableBalance>0
            ? "Ganhos disponíveis para saque: "+money(withdrawableBalance)+". Informe o valor e sua chave Pix."
            : "Ainda não há ganhos disponíveis para saque.";
  }catch(e){location.href="/"}
}
function normalizePixText(value,max){
  return String(value||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^A-Za-z0-9 .\-]/g,"").toUpperCase().trim().slice(0,max);
}
function emv(id,value){const v=String(value);return id+String(v.length).padStart(2,"0")+v}
function crc16(payload){
  let crc=0xFFFF;
  for(let i=0;i<payload.length;i++){
    crc^=payload.charCodeAt(i)<<8;
    for(let b=0;b<8;b++)crc=(crc&0x8000)?((crc<<1)^0x1021)&0xFFFF:(crc<<1)&0xFFFF;
  }
  return crc.toString(16).toUpperCase().padStart(4,"0");
}
function buildPixPayload(){
  if(!pixSettings?.pix_key) return "";
  const key=String(pixSettings.pix_key).trim();
  const merchant=normalizePixText(pixSettings.pix_receiver_name||"MYBETS",25)||"MYBETS";
  const city=normalizePixText(pixSettings.pix_city||"PARAMIRIM",15)||"PARAMIRIM";
  const desc=normalizePixText(pixSettings.pix_description||"MYBETS",72);
  const mai=emv("00","BR.GOV.BCB.PIX")+emv("01",emv("01",key)+(desc?emv("02",desc):""));
  const additional=emv("26",mai);
  let payload=emv("00","01")+emv("01","12")+additional+emv("52","0000")+emv("53","986");
  payload+=emv("58","BR")+emv("59",merchant)+emv("60",city)+emv("62",emv("05","MYBETS"));
  payload+="6304";
  return payload+crc16(payload);
}
function qrUrl(payload){return "https://quickchart.io/qr?size=360&margin=2&ecLevel=M&text="+encodeURIComponent(payload)}
function showDepositPromotion(){
  $("depositPromo").classList.remove("hidden");
  $("depositArea").classList.add("hidden");
  $("withdrawArea").classList.add("hidden");
}
function showDepositPix(){
  $("depositPromo").classList.add("hidden");
  $("depositArea").classList.remove("hidden");
  $("withdrawArea").classList.add("hidden");
}
async function openDeposit(){
  financeMode="deposit";$("financeModal").classList.remove("hidden");
  showDepositPromotion();$("depositMessage").textContent="";$("depositAmount").value="";$("depositPlayer").textContent=playerUsername||"Jogador";$("pixDone").disabled=false;
  try{
    const d=await api("/api/settings/public");pixSettings=d.settings;
    if(String(pixSettings.pix_enabled)!=="true"){ $("depositMessage").textContent="Depósitos via Pix estão temporariamente desativados.";return }
    if(!pixSettings.pix_key){ $("depositMessage").textContent="O Pix ainda não foi configurado pelo administrador.";return }
    $("pixReceiver").textContent="Recebedor: "+(pixSettings.pix_receiver_name||"MyBets");
    updateQr();
  }catch(e){$("depositMessage").textContent=e.message}
}
function updateQr(){
  if(!pixSettings?.pix_key){$("qrCard").classList.add("hidden");$("pixDone").classList.add("hidden");return}
  const payload=buildPixPayload();
  $("pixQr").src=qrUrl(payload);$("pixCode").value=String(pixSettings.pix_key).trim();$("qrCard").classList.remove("hidden");$("pixDone").classList.remove("hidden");
}
async function openWithdraw(){
  try{
    const a=await api("/api/account");
    availableBalance=Number(a.account.available_balance||0);
    withdrawableBalance=Number(a.account.withdrawable_balance||0);
    $("balance").textContent=money(availableBalance);
    $("reserved").textContent="Reservado: "+money(a.account.reserved_balance);
    $("bonus").textContent="Bônus: "+money(a.account.bonus_balance);
    $("withdrawAvailableBalance").textContent=money(withdrawableBalance);
    $("withdrawAmount").max=withdrawableBalance>0?withdrawableBalance.toFixed(2):"0.01";
    $("withdrawMax").disabled=withdrawableBalance<=0;
    const hasBonus=Number(a.account.bonus_balance||0)>0;
    const withdrawalLocked=Boolean(a.account.withdrawal_bonus_lock);
    const depositPrincipal=Math.max(0,Number(a.account.deposit_principal_remaining||0));
    $("withdrawBtn").disabled=hasBonus||withdrawalLocked||withdrawableBalance<=0;
    if(hasBonus||withdrawalLocked||withdrawableBalance<=0){
      $("withdrawMessage").textContent=hasBonus
        ? "O saque continua bloqueado enquanto houver bônus."
        : withdrawalLocked
          ? "O saque continua bloqueado até cumprir a meta pós-bônus."
          : depositPrincipal>0
            ? "O saldo depositado ainda não foi totalmente apostado. Ganhos ficam liberados conforme o principal é consumido."
            : "Ainda não há ganhos disponíveis para saque.";
    }
    if(withdrawableBalance<=0) return;
    financeMode="withdraw";
    $("financeModal").classList.remove("hidden");
    $("depositPromo").classList.add("hidden");
    $("financeTitle").textContent="Solicitar saque";
    $("depositArea").classList.add("hidden");
    $("withdrawArea").classList.remove("hidden");
    $("withdrawMessage").textContent="";
    $("withdrawForm").reset();
    $("withdrawAvailableBalance").textContent=money(withdrawableBalance);
    $("withdrawAmount").max=withdrawableBalance.toFixed(2);
    $("withdrawMax").disabled=false;
  }catch(e){
    alert(e.message);
  }
}
$("depositBtn").onclick=openDeposit;$("withdrawBtn").onclick=openWithdraw;$("depositPromoProceed").onclick=showDepositPix;
$("withdrawMax").onclick=()=>{
  if(withdrawableBalance>0) $("withdrawAmount").value=withdrawableBalance.toFixed(2);
};

$("copyPix").onclick=async()=>{try{await navigator.clipboard.writeText($("pixCode").value);$("depositMessage").style.color="#35c58a";$("depositMessage").textContent="Código Pix copiado.";setTimeout(()=>$("depositMessage").textContent="",1800)}catch(e){$("pixCode").select()}};
$("pixDone").onclick=async()=>{
  const amount=Number($("depositAmount").value);const m=$("depositMessage");
  if(!amount||amount<=0){m.textContent="Informe o valor do depósito.";return}
  try{
    await api("/api/deposits",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({amount,playerNote:"Jogador: "+(playerUsername||"não identificado")})});
    m.style.color="#35c58a";m.textContent="Solicitação enviada. O administrador foi avisado e fará a conferência do Pix.";
    $("pixDone").disabled=true;setTimeout(()=>{$("financeModal").classList.add("hidden");$("pixDone").disabled=false;load()},1800);
  }catch(e){m.style.color="#ff5d6c";m.textContent=e.message}
};
$("withdrawForm").onsubmit=async e=>{
  e.preventDefault();const m=$("withdrawMessage");m.style.color="#ff5d6c";
  try{
    await api("/api/withdrawals",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({amount:Number($("withdrawAmount").value),pixKey:$("withdrawPixKey").value.trim()})});
    m.style.color="#35c58a";m.textContent="Saque solicitado. O valor ficará reservado até o administrador finalizar a operação.";
    setTimeout(()=>{$("financeModal").classList.add("hidden");load()},1800);
  }catch(e){m.textContent=e.message}
};
$("closeFinance").onclick=()=>{$("financeModal").classList.add("hidden")};
$("logout").onclick=async()=>{await api("/api/auth/logout",{method:"POST"});location.href="/"};
load();