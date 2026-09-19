const $=id=>document.getElementById(id);
const money=v=>Number(v||0).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
async function api(url,options={}){const r=await fetch(url,{credentials:"same-origin",...options});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.message||"Erro.");return d}
const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
let previousPendingDeposits=null;
let pushSubscription=null;
let notifyReady=false;
let refreshTimer=null;
let editingDepositId=null;
let isEditingDeposit=false;

function urlBase64ToUint8Array(base64String){
 const padding="=".repeat((4-base64String.length%4)%4);
 const base64=(base64String+padding).replace(/-/g,"+").replace(/_/g,"/");
 const raw=atob(base64);return Uint8Array.from([...raw].map(c=>c.charCodeAt(0)));
}
async function registerServiceWorker(){
 if(!("serviceWorker" in navigator))return null;
 try{return await navigator.serviceWorker.register("/sw.js",{scope:"/"})}catch(e){console.warn("Service Worker:",e);return null}
}
async function enableNotifications(){
 if(!("Notification" in window)){ $("notifyStatus").textContent="Este navegador não oferece notificações web."; return false; }
 const permission=Notification.permission==="default"?await Notification.requestPermission():Notification.permission;
 if(permission!=="granted"){ $("notifyStatus").textContent=permission==="denied"?"Notificações bloqueadas. Ative-as nos Ajustes do iPhone.":"Permissão não concedida."; return false; }
 const reg=await registerServiceWorker();
 if(!reg||!("PushManager" in window))return;
 const key=(await api("/api/push/public-key")).publicKey;
 if(!key){$("notifyStatus").textContent="Push ainda não configurado no servidor.";return false;}
 const existing=await reg.pushManager.getSubscription();
 pushSubscription=existing||await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:urlBase64ToUint8Array(key)});
 await api("/api/admin/push/subscribe",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(pushSubscription.toJSON())});
 $("notifyStatus").textContent="Notificações ativadas neste dispositivo.";
 $("enableNotifications").textContent="NOTIFICAÇÕES ATIVAS";
 $("enableNotifications").disabled=true;
 return true;
}
async function updateAppBadge(){
 if(!navigator.setAppBadge)return;
 try{const d=await api("/api/admin/notifications/count");if(d.count>0)await navigator.setAppBadge(d.count);else if(navigator.clearAppBadge)await navigator.clearAppBadge()}catch{}
}
function pauseAutoRefresh(){
  isEditingDeposit=true;
  if(refreshTimer){clearInterval(refreshTimer);refreshTimer=null;}
}

function resumeAutoRefresh(){
  isEditingDeposit=false;
  if(refreshTimer)clearInterval(refreshTimer);
  refreshTimer=setInterval(()=>{if(!isEditingDeposit)load()},10000);
}

function openDepositEditor(id,username,amount){
  pauseAutoRefresh();
  editingDepositId=id;
  $("depositTitle").textContent="Confirmar depósito #"+id;
  $("depositInfo").textContent="Jogador: "+username;
  $("depositDeclared").value=money(amount);
  $("depositApproved").value=Number(amount).toFixed(2);
  $("depositMessage").textContent="";
  $("depositModal").classList.remove("hidden");
  $("depositModal").setAttribute("aria-hidden","false");
  setTimeout(()=>{$("depositApproved").focus();$("depositApproved").select()},50);
}

function closeDepositEditor(){
  editingDepositId=null;
  $("depositModal").classList.add("hidden");
  $("depositModal").setAttribute("aria-hidden","true");
  $("depositMessage").textContent="";
  resumeAutoRefresh();
  load();
}

