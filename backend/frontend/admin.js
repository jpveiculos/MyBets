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
 $("users").innerHTML=users.map(x=>`<div class="admin-row"><span><b>#${x.id} • ${esc(x.username)}</b><small>Saldo: ${money(x.cash_balance)} • Bônus: ${money(x.bonus_balance)} • Total: ${money(x.total_balance)} • Reserva: ${money(x.reserved_balance)}</small></span><span class="row-actions"><button data-id="${x.id}" class="small-btn add-cash">+ saldo</button><button data-id="${x.id}" class="small-btn add-bonus">+ bônus</button></span></div>`).join("")||'<p class="muted">Nenhum usuário.</p>';
}
function renderDeposits(deposits){
 $("deposits").innerHTML=deposits.map(x=>`<div class="admin-row"><span><b>#${x.id} • ${esc(x.username)}</b><small>Informado: ${money(x.amount)} • ${dateTime(x.created_at)}</small><span class="admin-status ${statusClass(x.status)}">${statusLabel(x.status)}${x.approved_amount!=null?" • Creditado: "+money(x.approved_amount):""}</span></span><span class="row-actions">${x.status==="pending"?'<button class="small-btn approve-deposit" data-id="'+x.id+'" data-username="'+esc(x.username)+'" data-amount="'+x.amount+'">Conferir / creditar</button><button class="small-btn reject-deposit" data-id="'+x.id+'">Rejeitar</button>':""}</span></div>`).join("")||'<p class="muted">Nenhum depósito.</p>';
}
function renderWithdrawals(withdrawals){
 $("withdrawals").innerHTML=withdrawals.map(x=>`<div class="admin-row"><span><b>#${x.id} • ${esc(x.username)}</b><small>${money(x.amount)} • Pix: ${esc(x.pix_key)} • ${dateTime(x.created_at)}</small><span class="admin-status ${statusClass(x.status)}">${statusLabel(x.status)}</span></span><span class="row-actions">${x.status==="pending"?'<button class="small-btn approve-withdrawal" data-id="'+x.id+'">Aprovar</button><button class="small-btn reject-withdrawal" data-id="'+x.id+'">Rejeitar</button>':""}</span></div>`).join("")||'<p class="muted">Nenhum saque.</p>';
}
function renderTransactions(transactions){
 $("transactions").innerHTML=transactions.map(x=>`<div class="admin-row"><span><b>#${x.id} • ${esc(x.username)}</b><small>${esc(x.type)} • ${money(x.amount)} • ${dateTime(x.created_at)}</small></span></div>`).join("")||'<p class="muted">Nenhuma transação.</p>';
}
function renderRouletteSettings(settings){
 const minField=$("rouletteMinBet"),maxField=$("rouletteMaxBet"),prizesField=$("roulettePrizes");
 if(document.activeElement===minField||document.activeElement===maxField||document.activeElement===prizesField)return;
 if(!minField||!maxField||!prizesField)return;
 const map=Object.fromEntries(settings.map(x=>[x.setting_key,x.setting_value]));
 minField.value=map.roulette_min_bet??"0.50";
 maxField.value=map.roulette_max_bet??"100.00";
 try{
  const prizes=JSON.parse(map.roulette_prizes??"[2,2,2,2,2,2,2,2,2,2]");
  $("roulettePrizes").value=Array.isArray(prizes)?prizes.join(","):"2,3,2,4,3,2,5,3,2,4";
 }catch{
  $("roulettePrizes").value="2,3,2,4,3,2,5,3,2,4";
 }
}
function renderSettings(settings){
 $("settings").innerHTML=settings.map(x=>`<div class="admin-row"><span><b>${esc(x.setting_key)}</b><small>${esc(x.setting_value)}</small></span><button class="small-btn edit-setting" data-key="${esc(x.setting_key)}" data-value="${esc(x.setting_value)}">Editar</button></div>`).join("")||'<p class="muted">Nenhuma configuração.</p>';
}
function renderPendingEvents(deposits,withdrawals){
 const pendingDeposits=deposits.filter(x=>x.status==="pending");
 const pendingWithdrawals=withdrawals.filter(x=>x.status==="pending");
 const events=[
  ...pendingDeposits.map(x=>({kind:"deposit",date:x.created_at,id:x.id,user:x.username,amount:x.amount})),
  ...pendingWithdrawals.map(x=>({kind:"withdrawal",date:x.created_at,id:x.id,user:x.username,amount:x.amount,pix:x.pix_key}))
 ].sort((a,b)=>new Date(b.date)-new Date(a.date));
 $("eventsCount").textContent=events.length+" pendente"+(events.length===1?"":"s");
 if(!events.length){
  $("pendingEvents").innerHTML='<div class="admin-empty-events"><strong>Nenhum evento novo</strong><span>Tudo resolvido por enquanto.</span></div>';
  return;
 }
 $("pendingEvents").innerHTML=events.map(x=>x.kind==="deposit"
  ?`<div class="admin-event admin-event-deposit"><div class="admin-event-icon">↓</div><div class="admin-event-body"><b>Novo depósito #${x.id}</b><span>${esc(x.user)} • ${money(x.amount)} • ${dateTime(x.date)}</span></div><div class="row-actions"><button class="small-btn approve-deposit" data-id="${x.id}" data-username="${esc(x.user)}" data-amount="${x.amount}">Conferir / creditar</button><button class="small-btn reject-deposit" data-id="${x.id}">Rejeitar</button></div></div>`
  :`<div class="admin-event admin-event-withdrawal"><div class="admin-event-icon">↑</div><div class="admin-event-body"><b>Novo saque #${x.id}</b><span>${esc(x.user)} • ${money(x.amount)} • Pix: ${esc(x.pix||"—")} • ${dateTime(x.date)}</span></div><div class="row-actions"><button class="small-btn approve-withdrawal" data-id="${x.id}">Aprovar</button><button class="small-btn reject-withdrawal" data-id="${x.id}">Rejeitar</button></div></div>`
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
  const [u,d,w,s,t]=await Promise.all([api("/api/admin/users"),api("/api/admin/deposits"),api("/api/admin/withdrawals"),api("/api/admin/settings"),api("/api/admin/transactions")]);
  const deposits=Array.isArray(d.deposits)?d.deposits:[],withdrawals=Array.isArray(w.withdrawals)?w.withdrawals:[],users=Array.isArray(u.users)?u.users:[],settings=Array.isArray(s.settings)?s.settings:[],transactions=Array.isArray(t.transactions)?t.transactions:[];
  const pendingDeposits=deposits.filter(x=>x.status==="pending"),pendingWithdrawals=withdrawals.filter(x=>x.status==="pending"),pendingCount=pendingDeposits.length+pendingWithdrawals.length;
  $("depositsCount").textContent=pendingDeposits.length;$("withdrawalsCount").textContent=pendingWithdrawals.length;
  renderPendingEvents(deposits,withdrawals);renderUsers(users);renderDeposits(deposits);renderWithdrawals(withdrawals);renderTransactions(transactions);renderSettings(settings);renderRouletteSettings(settings);bindRouletteEditing();
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
 document.querySelectorAll(".approve-deposit").forEach(b=>b.onclick=()=>openDepositEditor(b.dataset.id,b.dataset.username,b.dataset.amount));
 document.querySelectorAll(".reject-deposit").forEach(b=>b.onclick=()=>action("/api/admin/deposits/"+b.dataset.id+"/reject","POST",{}));
 document.querySelectorAll(".approve-withdrawal").forEach(b=>b.onclick=()=>action("/api/admin/withdrawals/"+b.dataset.id+"/approve","POST",{}));
 document.querySelectorAll(".reject-withdrawal").forEach(b=>b.onclick=()=>action("/api/admin/withdrawals/"+b.dataset.id+"/reject","POST",{rejectionReason:"Rejeitado pelo administrador"}));
 document.querySelectorAll(".add-cash").forEach(b=>b.onclick=async()=>{const v=prompt("Valor para adicionar ao saldo depositado:");if(v)await action("/api/admin/users/"+b.dataset.id+"/balance","POST",{amount:Number(v),kind:"cash"})});
 document.querySelectorAll(".add-bonus").forEach(b=>b.onclick=async()=>{const v=prompt("Valor de bônus para este jogador:");if(v)await action("/api/admin/users/"+b.dataset.id+"/balance","POST",{amount:Number(v),kind:"bonus"})});
 $("rouletteSave")?.addEventListener("click",async()=>{
  const min=Number(String($("rouletteMinBet").value).replace(",",".")),max=Number(String($("rouletteMaxBet").value).replace(",","."));
  const prizes=String($("roulettePrizes").value).split(",").map(v=>Number(v.trim().replace(",",".")));
  if(!Number.isFinite(min)||min<=0||!Number.isFinite(max)||max<min||prizes.length!==10||prizes.some(v=>!Number.isFinite(v)||v<=0)){
   $("rouletteMessage").textContent="Confira mínimo, máximo e os 10 multiplicadores.";
   return;
  }
  const button=$("rouletteSave");button.disabled=true;$("rouletteMessage").textContent="Salvando...";
  try{
   await api("/api/admin/settings/roulette_min_bet",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({value:min.toFixed(2)})});
   await api("/api/admin/settings/roulette_max_bet",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({value:max.toFixed(2)})});
   await api("/api/admin/settings/roulette_prizes",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({value:JSON.stringify(prizes)})});
   $("rouletteMessage").textContent="Configurações da roleta salvas.";
   await load();
  }catch(e){$("rouletteMessage").textContent=e.message||"Não foi possível salvar."}
  finally{button.disabled=false}
 });
 document.querySelectorAll(".edit-setting").forEach(b=>b.onclick=async()=>{const v=prompt("Novo valor para "+b.dataset.key,b.dataset.value);if(v!==null)await action("/api/admin/settings/"+encodeURIComponent(b.dataset.key),"PUT",{value:v})});
}
async function bindRouletteEditing(){
 [$("rouletteMinBet"),$("rouletteMaxBet"),$("roulettePrizes")].forEach(field=>{
  if(!field||field.dataset.editingBound==="true")return;
  field.dataset.editingBound="true";
  field.addEventListener("focus",pauseAutoRefresh);
  field.addEventListener("blur",()=>{resumeAutoRefresh();load()});
 });
}
function action(url,method,body){
 try{await api(url,{method,headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});await load();await updateAppBadge()}
 catch(e){$("adminMessage").textContent=e.message}
}
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
