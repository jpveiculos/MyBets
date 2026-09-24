const $=id=>document.getElementById(id);
const money=v=>Number(v||0).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
const dateTime=v=>new Date(v).toLocaleString("pt-BR");
async function api(url,options={}){const r=await fetch(url,{credentials:"same-origin",...options});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.message||"Erro.");return d}
const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
let previousPendingCount=null;
let adminAuthenticated=false;
let pushSubscription=null;
let notifyReady=false;
let refreshTimer=null;
let editingDepositId=null;
let isEditingDeposit=false;
let currentView="dashboard";
let userSearchTerm="";
let cachedUsers=[];
let transactionFilters={query:"",type:"",from:"",to:""};

function urlBase64ToUint8Array(base64String){
 const padding="=".repeat((4-base64String.length%4)%4);
 const base64=(base64String+padding).replace(/-/g,"+").replace(/_/g,"/");
 const raw=atob(base64);return Uint8Array.from([...raw].map(c=>c.charCodeAt(0)));
}
async function registerServiceWorker(){
 if(!("serviceWorker" in navigator))return null;
 try{return await navigator.serviceWorker.register("/sw.js",{scope:"/"})}catch(e){console.warn("Service Worker:",e);return null}
}
function isAdminHomeScreenApp(){
 return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone===true;
}
async function enableNotifications(){
 if(!isAdminHomeScreenApp()){
  $("notifyStatus").textContent="No iPhone, abra o MyBets pelo ícone instalado na Tela de Início. O Safari aberto normalmente não recebe Web Push nem badge.";
  return false;
 }
 if(!("Notification" in window)){ $("notifyStatus").textContent="Este navegador não oferece notificações web.";return false; }
 const permission=Notification.permission==="default"?await Notification.requestPermission():Notification.permission;
 if(permission!=="granted"){ $("notifyStatus").textContent=permission==="denied"?"Notificações bloqueadas. Ative-as nos Ajustes do iPhone.":"Permissão não concedida.";return false; }
 const reg=await registerServiceWorker();if(!reg||!("PushManager" in window))return false;
 const key=(await api("/api/push/public-key")).publicKey;
 if(!key){$("notifyStatus").textContent="Push ainda não configurado no servidor.";return false}
 const existing=await reg.pushManager.getSubscription();
 pushSubscription=existing||await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:urlBase64ToUint8Array(key)});
 await api("/api/admin/push/subscribe",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(pushSubscription.toJSON())});
 $("notifyStatus").textContent="Notificações ativadas neste dispositivo.";
 $("enableNotifications").textContent="NOTIFICAÇÕES ATIVAS";
 $("enableNotifications").disabled=true;
 return true;
}
async function updateAppBadge(){
 try{
  const d=await api("/api/admin/notifications/count");
  const count=Number(d.count)||0;
  const badge=$("notifyCount"),button=$("enableNotifications");
  if(badge){badge.textContent=count>99?"99+":String(count);badge.style.display=count>0?"inline-flex":"none"}
  button?.classList.toggle("active",count>0);
  if(navigator.setAppBadge&&count>0)await navigator.setAppBadge(count);else if(navigator.clearAppBadge)await navigator.clearAppBadge();
 }catch{}
}
function pauseAutoRefresh(){isEditingDeposit=true;if(refreshTimer){clearInterval(refreshTimer);refreshTimer=null}}
function resumeAutoRefresh(){
 isEditingDeposit=false;if(refreshTimer)clearInterval(refreshTimer);
 if(!adminAuthenticated)return;
 refreshTimer=setInterval(()=>{if(adminAuthenticated&&!isEditingDeposit)load()},10000);
}
function openView(view){
 closeMobileMenu();
 currentView=view;
 document.querySelectorAll("[data-view-panel]").forEach(panel=>panel.classList.toggle("hidden",panel.dataset.viewPanel!==view));
 document.querySelectorAll(".admin-nav-link").forEach(link=>link.classList.toggle("active",link.dataset.view===view));
 document.querySelectorAll(".metric-nav").forEach(button=>button.classList.toggle("active",button.dataset.openView===view));
 const target=view==="dashboard"?"painel":view;
 if(location.hash!=="#"+target)history.replaceState(null,"","#"+target);
 closeMobileMenu();
}
function closeMobileMenu(){
 const app=document.querySelector(".admin-app");
 if(app)app.dataset.mobileMenu="closed";
}

function bindNavigation(){
 document.querySelectorAll(".admin-nav-link").forEach(link=>link.addEventListener("click",e=>{e.preventDefault();openView(link.dataset.view);closeMobileMenu()}));
 document.querySelectorAll(".metric-nav").forEach(button=>button.addEventListener("click",()=>{openView(button.dataset.openView);closeMobileMenu()}));
}
function statusLabel(status){
 const labels={pending:"Pendente",approved:"Aprovado",rejected:"Rejeitado"};
 return labels[status]||status||"—";
}
function statusClass(status){return "status-"+String(status||"").toLowerCase()}

