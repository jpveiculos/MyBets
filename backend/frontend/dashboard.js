let financeMode="deposit";
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
function openFinance(mode){
  financeMode=mode;$("financeModal").classList.remove("hidden");$("financeTitle").textContent=mode==="deposit"?"Depósito via Pix":"Solicitar saque";
  $("pixKeyLabel").classList.toggle("hidden",mode!=="withdraw");$("financeMessage").textContent="";$("financeForm").reset();
  $("pixBox").classList.add("hidden");
  if(mode==="deposit")loadPix();
}
async function loadPix(){
  try{
    const d=await api("/api/settings/public");const s=d.settings;
    if(String(s.pix_enabled)!=="true"){$("pixBox").classList.remove("hidden");$("pixBox").textContent="Depósitos via Pix estão temporariamente desativados.";return}
    $("pixBox").classList.remove("hidden");$("pixBox").innerHTML=`<strong>Pix</strong><span>${s.pix_receiver_name||"Recebedor não configurado"}</span><code>${s.pix_key||"Chave ainda não configurada"}</code><small>${s.pix_instructions||""}</small>`;
  }catch(e){}
}
$("depositBtn").onclick=()=>openFinance("deposit");$("withdrawBtn").onclick=()=>openFinance("withdraw");
$("closeFinance").onclick=()=>$("financeModal").classList.add("hidden");$("refresh").onclick=load;
$("rouletteBtn").onclick=()=>alert("A área da roleta será conectada na próxima etapa.");
$("logout").onclick=async()=>{await api("/api/auth/logout",{method:"POST"});location.href="/"};
$("financeForm").onsubmit=async e=>{e.preventDefault();const m=$("financeMessage");try{
  const body={amount:Number($("financeAmount").value),playerNote:$("financeNote").value.trim()};
  if(financeMode==="withdraw")body.pixKey=$("pixKey").value.trim();
  await api(financeMode==="deposit"?"/api/deposits":"/api/withdrawals",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  m.style.color="#35c58a";m.textContent="Solicitação enviada.";setTimeout(()=>{$("financeModal").classList.add("hidden");load()},600);
}catch(e){m.style.color="#ff5d6c";m.textContent=e.message}};
load();
