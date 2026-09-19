let financeMode="deposit";
let pixSettings=null;
const $=id=>document.getElementById(id);
const money=v=>Number(v||0).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
async function api(url,options={}){const r=await fetch(url,{credentials:"same-origin",...options});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.message||"Erro na operação.");return d}
async function load(){
  try{
    const [a,t]=await Promise.all([api("/api/account"),api("/api/transactions")]);
    $("welcome").textContent="Olá, "+a.account.username;
    $("balance").textContent=money(a.account.available_balance);
    $("reserved").textContent="Reservado: "+money(a.account.reserved_balance);
    $("history").innerHTML=t.transactions.length?t.transactions.map(x=>`<div class="history-row"><span><strong>${x.type}</strong><small>${new Date(x.created_at).toLocaleString("pt-BR")}</small></span><b>${money(x.amount)}</b></div>`).join(""):"<p class='muted'>Nenhuma movimentação ainda.</p>";
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
async function openDeposit(){
  financeMode="deposit";$("financeModal").classList.remove("hidden");$("financeTitle").textContent="Depósito via Pix";
  $("depositArea").classList.remove("hidden");$("withdrawArea").classList.add("hidden");$("depositMessage").textContent="";$("depositAmount").value="";$("qrCard").classList.add("hidden");$("pixDone").classList.add("hidden");
  try{
    const d=await api("/api/settings/public");pixSettings=d.settings;
    if(String(pixSettings.pix_enabled)!=="true"){ $("depositMessage").textContent="Depósitos via Pix estão temporariamente desativados.";return }
    if(!pixSettings.pix_key){ $("depositMessage").textContent="O Pix ainda não foi configurado pelo administrador.";return }
    $("pixReceiver").textContent="Recebedor: "+(pixSettings.pix_receiver_name||"MyBets");
  }catch(e){$("depositMessage").textContent=e.message}
}
function updateQr(){
  if(!pixSettings?.pix_key){$("qrCard").classList.add("hidden");$("pixDone").classList.add("hidden");return}
  const payload=buildPixPayload();
  $("pixQr").src=qrUrl(payload);$("pixCode").value=payload;$("qrCard").classList.remove("hidden");$("pixDone").classList.remove("hidden");
}
async function openWithdraw(){
  financeMode="withdraw";$("financeModal").classList.remove("hidden");$("financeTitle").textContent="Solicitar saque";
  $("depositArea").classList.add("hidden");$("withdrawArea").classList.remove("hidden");$("withdrawMessage").textContent="";$("withdrawForm").reset();
}
$("depositBtn").onclick=openDeposit;$("withdrawBtn").onclick=openWithdraw;
$("depositAmount").oninput=updateQr;
$("copyPix").onclick=async()=>{try{await navigator.clipboard.writeText($("pixCode").value);$("depositMessage").style.color="#35c58a";$("depositMessage").textContent="Código Pix copiado.";setTimeout(()=>$("depositMessage").textContent="",1800)}catch(e){$("pixCode").select()}};
$("pixDone").onclick=async()=>{
  const amount=Number($("depositAmount").value);const m=$("depositMessage");
  if(!amount||amount<=0){m.textContent="Informe o valor do depósito.";return}
  try{
    await api("/api/deposits",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({amount})});
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
$("refresh").onclick=load;
$("rouletteBtn").onclick=()=>alert("A área da roleta será conectada na próxima etapa.");
$("logout").onclick=async()=>{await api("/api/auth/logout",{method:"POST"});location.href="/"};
load();