async function confirmDeposit(){
  if(!editingDepositId)return;
  const field=$("depositApproved");
  const value=Number(String(field.value).replace(",","."));
  if(!Number.isFinite(value)||value<=0){
    $("depositMessage").textContent="Informe um valor válido.";
    field.focus();
    return;
  }
  $("depositConfirm").disabled=true;
  $("depositMessage").textContent="Confirmando e creditando...";
  try{
    await api("/api/admin/deposits/"+editingDepositId+"/approve",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({approvedAmount:value})
    });
    $("depositMessage").textContent="Depósito confirmado e saldo creditado.";
    setTimeout(closeDepositEditor,500);
  }catch(e){
    $("depositMessage").textContent=e.message;
  }finally{
    $("depositConfirm").disabled=false;
  }
}

async function load(){
 try{
  const [u,d,w,s]=await Promise.all([api("/api/admin/users"),api("/api/admin/deposits"),api("/api/admin/withdrawals"),api("/api/admin/settings")]);
  let t={transactions:[]};
  try{const response=await api("/api/admin/transactions");if(response&&Array.isArray(response.transactions))t=response}catch(error){console.warn("Histórico administrativo:",error)}
  const transactions=Array.isArray(t?.transactions)?t.transactions:[];
  const pending=d.deposits.filter(x=>x.status==="pending");
  $("adminLogout").classList.remove("hidden");
  $("usersCount").textContent=u.users.length;$("depositsCount").textContent=pending.length;$("withdrawalsCount").textContent=w.withdrawals.filter(x=>x.status==="pending").length;$("transactionsCount").textContent=transactions.length;
  $("users").innerHTML=u.users.map(x=>`<div class="admin-row"><span><b>#${x.id} ${esc(x.username)}</b><small>Total: ${money(x.total_balance)} • Reserva: ${money(x.reserved_balance)}</small></span><span class="row-actions"><button data-id="${x.id}" class="small-btn add">+ saldo</button></span></div>`).join("")||"<p class='muted'>Nenhum usuário.</p>";
  $("deposits").innerHTML=pending.map(x=>`<div class="admin-row"><span><b>#${x.id} • ${esc(x.username)}</b><small>Informado: ${money(x.amount)} • ${new Date(x.created_at).toLocaleString("pt-BR")}</small></span><span class="row-actions"><button class="small-btn approve-deposit" data-id="${x.id}" data-username="${esc(x.username)}" data-amount="${x.amount}">Conferir / creditar</button><button class="small-btn reject-deposit" data-id="${x.id}">Rejeitar</button></span></div>`).join("")||"<p class='muted'>Nenhum depósito pendente.</p>";
  $("withdrawals").innerHTML=w.withdrawals.filter(x=>x.status==="pending").map(x=>`<div class="admin-row"><span><b>#${x.id} • ${esc(x.username)}</b><small>${money(x.amount)} • Pix: ${esc(x.pix_key)}</small></span><span class="row-actions"><button class="small-btn approve-withdrawal" data-id="${x.id}">Aprovar</button><button class="small-btn reject-withdrawal" data-id="${x.id}">Rejeitar</button></span></div>`).join("")||"<p class='muted'>Nenhum saque pendente.</p>";
  $("transactions").innerHTML=transactions.slice(0,50).map(x=>`<div class="admin-row"><span><b>#${x.id} • ${esc(x.username)}</b><small>${esc(x.type)} • ${money(x.amount)} • ${new Date(x.created_at).toLocaleString("pt-BR")}</small></span></div>`).join("")||"<p class=\"muted\">Nenhuma transação.</p>";
  $("settings").innerHTML=s.settings.map(x=>`<div class="admin-row"><span><b>${esc(x.setting_key)}</b><small>${esc(x.setting_value)}</small></span><button class="small-btn edit-setting" data-key="${esc(x.setting_key)}" data-value="${esc(x.setting_value)}">Editar</button></div>`).join("");
  if(previousPendingDeposits!==null && pending.length>previousPendingDeposits){
    const n=pending.length-previousPendingDeposits;
    $("adminMessage").style.color="#35c58a";$("adminMessage").textContent=`🔔 ${n} novo${n>1?"s":""} depósito${n>1?"s":""} aguardando conferência.`;
    if(notifyReady && "Notification" in window && Notification.permission==="granted"){
      const message={title:"MyBets • Novo depósito",body:`${n} novo depósito aguardando conferência.`,tag:"new-deposit",url:"/admin.html"};
      try{
        const reg=await navigator.serviceWorker.ready;
        await reg.showNotification(message.title,{body:message.body,tag:message.tag,data:{url:message.url},renotify:true});
      }catch(error){console.warn("Notificação local:",error)}
    }
    if(navigator.vibrate) navigator.vibrate([180,80,180]);
  }
  previousPendingDeposits=pending.length;notifyReady=true;bind();
 }catch(e){
  if(e.message.includes("Sessão administrativa")){window.location.reload();}
  else $("adminMessage").textContent=e.message;
 }}