function renderUsers(users){
 const term=userSearchTerm.trim().toLowerCase();
 const filtered=term?users.filter(x=>String(x.username||"").toLowerCase().includes(term)||String(x.id).includes(term)||String(x.cpf||"").includes(term)):users;
 $("users").innerHTML=filtered.map(x=>`<div class="admin-row"><span><b>#${x.id} • ${esc(x.username)}</b><small>CPF: ${esc(x.cpf||"Não informado")} • Cadastro: ${dateTime(x.created_at)} • Créditos para jogar: ${Number(x.play_credits||0).toLocaleString("pt-BR",{maximumFractionDigits:2})} • Saldo para saque: ${money(x.withdrawable_balance)} • Reserva: ${money(x.reserved_balance)} • Status: ${x.is_banned?"BANIDO":"ATIVO"}</small></span><span class="row-actions"><button data-id="${x.id}" class="small-btn history-user">Histórico</button><button data-id="${x.id}" class="small-btn add-cash">+ saldo</button><button data-id="${x.id}" class="small-btn add-bonus">+ créditos</button>${x.is_banned?'<button data-id="'+x.id+'" class="small-btn unban-user">Desbanir</button>':'<button data-id="'+x.id+'" class="small-btn ban-user">Banir</button>'}<button data-id="${x.id}" class="small-btn delete-user">Excluir</button></span></div>`).join("")||'<p class="muted">Nenhum usuário encontrado.</p>';
}
function renderDeposits(deposits){
 $("deposits").innerHTML=deposits.map(x=>`<div class="admin-row"><span><b>#${x.id} • ${esc(x.username)}</b><small>Informado: ${money(x.amount)} • ${dateTime(x.created_at)}</small><span class="admin-status ${statusClass(x.status)}">${statusLabel(x.status)}${x.approved_amount!=null?" • Creditado: "+money(x.approved_amount):""}</span></span><span class="row-actions">${x.status==="pending"?'<button class="small-btn approve-deposit" data-id="'+x.id+'" data-username="'+esc(x.username)+'" data-amount="'+x.amount+'">Conferir / creditar</button><button class="small-btn reject-deposit" data-id="'+x.id+'">Rejeitar</button>':""}</span></div>`).join("")||'<p class="muted">Nenhum depósito.</p>';
}
function renderWithdrawals(withdrawals){
 $("withdrawals").innerHTML=withdrawals.map(x=>{
  const remaining=Math.max(0,Number(x.post_bonus_wager_requirement||0)-Number(x.post_bonus_wager_progress||0));
  const status=Number(x.bonus_balance)>0?"⚠️ BÔNUS ATIVO":Boolean(x.withdrawal_bonus_lock)?"🔒 PÓS-BÔNUS PENDENTE":"✓ SAQUE LIBERADO";
  return `<div class="admin-row"><span><b>#${x.id} • ${esc(x.username)}</b><small>CPF: <strong>${esc(x.cpf||"Não informado")}</strong></small><small>Valor: ${money(x.amount)} • Chave Pix: ${esc(x.pix_key)} • ${dateTime(x.created_at)}</small><small>Créditos para jogar: ${Number(x.play_credits||0).toLocaleString("pt-BR",{maximumFractionDigits:2})} • Saldo para saque: ${money(Math.max(0,Number(x.cash_balance||0)-Number(x.reserved_balance||0)))}</small><span class="admin-status ${statusClass(x.status)}">${status}${statusLabel(x.status)!=="Pendente"?" • "+statusLabel(x.status):" • Pendente"}</span></span><span class="row-actions">${x.status==="pending"?'<button class="small-btn approve-withdrawal" data-id="'+x.id+'">Aprovar</button><button class="small-btn reject-withdrawal" data-id="'+x.id+'">Rejeitar</button>':""}</span></div>`;
 }).join("")||'<p class="muted">Nenhum saque.</p>';
}
function transactionTypeLabel(type){
 const labels={
  signup_bonus:"BÔNUS CONCEDIDO",
  deposit_approved:"DEPÓSITO APROVADO",
  withdrawal_approved:"SAQUE APROVADO",
  withdrawal_released:"SAQUE DEVOLVIDO",
  admin_cash_adjustment:"AJUSTE DE SALDO",
  admin_bonus_adjustment:"AJUSTE DE BÔNUS",
  roulette_win:"PRÊMIO ROleta".toUpperCase(),
  roulette_loss:"APOSTA ROleta".toUpperCase(),
  "my-tiger_win":"PRÊMIO MY TIGER",
  "my-tiger_loss":"APOSTA MY TIGER",
  "my-dragon_win":"PRÊMIO MY DRAGON",
  "my-dragon_loss":"APOSTA MY DRAGON",
  lucky7_win:"PRÊMIO LUCKY7",
  lucky7_loss:"APOSTA LUCKY7",
  withdrawal_reserved:"SAQUE RESERVADO",
  deposit_bonus:"BÔNUS DE DEPÓSITO"
 };
 return labels[type]||String(type||"MOVIMENTAÇÃO").replace(/_/g," ").toUpperCase();
}
function renderTransactions(transactions){
 $("transactions").innerHTML=transactions.map(x=>`<div class="admin-row"><span><b>#${x.id} • ${esc(x.username)}</b><small>${esc(transactionTypeLabel(x.type))} • ${money(x.amount)} • ${dateTime(x.created_at)}</small><small>Saldo após: ${money(x.balance_after)}${x.note?" • "+esc(x.note):""}</small></span></div>`).join("")||'<p class="muted">Nenhuma movimentação encontrada.</p>';
}
function historyRow(title,detail,date,kind=""){
 return `<div class="history-item ${kind}"><div><b>${esc(title)}</b><span>${esc(detail||"")}</span></div><time>${dateTime(date)}</time></div>`;
}
let historyState = { userId:null, pages:{}, loading:false };

