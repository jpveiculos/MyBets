const $=id=>document.getElementById(id);
const money=v=>Number(v||0).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
async function api(url,options={}){const r=await fetch(url,{credentials:"same-origin",...options});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.message||"Erro.");return d}
const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
async function load(){
 try{
  const [u,d,w,s]=await Promise.all([api("/api/admin/users"),api("/api/admin/deposits"),api("/api/admin/withdrawals"),api("/api/admin/settings")]);
  $("loginPanel").classList.add("hidden");$("adminPanel").classList.remove("hidden");$("adminLogout").classList.remove("hidden");
  $("users").innerHTML=u.users.map(x=>`<div class="admin-row"><span><b>#${x.id} ${esc(x.username)}</b><small>Total: ${money(x.total_balance)} • Reserva: ${money(x.reserved_balance)}</small></span><span class="row-actions"><button data-id="${x.id}" class="small-btn add">+ saldo</button></span></div>`).join("")||"<p class='muted'>Nenhum usuário.</p>";
  $("deposits").innerHTML=d.deposits.filter(x=>x.status==="pending").map(x=>`<div class="admin-row"><span><b>#${x.id} • ${esc(x.username)}</b><small>${money(x.amount)}</small></span><span class="row-actions"><button class="small-btn approve-deposit" data-id="${x.id}">Aprovar</button><button class="small-btn reject-deposit" data-id="${x.id}">Rejeitar</button></span></div>`).join("")||"<p class='muted'>Nenhum pendente.</p>";
  $("withdrawals").innerHTML=w.withdrawals.filter(x=>x.status==="pending").map(x=>`<div class="admin-row"><span><b>#${x.id} • ${esc(x.username)}</b><small>${money(x.amount)} • Pix: ${esc(x.pix_key)}</small></span><span class="row-actions"><button class="small-btn approve-withdrawal" data-id="${x.id}">Aprovar</button><button class="small-btn reject-withdrawal" data-id="${x.id}">Rejeitar</button></span></div>`).join("")||"<p class='muted'>Nenhum pendente.</p>";
  $("settings").innerHTML=s.settings.map(x=>`<div class="admin-row"><span><b>${esc(x.setting_key)}</b><small>${esc(x.setting_value)}</small></span><button class="small-btn edit-setting" data-key="${esc(x.setting_key)}" data-value="${esc(x.setting_value)}">Editar</button></div>`).join("");
  bind();
 }catch(e){
  if(e.message.includes("Sessão administrativa")){ $("loginPanel").classList.remove("hidden");$("adminPanel").classList.add("hidden");$("adminLogout").classList.add("hidden"); }
  else $("adminMessage").textContent=e.message;
 }}
function bind(){
 document.querySelectorAll(".approve-deposit").forEach(b=>b.onclick=()=>action("/api/admin/deposits/"+b.dataset.id+"/approve","POST",{}));
 document.querySelectorAll(".reject-deposit").forEach(b=>b.onclick=()=>action("/api/admin/deposits/"+b.dataset.id+"/reject","POST",{}));
 document.querySelectorAll(".approve-withdrawal").forEach(b=>b.onclick=()=>action("/api/admin/withdrawals/"+b.dataset.id+"/approve","POST",{}));
 document.querySelectorAll(".reject-withdrawal").forEach(b=>b.onclick=()=>action("/api/admin/withdrawals/"+b.dataset.id+"/reject","POST",{rejectionReason:"Rejeitado pelo administrador"}));
 document.querySelectorAll(".add").forEach(b=>b.onclick=async()=>{const v=prompt("Valor para adicionar ao saldo:");if(v)await action("/api/admin/users/"+b.dataset.id+"/balance","POST",{amount:Number(v),kind:"cash"})});
 document.querySelectorAll(".edit-setting").forEach(b=>b.onclick=async()=>{const v=prompt("Novo valor para "+b.dataset.key,b.dataset.value);if(v!==null)await action("/api/admin/settings/"+encodeURIComponent(b.dataset.key),"PUT",{value:v})});
}
async function action(url,method,body){try{await api(url,{method,headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});load()}catch(e){$("adminMessage").textContent=e.message}}
$("adminLogin").onsubmit=async e=>{e.preventDefault();$("loginMessage").textContent="";try{await api("/api/auth/admin-login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:$("adminUser").value.trim(),password:$("adminPassword").value})});load()}catch(err){$("loginMessage").textContent=err.message}};
$("adminLogout").onclick=async()=>{await api("/api/auth/logout",{method:"POST"});location.reload()};
load();