function bind(){
 document.querySelectorAll(".approve-deposit").forEach(b=>b.onclick=()=>openDepositEditor(b.dataset.id,b.dataset.username,b.dataset.amount));
 document.querySelectorAll(".reject-deposit").forEach(b=>b.onclick=()=>action("/api/admin/deposits/"+b.dataset.id+"/reject","POST",{}));
 document.querySelectorAll(".approve-withdrawal").forEach(b=>b.onclick=()=>action("/api/admin/withdrawals/"+b.dataset.id+"/approve","POST",{}));
 document.querySelectorAll(".reject-withdrawal").forEach(b=>b.onclick=()=>action("/api/admin/withdrawals/"+b.dataset.id+"/reject","POST",{rejectionReason:"Rejeitado pelo administrador"}));
 document.querySelectorAll(".add").forEach(b=>b.onclick=async()=>{const v=prompt("Valor para adicionar ao saldo:");if(v)await action("/api/admin/users/"+b.dataset.id+"/balance","POST",{amount:Number(v),kind:"cash"})});
 document.querySelectorAll(".edit-setting").forEach(b=>b.onclick=async()=>{const v=prompt("Novo valor para "+b.dataset.key,b.dataset.value);if(v!==null)await action("/api/admin/settings/"+encodeURIComponent(b.dataset.key),"PUT",{value:v})});
}

async function action(url,method,body){
 try{await api(url,{method,headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});load()}
 catch(e){$("adminMessage").textContent=e.message}
}

$("enableNotifications").onclick=async()=>{ try{ await enableNotifications(); await updateAppBadge(); }catch(err){ $("notifyStatus").textContent=err.message||"Não foi possível ativar as notificações."; } };


$("adminLogout").onclick=async()=>{await api("/api/auth/logout",{method:"POST"});location.reload()};
$("depositClose").onclick=closeDepositEditor;
$("depositCancel").onclick=closeDepositEditor;
$("depositConfirm").onclick=confirmDeposit;
$("depositModal").addEventListener("click",e=>{if(e.target.id==="depositModal")closeDepositEditor()});
$("depositApproved").addEventListener("input",()=>{$("depositMessage").textContent=""});

registerServiceWorker();
if("Notification" in window && Notification.permission==="granted") $("notifyStatus").textContent="Permissão já concedida. Toque em ATIVAR NOTIFICAÇÕES para concluir o cadastro deste dispositivo.";
load();
resumeAutoRefresh();
(() => {
  const toggle=document.getElementById("adminMenuToggle");
  const sidebar=document.querySelector(".admin-sidebar");
  const overlay=document.getElementById("adminMobileOverlay");
  if(!toggle||!sidebar||!overlay)return;
  const close=()=>{sidebar.classList.remove("open");overlay.classList.remove("open")};
  toggle.addEventListener("click",()=>{sidebar.classList.toggle("open");overlay.classList.toggle("open")});
  overlay.addEventListener("click",close);
  sidebar.querySelectorAll("a").forEach(a=>a.addEventListener("click",close));
})();