function historyPagination(section, pagination){
 const p=pagination?.[section];
 if(!p || p.total<=p.pageSize) return "";
 const first=(p.page-1)*p.pageSize+1;
 const last=Math.min(p.page*p.pageSize,p.total);
 return `<div class="history-pagination">
   <span>Mostrando ${first}–${last} de ${p.total}</span>
   <div class="row-actions">
    <button class="small-btn history-page" data-section="${section}" data-page="${p.page-1}" ${p.page<=1?"disabled":""}>Anterior</button>
    <span class="muted">Página ${p.page} de ${p.totalPages}</span>
    <button class="small-btn history-page" data-section="${section}" data-page="${p.page+1}" ${p.page>=p.totalPages?"disabled":""}>Próxima</button>
   </div>
  </div>`;
}
function historySection(title, rowsHtml, section, pagination){
 return `<section class="history-section"><h3>${title}</h3>${rowsHtml}${historyPagination(section,pagination)}</section>`;
}
function openHistoryModal(history){
 const u=history.user;
 historyState.pages=Object.fromEntries(Object.entries(history.pagination||{}).map(([name,p])=>[name,p.page]));
 $("historyTitle").textContent="Histórico • "+u.username;
 const bs=history.bonusStatus||{};
 const statusText=bs.status==="unlocked"?"SAQUE LIBERADO":bs.status==="blocked_bonus"?"SAQUE BLOQUEADO • BÔNUS ATIVO":"SAQUE BLOQUEADO • META PÓS-BÔNUS";
 $("historySummary").innerHTML=
  `CPF: ${esc(u.cpf||"Não informado")} • Cadastro: ${dateTime(u.created_at)}<br>
   <strong>Dinheiro:</strong> ${money(u.cash_balance)} • <strong>Bônus:</strong> ${money(u.bonus_balance)} • <strong>Total:</strong> ${money(u.total_balance)} • <strong>Reservado:</strong> ${money(u.reserved_balance)}`;
 const bonus=history.bonusClaim;
 const signupTransaction=history.transactions.find(x=>x.type==="signup_bonus");
 const grantedBonus=bonus?.bonus_amount ?? signupTransaction?.amount ?? 0;
 const bonusHtml=history.bonusEvents?.length
  ? history.bonusEvents.map(x=>historyRow(
      String(x.type||"BÔNUS").replace(/_/g," ").toUpperCase(),
      `Concedido: ${money(x.amount)} • Bônus após: ${money(x.bonus_balance_after)} • Meta: ${money(x.post_bonus_wager_progress_after)} / ${money(x.post_bonus_wager_requirement_after)} • Falta: ${money(Math.max(0,Number(x.post_bonus_wager_requirement_after)-Number(x.post_bonus_wager_progress_after)))} • ${x.note||""}`,
      x.created_at,"history-bonus"
    )).join("")
  : Number(grantedBonus)>0
    ? historyRow("BÔNUS DE CADASTRO CONCEDIDO", `Valor: ${money(grantedBonus)}`, bonus?.created_at||signupTransaction?.created_at||u.created_at,"history-bonus")
    : '<p class="muted">Nenhum bônus registrado.</p>';
 const bonusProgressHtml=`
  <div class="history-bonus-summary">
    <div class="history-bonus-status"><span>STATUS DO SAQUE</span><strong>${statusText}</strong></div>
    <div class="history-bonus-grid">
      <div><small>Bônus concedido acumulado</small><b>${money(bs.totalGranted)}</b></div>
      <div><small>Bônus atual</small><b>${money(bs.currentBonus)}</b></div>
      <div><small>Meta pós-bônus</small><b>${money(bs.progress)} / ${money(bs.requirement)}</b></div>
      <div><small>Falta para liberar</small><b>${money(bs.remainingPostBonus)}</b></div>
    </div>
    <p>${Number(bs.currentBonus)>0
      ? "O jogador ainda possui bônus. A meta pós-bônus não é consumida enquanto o bônus não estiver zerado."
      : bs.remainingPostBonus>0
        ? "O bônus está zerado. As apostas elegíveis pós-bônus estão sendo contadas separadamente do saldo e de novos depósitos."
        : "A meta pós-bônus foi cumprida. O saque está liberado, desde que exista saldo em dinheiro disponível."}</p>
  </div>`;
 const txHtml=history.transactions.length?history.transactions.map(x=>historyRow(transactionTypeLabel(x.type),`${money(x.amount)} • Saldo após: ${money(x.balance_after)}${x.note?" • "+x.note:""}`,x.created_at,x.type.includes("bonus")?"history-bonus":"")).join(""):'<p class="muted">Nenhuma movimentação financeira.</p>';
 const depositHtml=history.deposits.length?history.deposits.map(x=>historyRow("DEPÓSITO "+statusLabel(x.status),`Solicitado: ${money(x.amount)}${x.approved_amount!=null?" • Creditado: "+money(x.approved_amount):""}`,x.created_at,"")).join(""):'<p class="muted">Nenhum depósito registrado.</p>';
 const withdrawalHtml=history.withdrawals.length?history.withdrawals.map(x=>historyRow("SAQUE "+statusLabel(x.status),`Valor: ${money(x.amount)} • ${x.status==="pending"?statusText:statusLabel(x.status)}${x.rejection_reason?" • Motivo: "+x.rejection_reason:""}`,x.created_at,"")).join(""):'<p class="muted">Nenhum saque registrado.</p>';
 const spinsHtml=history.spins.length?history.spins.map(x=>{
   const afterBonus=Number(x.bonus_balance_after||0),progress=Number(x.post_bonus_wager_progress_after||0),req=Number(x.post_bonus_wager_requirement_after||0);
   const source=Number(x.bonus_used||0)>0?`Bônus usado: ${money(x.bonus_used)}${Number(x.cash_used||0)>0?" • Dinheiro: "+money(x.cash_used):""}`:"Dinheiro";
   const post=afterBonus<=0&&req>0?` • Pós-bônus: ${money(progress)} / ${money(req)}`:"";
   const lock=x.withdrawal_bonus_lock_after?" • 🔒 saque bloqueado":" • ✓ saque liberado";
   return historyRow(
     `${String(x.game_id||"jogo").toUpperCase()} • ${x.payout_amount>0?"PRÊMIO":"APOSTA"}`,
     `Aposta: ${money(x.bet_amount)} • ${source} • Resultado: ${esc(x.result_code||x.result)} • Multiplicador: ${esc(x.multiplier)}x • Pagamento: ${money(x.payout_amount)} • Bônus após: ${money(afterBonus)}${post}${lock}`,
     x.created_at,""
   );
 }).join(""):'<p class="muted">Nenhuma jogada registrada.</p>';
 const auditHtml=history.audits.length?history.audits.map(x=>historyRow(String(x.action||"AUDITORIA").replace(/_/g," ").toUpperCase(),x.details?JSON.stringify(x.details):"",x.created_at,"history-audit")).join(""):'<p class="muted">Nenhum evento de auditoria recente.</p>';
 const bonusEventsHtml=historySection("Concessões de bônus",bonusHtml,"bonusEvents",history.pagination?.bonusEvents);
 $("historyContent").innerHTML=`
  ${bonusProgressHtml}
  ${historySection("Concessões de bônus",bonusHtml,"bonusEvents",history.pagination?.bonusEvents)}
  ${historySection("Movimentações financeiras",txHtml,"transactions",history.pagination?.transactions)}
  ${historySection("Depósitos",depositHtml,"deposits",history.pagination?.deposits)}
  ${historySection("Saques",withdrawalHtml,"withdrawals",history.pagination?.withdrawals)}
  ${historySection("Jogadas e consumo de saldo",spinsHtml,"spins",history.pagination?.spins)}
  ${historySection("Auditoria administrativa",auditHtml,"audits",history.pagination?.audits)}`;
 $("historyModal").classList.remove("hidden");$("historyModal").setAttribute("aria-hidden","false");
}
async function loadHistoryPage(section,page){
 if(!historyState.userId||historyState.loading||!Number(page)||page<1)return;
 historyState.loading=true;
 try{
  const params=new URLSearchParams({pageSize:"50"});
  for(const [name,value] of Object.entries(historyState.pages)) params.set(name+"Page",String(name===section?page:value||1));
  const d=await api("/api/admin/users/"+historyState.userId+"/history?"+params.toString());
  openHistoryModal(d.history);
 }catch(e){
  $("adminMessage").textContent=e.message||"Não foi possível carregar o histórico.";
 }finally{
  historyState.loading=false;
 }
}
async function openUserHistory(userId){
 pauseAutoRefresh();
 historyState.userId=Number(userId);
 historyState.pages={transactions:1,deposits:1,withdrawals:1,spins:1,bonusEvents:1,audits:1};
 try{
  const d=await api("/api/admin/users/"+userId+"/history?pageSize=50&transactionsPage=1&depositsPage=1&withdrawalsPage=1&spinsPage=1&bonusEventsPage=1&auditsPage=1");
  openHistoryModal(d.history);
 }catch(e){
  $("adminMessage").textContent=e.message||"Não foi possível carregar o histórico.";
  resumeAutoRefresh();
 }
}
function closeHistoryModal(){
 $("historyModal").classList.add("hidden");$("historyModal").setAttribute("aria-hidden","true");$("historyContent").innerHTML="";historyState={userId:null,pages:{},loading:false};resumeAutoRefresh();
}
function renderRouletteSettings(settings,roulette){
 const minField=$("rouletteMinBet"),maxField=$("rouletteMaxBet");
 if(!minField||!maxField)return;
 const map=Object.fromEntries(settings.map(x=>[x.setting_key,x.setting_value]));
 minField.value=map.roulette_min_bet??"0.50";
 maxField.value=map.roulette_max_bet??"100.00";
 const structure=$("rouletteStructure"),probabilities=$("rouletteProbabilities");
 if(roulette){
  const total=Number(roulette.totalSectors)||0,prizes=Number(roulette.prizeSectors)||0,loss=Number(roulette.lossSectors)||0;
  const dist=roulette.prizeDistribution||{};
  const p=roulette.probability||{};
  if(structure)structure.textContent=`${total} setores: ${loss} de perda e ${prizes} premiados. A fatia preta comprime os setores lógicos de perda e mantém a área visual equivalente à fatia colorida.`;
  if(probabilities)probabilities.textContent=`2x: ${Number(p[2]||0).toLocaleString("pt-BR",{maximumFractionDigits:4})}% • 3x: ${Number(p[3]||0).toLocaleString("pt-BR",{maximumFractionDigits:4})}% • 4x: ${Number(p[4]||0).toLocaleString("pt-BR",{maximumFractionDigits:4})}% • 5x: ${Number(p[5]||0).toLocaleString("pt-BR",{maximumFractionDigits:4})}%`;
 }
}
function settingLabel(key){
 const labels={
  signup_bonus_amount:"Bônus de cadastro",
  pix_enabled:"Pix ativado",
  pix_key:"Chave Pix",
  pix_key_type:"Tipo da chave Pix",
  pix_city:"Cidade do Pix",
  pix_description:"Descrição do Pix",
  pix_instructions:"Instruções para depósito",
  roulette_min_bet:"Aposta mínima da roleta",
  roulette_max_bet:"Aposta máxima da roleta",
  audit_log_retention_days:"Retenção da auditoria (dias)",
 };
 return labels[key]||key.replace(/_/g," ").replace(/\b\w/g,c=>c.toUpperCase());
}
function settingValue(key,value){
 if(key==="pix_enabled")return String(value).toLowerCase()==="true"?"Ativado":"Desativado";
 return value;
}
function renderSettings(settings){
 const map=Object.fromEntries(settings.map(x=>[x.setting_key,x.setting_value]));
 const visible=settings.filter(x=>!["roulette_min_bet","roulette_max_bet","signup_bonus_amount","bonus_wager_requirement","roulette_prizes","deposit_bonus_percent"].includes(x.setting_key));
 const bonus=Number(map.signup_bonus_amount||50);
 const bonusCard=`<section class="admin-bonus-card"><div class="admin-bonus-card-head"><div><span class="eyebrow">PROMOÇÃO DE CADASTRO</span><h2>Bônus do jogador</h2></div><span class="admin-bonus-badge">REGRA ATIVA</span></div><div class="admin-bonus-grid"><label>Valor do bônus de cadastro<input id="signupBonusAmount" type="number" min="0" step="0.01" inputmode="decimal" value="${bonus.toFixed(2)}"></label><div class="admin-bonus-rule"><strong>Regra de saque</strong><span>Depois que o bônus chegar a R$ 0,00, o jogador ainda precisa apostar o mesmo valor do bônus para liberar o saque.</span><small>Ex.: bônus de R$ 50 → meta pós-bônus de R$ 50. Novo depósito não reduz nem libera essa meta; novos bônus somam uma nova exigência.</small></div></div><div class="row-actions"><button class="primary-btn" id="signupBonusSave" type="button">Salvar bônus e regra</button></div><p class="form-message" id="signupBonusMessage"></p></section>`;
 const rows=visible.map(x=>`<div class="admin-row"><span><b>${esc(settingLabel(x.setting_key))}</b><small>${esc(settingValue(x.setting_key,x.setting_value))}</small></span><button class="small-btn edit-setting" data-key="${esc(x.setting_key)}" data-value="${esc(x.setting_value)}">Editar</button></div>`).join("");
 $("settings").innerHTML=bonusCard+rows;
}
function renderPendingEvents(deposits,withdrawals){
 const pendingDeposits=deposits.filter(x=>x.status==="pending");
 const pendingWithdrawals=withdrawals.filter(x=>x.status==="pending");
 const events=[
  ...pendingDeposits.map(x=>({kind:"deposit",date:x.created_at,id:x.id,user:x.username,amount:x.amount})),
  ...pendingWithdrawals.map(x=>({kind:"withdrawal",date:x.created_at,id:x.id,user:x.username,cpf:x.cpf,amount:x.amount,pix:x.pix_key}))
 ].sort((a,b)=>new Date(b.date)-new Date(a.date));
 $("eventsCount").textContent=events.length+" pendente"+(events.length===1?"":"s");
 if(!events.length){
  $("pendingEvents").innerHTML='<div class="admin-empty-events"><strong>Nenhum evento novo</strong><span>Tudo resolvido por enquanto.</span></div>';
  return;
 }
 $("pendingEvents").innerHTML=events.map(x=>x.kind==="deposit"
  ?`<div class="admin-event admin-event-deposit"><div class="admin-event-icon">↓</div><div class="admin-event-body"><b>Novo depósito #${x.id}</b><span>${esc(x.user)} • ${money(x.amount)} • ${dateTime(x.date)}</span></div><div class="row-actions"><button class="small-btn approve-deposit" data-id="${x.id}" data-username="${esc(x.user)}" data-amount="${x.amount}">Conferir / creditar</button><button class="small-btn reject-deposit" data-id="${x.id}">Rejeitar</button></div></div>`
  :`<div class="admin-event admin-event-withdrawal"><div class="admin-event-icon">↑</div><div class="admin-event-body"><b>Novo saque #${x.id}</b><span>${esc(x.user)} • CPF: ${esc(x.cpf||"Não informado")} • ${money(x.amount)} • Pix: ${esc(x.pix||"—")} • ${dateTime(x.date)}</span></div><div class="row-actions"><button class="small-btn approve-withdrawal" data-id="${x.id}">Aprovar</button><button class="small-btn reject-withdrawal" data-id="${x.id}">Rejeitar</button></div></div>`
 ).join("");
}
function openDepositEditor(id,username,amount){
 pauseAutoRefresh();editingDepositId=id;
 $("depositTitle").textContent="Confirmar depósito #"+id;
 $("depositInfo").textContent="Jogador: "+username;
 $("depositDeclared").value=money(amount);
 $("depositApproved").value=Number(amount).toFixed(2);
 $("depositMessage").textContent="";
 $("depositModal").classList.remove("hidden");$("depositModal").setAttribute("aria-hidden","false");
 setTimeout(()=>{$("depositApproved").focus();$("depositApproved").select()},50);
}
function closeDepositEditor(){
 editingDepositId=null;$("depositModal").classList.add("hidden");$("depositModal").setAttribute("aria-hidden","true");$("depositMessage").textContent="";resumeAutoRefresh();load();
}
async function confirmDeposit(){
 if(!editingDepositId)return;
 const field=$("depositApproved"),value=Number(String(field.value).replace(",","."));if(!Number.isFinite(value)||value<=0){$("depositMessage").textContent="Informe um valor válido.";field.focus();return}
 $("depositConfirm").disabled=true;$("depositMessage").textContent="Confirmando e creditando...";
 try{
  await api("/api/admin/deposits/"+editingDepositId+"/approve",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({approvedAmount:value})});
  $("depositMessage").textContent="Depósito confirmado e saldo creditado.";setTimeout(closeDepositEditor,500);
 }catch(e){$("depositMessage").textContent=e.message}finally{$("depositConfirm").disabled=false}
}
function showAdminLogin(){
 adminAuthenticated=false;pauseAutoRefresh();$("loginPanel").classList.remove("hidden");$("loginPanel").setAttribute("aria-hidden","false");$("adminUser").focus();
}
async function verifyAdminSession(){
 try{await api("/api/admin/session");adminAuthenticated=true;$("loginPanel").classList.add("hidden");$("loginPanel").setAttribute("aria-hidden","true");return true}
 catch{showAdminLogin();return false}
}
async function adminLogin(event){
 event.preventDefault();const button=document.querySelector("#adminLogin button[type=submit]"),message=$("loginMessage");button.disabled=true;message.textContent="";
 try{
  await api("/api/auth/admin-login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:$("adminUser").value.trim(),password:$("adminPassword").value})});
  adminAuthenticated=true;$("loginPanel").classList.add("hidden");$("loginPanel").setAttribute("aria-hidden","true");$("adminPassword").value="";previousPendingCount=null;await load();await updateAppBadge();
 }catch(error){message.textContent=error.message||"Não foi possível entrar no administrador."}finally{button.disabled=false}
}
$("adminLogin")?.addEventListener("submit",adminLogin);

async function load(){
 if(!adminAuthenticated)return false;
 try{
  const transactionUrl=new URL("/api/admin/transactions",location.origin); Object.entries(transactionFilters).forEach(([key,value])=>{if(value)transactionUrl.searchParams.set(key,value)}); const [u,d,w,s,t,rq]=await Promise.all([api("/api/admin/users"),api("/api/admin/deposits"),api("/api/admin/withdrawals"),api("/api/admin/settings"),api(transactionUrl.toString()),api("/api/admin/roulette/config")]);
  const deposits=Array.isArray(d.deposits)?d.deposits:[],withdrawals=Array.isArray(w.withdrawals)?w.withdrawals:[],users=Array.isArray(u.users)?u.users:[],settings=Array.isArray(s.settings)?s.settings:[],transactions=Array.isArray(t.transactions)?t.transactions:[],roulette=rq.roulette||null; cachedUsers=users;
  const pendingDeposits=deposits.filter(x=>x.status==="pending"),pendingWithdrawals=withdrawals.filter(x=>x.status==="pending"),pendingCount=pendingDeposits.length+pendingWithdrawals.length;
  $("depositsCount").textContent=pendingDeposits.length;$("withdrawalsCount").textContent=pendingWithdrawals.length;
  renderPendingEvents(deposits,withdrawals);renderUsers(users);renderDeposits(deposits);renderWithdrawals(withdrawals);renderTransactions(transactions);renderSettings(settings);renderRouletteSettings(settings,roulette);
  if(previousPendingCount!==null&&pendingCount>previousPendingCount){
   const n=pendingCount-previousPendingCount;$("adminMessage").style.color="#35c58a";$("adminMessage").textContent=`🔔 ${n} novo${n>1?"s":""} evento${n>1?"s":""} aguardando atendimento.`;
   if(notifyReady&&"Notification"in window&&Notification.permission==="granted"){try{const reg=await navigator.serviceWorker.ready;await reg.showNotification("MyBets • Novo evento",{body:`${n} novo${n>1?"s":""} evento${n>1?"s":""} aguardando atendimento.`,tag:"new-admin-event",data:{url:"/admin.html"},renotify:true})}catch(error){console.warn("Notificação local:",error)}}
   if(navigator.vibrate)navigator.vibrate([180,80,180]);
  }
  previousPendingCount=pendingCount;notifyReady=true;bindActions();
 }catch(e){if(e.message.includes("Sessão administrativa"))showAdminLogin();else $("adminMessage").textContent=e.message}
 return adminAuthenticated;
}
function bindActions(){
 $("signupBonusSave")?.addEventListener("click",async()=>{
  const field=$("signupBonusAmount"),value=Number(String(field.value).replace(",","."));
  const msg=$("signupBonusMessage");
  if(!Number.isFinite(value)||value<0){msg.textContent="Informe um valor válido.";return}
  const button=$("signupBonusSave");button.disabled=true;msg.textContent="Salvando...";
  try{await api("/api/admin/settings/signup_bonus_amount",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({value:value.toFixed(2)})});msg.textContent="Bônus salvo. A nova regra vale para os próximos cadastros.";await load();}
  catch(e){msg.textContent=e.message||"Não foi possível salvar."}finally{button.disabled=false}
 });
 document.querySelectorAll(".approve-deposit").forEach(b=>b.onclick=()=>openDepositEditor(b.dataset.id,b.dataset.username,b.dataset.amount));
 document.querySelectorAll(".reject-deposit").forEach(b=>b.onclick=()=>action("/api/admin/deposits/"+b.dataset.id+"/reject","POST",{}));
 document.querySelectorAll(".approve-withdrawal").forEach(b=>b.onclick=()=>action("/api/admin/withdrawals/"+b.dataset.id+"/approve","POST",{}));
 document.querySelectorAll(".reject-withdrawal").forEach(b=>b.onclick=()=>action("/api/admin/withdrawals/"+b.dataset.id+"/reject","POST",{rejectionReason:"Rejeitado pelo administrador"}));
 document.querySelectorAll(".history-user").forEach(b=>b.onclick=()=>openUserHistory(b.dataset.id));
 document.querySelectorAll(".add-cash").forEach(b=>b.onclick=async()=>{const v=prompt("Valor para adicionar ao saldo. O bônus da promoção será aplicado automaticamente:");if(v)await action("/api/admin/users/"+b.dataset.id+"/balance","POST",{amount:Number(v),kind:"cash"})});
 document.querySelectorAll(".add-bonus").forEach(b=>b.onclick=async()=>{const v=prompt("Valor de bônus para este jogador:");if(v)await action("/api/admin/users/"+b.dataset.id+"/balance","POST",{amount:Number(v),kind:"bonus"})});
 document.querySelectorAll(".ban-user").forEach(b=>b.onclick=async()=>{const reason=prompt("Motivo do banimento:","Banimento administrativo");if(reason===null||!reason.trim())return;if(!confirm("Banir este usuário? O acesso será encerrado imediatamente."))return;await action("/api/admin/users/"+b.dataset.id+"/ban","POST",{reason:reason.trim()})});
 document.querySelectorAll(".unban-user").forEach(b=>b.onclick=async()=>{if(!confirm("Desbanir este usuário?"))return;await action("/api/admin/users/"+b.dataset.id+"/unban","POST",{})});
 document.querySelectorAll(".delete-user").forEach(b=>b.onclick=async()=>{if(!confirm("Excluir este usuário? O histórico financeiro será preservado e a conta ficará permanentemente inacessível."))return;await action("/api/admin/users/"+b.dataset.id+"/delete","POST",{})});
 $("rouletteSave")?.addEventListener("click",async()=>{
  const min=Number(String($("rouletteMinBet").value).replace(",","."));
  const max=Number(String($("rouletteMaxBet").value).replace(",","."));
  if(!Number.isFinite(min)||min<=0||!Number.isFinite(max)||max<min){
   $("rouletteMessage").textContent="Confira o valor mínimo e máximo.";
   return;
  }
  const button=$("rouletteSave");button.disabled=true;$("rouletteMessage").textContent="Salvando...";
  try{
   await api("/api/admin/settings/roulette_min_bet",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({value:min.toFixed(2)})});
   await api("/api/admin/settings/roulette_max_bet",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({value:max.toFixed(2)})});
   $("rouletteMessage").textContent="Configurações da roleta salvas.";
   await load();
  }catch(e){$("rouletteMessage").textContent=e.message||"Não foi possível salvar."}
  finally{button.disabled=false}
 });
 document.querySelectorAll(".edit-setting").forEach(b=>b.onclick=async()=>{const v=prompt("Novo valor para "+b.dataset.key,b.dataset.value);if(v!==null)await action("/api/admin/settings/"+encodeURIComponent(b.dataset.key),"PUT",{value:v})});
}
async function action(url,method,body){
 try{await api(url,{method,headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});await load();await updateAppBadge()}
 catch(e){$("adminMessage").textContent=e.message}
}
$("userSearch")?.addEventListener("input",e=>{userSearchTerm=e.target.value;renderUsers(cachedUsers)});
$("transactionSearch")?.addEventListener("click",()=>{transactionFilters={query:$("transactionUserSearch").value.trim(),type:$("transactionType").value,from:$("transactionFrom").value,to:$("transactionTo").value};load()});
$("transactionClear")?.addEventListener("click",()=>{$("transactionUserSearch").value="";$("transactionType").value="";$("transactionFrom").value="";$("transactionTo").value="";transactionFilters={query:"",type:"",from:"",to:""};load()});
$("historyClose")?.addEventListener("click",closeHistoryModal);
$("historyModal")?.addEventListener("click",e=>{
 if(e.target.id==="historyModal"){closeHistoryModal();return}
 const button=e.target.closest(".history-page");
 if(button&&!button.disabled)loadHistoryPage(button.dataset.section,Number(button.dataset.page));
});
$("enableNotifications").onclick=async()=>{try{await enableNotifications();await updateAppBadge()}catch(err){$("notifyStatus").textContent=err.message||"Não foi possível ativar as notificações."}};
$("adminLogout").onclick=async()=>{
 const button=$("adminLogout");button.disabled=true;
 try{await api("/api/auth/admin-logout",{method:"POST"})}catch(error){$("adminMessage").textContent=error.message||"Não foi possível sair.";button.disabled=false;return}
 adminAuthenticated=false;if(refreshTimer){clearInterval(refreshTimer);refreshTimer=null}window.location.replace("/");
};
$("depositClose").onclick=closeDepositEditor;$("depositCancel").onclick=closeDepositEditor;$("depositConfirm").onclick=confirmDeposit;
$("depositModal").addEventListener("click",e=>{if(e.target.id==="depositModal")closeDepositEditor()});
$("depositApproved").addEventListener("input",()=>{$("depositMessage").textContent=""});
bindNavigation();
registerServiceWorker();
if("Notification"in window&&Notification.permission==="granted")$("notifyStatus").textContent=isAdminHomeScreenApp()?"Permissão já concedida. Toque em ATIVAR NOTIFICAÇÕES para concluir o cadastro deste dispositivo.":"Abra o MyBets pelo ícone da Tela de Início para usar notificações.";
(async()=>{
 if(await verifyAdminSession()){
  const hash=location.hash.replace("#","");
  const initialView=["users","deposits","withdrawals","transactions","settings","roulette"].includes(hash)?hash:"dashboard";
  openView(initialView);
  await load();await updateAppBadge();setInterval(()=>{if(adminAuthenticated)updateAppBadge()},5000);resumeAutoRefresh();
 }
})();
(()=>{
 const app=document.querySelector(".admin-app"),toggle=$("adminMenuToggle"),sidebar=document.querySelector(".admin-sidebar"),overlay=$("adminMobileOverlay");
 if(!app||!toggle||!sidebar||!overlay)return;
 const setMenuOpen=open=>{
  app.dataset.mobileMenu=open?"open":"closed";
  toggle.setAttribute("aria-expanded",String(open));
 };
 const isOpen=()=>app.dataset.mobileMenu==="open";
 setMenuOpen(false);
 toggle.addEventListener("click",e=>{
  e.preventDefault();
  e.stopPropagation();
  setMenuOpen(!isOpen());
 });
 overlay.addEventListener("click",e=>{
  e.preventDefault();
  setMenuOpen(false);
 });
 sidebar.addEventListener("click",e=>{
  if(e.target.closest(".admin-nav-link"))setMenuOpen(false);
 });
 document.querySelector(".admin-main")?.addEventListener("click",e=>{
  if(isOpen()&&!sidebar.contains(e.target))setMenuOpen(false);
 });
 document.addEventListener("keydown",e=>{
  if(e.key==="Escape")setMenuOpen(false);
 });
 window.closeMobileMenu=()=>setMenuOpen(false);
})();
