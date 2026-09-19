let authMode="login";

const $=id=>document.getElementById(id);

function setHomeState(loggedIn){
  const auth=$("homeAuth");
  const footer=$("playerFooterNav");
  if(!auth)return;

  if(loggedIn){
    auth.innerHTML='<button class="ghost-btn" id="homeLogout">Sair</button>';
    footer?.classList.remove("hidden");
    $("homeLogout")?.addEventListener("click",logoutFromHome);
  }else{
    auth.innerHTML='<button class="ghost-btn" id="openLogin">Entrar</button>';
    footer?.classList.add("hidden");
    $("openLogin")?.addEventListener("click",()=>showAuth("login"));
  }
  auth.classList.remove("session-pending");
}

async function logoutFromHome(){
  try{
    const r=await fetch("/api/auth/logout",{method:"POST",credentials:"same-origin"});
    if(!r.ok)throw new Error();
  }catch{}
  setHomeState(false);
}

async function checkPlayerSession(){
  try{
    const r=await fetch("/api/account",{credentials:"same-origin",cache:"no-store"});
    setHomeState(r.ok);
  }catch{
    setHomeState(false);
  }
}

function showAuth(mode="login"){
  authMode=mode;$("authModal").classList.remove("hidden");
  document.querySelectorAll(".tab").forEach(t=>t.classList.toggle("active",t.dataset.mode===mode));
  $("authTitle").textContent=mode==="login"?"Entrar":"Criar conta";
  $("authSubmit").textContent=mode==="login"?"Entrar":"Criar conta";
  $("password").autocomplete=mode==="login"?"current-password":"new-password";
  $("authMessage").textContent="";
}
function closeAuth(){$("authModal").classList.add("hidden")}

$("openLogin2")?.addEventListener("click",()=>showAuth("login"));
$("openRegister")?.addEventListener("click",()=>showAuth("register"));
$("closeAuth")?.addEventListener("click",closeAuth);
document.querySelectorAll(".tab").forEach(t=>t.addEventListener("click",()=>showAuth(t.dataset.mode)));
$("authModal")?.addEventListener("click",e=>{if(e.target.id==="authModal")closeAuth()});

$("authForm")?.addEventListener("submit",async e=>{
  e.preventDefault();
  const message=$("authMessage"),button=$("authSubmit");
  message.textContent="";button.disabled=true;
  try{
    const endpoint=authMode==="login"?"/api/auth/login":"/api/auth/register";
    const r=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json"},credentials:"same-origin",body:JSON.stringify({username:$("username").value.trim(),password:$("password").value})});
    const d=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(d.message||"Não foi possível concluir.");
    location.href="/dashboard.html";
  }catch(err){message.textContent=err.message||"Erro ao conectar ao servidor."}
  finally{button.disabled=false}
});

checkPlayerSession();
