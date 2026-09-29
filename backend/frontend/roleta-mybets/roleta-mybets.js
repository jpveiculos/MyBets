let TOTAL=0;
let GROUP_SIZE=0;
let PRIZE_COUNT=0;
let GROUP_ANGLE=0;
let PRIZE_ANGLE=0;
let LOSS_ANGLE=0;
let MIN_BET=0;
let MAX_BET=0;
let prizes=[];
let rotation=0;
let spinning=false;
let configLoaded=false;
let animationId=0;
let animationRunning=false;
let queuedSpin=false;

const $=id=>document.getElementById(id);
const money=v=>Number(v||0).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});

async function api(url,options={}){
  const r=await fetch(url,{credentials:"same-origin",cache:"no-store",...options});
  const d=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(d.message||"Erro na operação.");
  return d;
}

async function loadAccount(){
  try{
    const d=await api("/api/account");
    $("playerName").textContent=d.account.username||"Jogador";
    $("balance").textContent=Number(d.account.play_credits||0).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
    $("cashBalance").textContent=money(d.account.withdrawable_balance);
    return d.account;
  }catch(error){
    return null;
  }
}

function polar(cx,cy,r,a){
  const rad=(a-90)*Math.PI/180;
  return [cx+r*Math.cos(rad),cy+r*Math.sin(rad)];
}

function wedge(cx,cy,r,a0,a1){
  const p0=polar(cx,cy,r,a0),p1=polar(cx,cy,r,a1);
  return `M ${cx} ${cy} L ${p0[0]} ${p0[1]} A ${r} ${r} 0 ${a1-a0>180?1:0} 1 ${p1[0]} ${p1[1]} Z`;
}

function rebuildGeometry(){
  PRIZE_COUNT=TOTAL/GROUP_SIZE;
  GROUP_ANGLE=360/PRIZE_COUNT;
  PRIZE_ANGLE=GROUP_ANGLE/2;
  LOSS_ANGLE=PRIZE_ANGLE/(GROUP_SIZE-1);
}

function sectorGeometry(sector){
  const s=((Number(sector)%TOTAL)+TOTAL)%TOTAL;
  const group=Math.floor(s/GROUP_SIZE);
  const position=s%GROUP_SIZE;
  const groupStart=group*GROUP_ANGLE-PRIZE_ANGLE/2;

  if(position===0){
    return {
      start:groupStart,
      end:groupStart+PRIZE_ANGLE,
      center:group*GROUP_ANGLE
    };
  }

  const start=groupStart+PRIZE_ANGLE+(position-1)*LOSS_ANGLE;
  return {
    start,
    end:start+LOSS_ANGLE,
    center:start+LOSS_ANGLE/2
  };
}

function drawWheel(){
  const svg=$("wheelSvg");
  svg.innerHTML="";
  const ns="http://www.w3.org/2000/svg";
  const defs=document.createElementNS(ns,"defs");
  const gradients={
    black:["#111111","#050505","#000000"],
    2:["#168cff","#0066ff","#003399"],
    3:["#7cff35","#39d353","#138a00"],
    4:["#c000ff","#8a00cc","#4b0075"],
    5:["#ff9d00","#ff6800","#b83a00"]
  };

  Object.entries(gradients).forEach(([key,stops])=>{
    const g=document.createElementNS(ns,"linearGradient");
    g.setAttribute("id","wheel3d-"+key);
    g.setAttribute("x1","0%");
    g.setAttribute("y1","0%");
    g.setAttribute("x2","100%");
    g.setAttribute("y2","100%");

    [["0%",stops[0]],["45%",stops[1]],["100%",stops[2]]].forEach(([offset,color])=>{
      const s=document.createElementNS(ns,"stop");
      s.setAttribute("offset",offset);
      s.setAttribute("stop-color",color);
      g.appendChild(s);
    });

    defs.appendChild(g);
  });

  svg.appendChild(defs);

  const colors={
    2:{stroke:"#168cff"},
    3:{stroke:"#00ff66"},
    4:{stroke:"#c000ff"},
    5:{stroke:"#ff9d00"}
  };

  // Visual: cada grupo mostra uma única fatia colorida e uma única
  // fatia preta sólida. A divisão dos setores de perda continua existindo
  // apenas na geometria lógica usada pelo sorteio e pelo ponteiro.
  for(let group=0;group<PRIZE_COUNT;group++){
    const prizeIndex=group*GROUP_SIZE;
    const prizeGeometry=sectorGeometry(prizeIndex);
    const multiplier=Number(prizes[group]);

    const prizePath=document.createElementNS(ns,"path");
    prizePath.setAttribute("d",wedge(200,200,194,prizeGeometry.start,prizeGeometry.end));
    prizePath.setAttribute("fill","url(#wheel3d-"+multiplier+")");
    prizePath.setAttribute("stroke",colors[multiplier]?.stroke||"#ffe16a");
    prizePath.setAttribute("stroke-width","4");
    // Sem sombra expandida nas fatias: evita que cores ultrapassem o aro externo.
    svg.appendChild(prizePath);

    const blackStart=prizeGeometry.end;
    const blackEnd=prizeGeometry.start+GROUP_ANGLE;
    const lossPath=document.createElementNS(ns,"path");
    lossPath.setAttribute("d",wedge(200,200,194,blackStart,blackEnd));
    lossPath.setAttribute("fill","url(#wheel3d-black)");
    lossPath.setAttribute("stroke","none");
    lossPath.setAttribute("stroke-width","0");
    svg.appendChild(lossPath);

    const label=document.createElementNS(ns,"text");
    const labelAngle=prizeGeometry.center;
    const xy=polar(200,200,142,labelAngle);
    label.setAttribute("x",xy[0]);
    label.setAttribute("y",xy[1]);
    label.setAttribute("fill","#fff");
    label.setAttribute("font-size","20");
    label.setAttribute("font-family","Arial,Helvetica,sans-serif");
    label.setAttribute("font-weight","900");
    label.setAttribute("text-anchor","middle");
    label.setAttribute("dominant-baseline","middle");
    label.setAttribute("paint-order","stroke");
    label.setAttribute("stroke","#000");
    label.setAttribute("stroke-width","4");
    label.setAttribute("filter","drop-shadow(0 2px 2px #000)");
    label.setAttribute("class","prize-label");
    label.setAttribute("transform",`rotate(${labelAngle+270} ${xy[0]} ${xy[1]})`);
    label.textContent=String(multiplier)+"x";
    svg.appendChild(label);
  }

}

function updatePrizeValues(){
  const bet=getBet();
  document.querySelectorAll("#wheelSvg .prize-label").forEach((t,index)=>{
    const multiplier=Number(prizes[index]||0);
    const value=Number.isFinite(multiplier)&&multiplier>0?bet*multiplier:0;
    t.textContent=money(value);
  });
}

function getBet(){
  const value=Number(String($("betAmount").value).replace(",","."));
  return Number.isFinite(value)?Number(value.toFixed(2)):MIN_BET;
}

function normalizeBet(){
  let value=getBet();
  value=Math.min(MAX_BET,Math.max(MIN_BET,value));
  $("betAmount").value=value.toFixed(2);
}

function changeBet(delta=.50){
  if(spinning)return;
  const current=getBet();
  const next=Math.min(MAX_BET,Math.max(MIN_BET,Number((current+delta).toFixed(2))));
  $("betAmount").value=next.toFixed(2);
  $("betAmount").dispatchEvent(new Event("input",{bubbles:true}));
}

function targetForSector(sector){
  return -sectorGeometry(sector).center;
}

function showWin(amount){
  const box=$("result");
  box.textContent=`Você ganhou ${money(amount)}`;
  box.classList.add("show");
  clearTimeout(window.__winTimer);
  window.__winTimer=setTimeout(()=>box.classList.remove("show"),1900);
}

async function loadConfig(){
  try{
    const d=await api("/api/roulette/config");
    const r=d.roulette;

    TOTAL=Number(r.totalSectors);
    GROUP_SIZE=Number(r.groupSize);
    MIN_BET=Number(r.minBet);
    MAX_BET=Number(r.maxBet);
    prizes=Array.isArray(r.prizes)?r.prizes.map(Number):[];

    if(!Number.isInteger(TOTAL)||TOTAL<=0)throw new Error("Configuração de setores inválida.");
    if(!Number.isInteger(GROUP_SIZE)||GROUP_SIZE<2||TOTAL%GROUP_SIZE!==0)throw new Error("Configuração de grupos inválida.");
    if(!Number.isFinite(MIN_BET)||MIN_BET<=0)throw new Error("Configuração de aposta mínima inválida.");
    if(!Number.isFinite(MAX_BET)||MAX_BET<MIN_BET)throw new Error("Configuração de aposta máxima inválida.");
    if(prizes.length!==TOTAL/GROUP_SIZE||prizes.some(value=>!Number.isFinite(value)||value<=0)){
      throw new Error("Configuração de prêmios inválida.");
    }

    rebuildGeometry();
  }catch(error){
    configLoaded=false;
    $("message").textContent=error.message||"Não foi possível carregar a configuração da roleta.";
    $("message").classList.add("show");
    return;
  }

  $("betAmount").min=MIN_BET.toFixed(2);
  $("betAmount").max=MAX_BET.toFixed(2);
  normalizeBet();
  drawWheel();
  updatePrizeValues();

  // Estado inicial: o centro da primeira fatia de prêmio fica exatamente sob o ponteiro.
  rotation=0;
  const wheel=$("wheel");
  wheel.style.transform=`rotate(${rotation}deg)`;

  configLoaded=true;
}

async function spin(){
  if(!configLoaded)return;
  if(animationRunning){
    queuedSpin=true;
    return;
  }
  if(spinning)return;
  normalizeBet();
  const bet=getBet();
  if(bet<MIN_BET||bet>MAX_BET)return;

  spinning=true;
  animationRunning=true;
  const currentAnimationId=++animationId;
  $("spinButton").disabled=true;
  $("betMinus").disabled=true;
  $("betPlus").disabled=true;

  try{
    const d=await api("/api/roulette/spin",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({betAmount:bet})
    });

    const sector=Number(d.spin.sector);
    const target=targetForSector(sector);
    const current=((rotation%360)+360)%360;
    const delta=((target-current)%360+360)%360;
    const from=rotation;
    const destination=rotation+360+delta;
    // Giro curto e suave: um giro completo, com desaceleração progressiva
    // e uma parada firme no setor sorteado, sem prolongar o final.
    const duration=1900;
    const start=performance.now();
    const wheel=$("wheel");

    const completed=await new Promise(resolve=>{
      function frame(now){
        if(currentAnimationId!==animationId){
          resolve(false);
          return;
        }

        const p=Math.min(1,(now-start)/duration);
        const eased=1-Math.pow(1-p,5);
        const value=from+(destination-from)*eased;
        rotation=value;
        wheel.style.transform=`rotate(${rotation}deg)`;

        // O botão fica disponível antes da parada para aceitar o próximo giro.
        // O clique é enfileirado enquanto esta animação termina, preservando
        // a ordem financeira de cada aposta.
        if(p>=0.72 && spinning){
          $("spinButton").disabled=false;
          $("betMinus").disabled=false;
          $("betPlus").disabled=false;
        }

        if(p<1){
          requestAnimationFrame(frame);
          return;
        }

        rotation=destination;
        wheel.style.transform=`rotate(${rotation}deg)`;
        resolve(true);
      }

      requestAnimationFrame(frame);
    });
    if(!completed)return;

    animationRunning=false;
    spinning=false;
    $("spinButton").disabled=false;
    $("betMinus").disabled=false;
    $("betPlus").disabled=false;

    $("balance").textContent=Number(d.user.playCredits||0).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
    $("cashBalance").textContent=money(d.user.cashBalance);
    if(d.spin.resultType==="prize")showWin(d.spin.prize);

    if(queuedSpin){
      queuedSpin=false;
      setTimeout(spin,0);
    }
  }catch(e){
    animationRunning=false;
    queuedSpin=false;
    spinning=false;
    $("spinButton").disabled=false;
    $("betMinus").disabled=false;
    $("betPlus").disabled=false;
    $("message").textContent=e.message;
    $("message").classList.add("show");
    setTimeout(()=>$("message").classList.remove("show"),2200);
  }
}

$("betMinus").addEventListener("click",event=>{event.preventDefault();event.stopPropagation();changeBet(-.50);});
$("betPlus").addEventListener("click",event=>{event.preventDefault();event.stopPropagation();changeBet(.50);});
$("spinButton").addEventListener("click",spin);
$("betAmount").addEventListener("input",updatePrizeValues);
$("betAmount").addEventListener("change",()=>{
  normalizeBet();
  updatePrizeValues();
});

async function initializeRoleta(){
  const account=await loadAccount();
  if(!account){
    showAuth("login");
    return;
  }
  $("authScreen").classList.add("hidden");
  $("appShell").classList.remove("hidden");
  await loadConfig();
}

initializeRoleta();

/* Valores rápidos para definir o valor da aposta */
document.querySelectorAll("[data-bet-value]").forEach(button=>{
  button.addEventListener("click",()=>{
    const value=Number(button.dataset.betValue);
    const input=document.getElementById("betAmount");
    if(!input || !Number.isFinite(value)) return;
    const min=Number(input.min||0);
    const max=Number(input.max||Infinity);
    const finalValue=Math.min(max,Math.max(min,value));
    input.value=finalValue.toFixed(2);
    input.dispatchEvent(new Event("input",{bubbles:true}));
    input.dispatchEvent(new Event("change",{bubbles:true}));
  });
});


let authMode="login";
let pixDepositId=null;
let pixPollTimer=null;
let buyCreditsAvailable=0;
let deferredInstallPrompt=null;

function showAuth(mode="login"){
  authMode=mode;
  $("authScreen").classList.remove("hidden");
  $("appShell").classList.add("hidden");
  document.querySelectorAll("#authScreen .tab").forEach(t=>t.classList.toggle("active",t.dataset.mode===mode));
  $("authTitle").textContent=mode==="login"?"Entrar":"Criar conta";
  $("authSubmit").textContent=mode==="login"?"Entrar":"Criar conta";
  $("password").autocomplete=mode==="login"?"current-password":"new-password";
  const isRegister=mode==="register";
  $("cpfField").classList.toggle("hidden",!isRegister);
  $("cpfHelp").classList.toggle("hidden",!isRegister);
  $("cpf").toggleAttribute("required",isRegister);
  if(!isRegister)$("cpf").value="";
  $("authMessage").textContent="";
}
function closeAuth(){
  if($("appShell").classList.contains("hidden"))return;
  $("authScreen").classList.add("hidden");
}
$("authScreen").addEventListener("click",e=>{
  if(e.target.id==="authScreen")closeAuth();
});
document.querySelectorAll("#authScreen .tab").forEach(t=>t.addEventListener("click",()=>showAuth(t.dataset.mode)));
$("authForm").addEventListener("submit",async e=>{
  e.preventDefault();
  const message=$("authMessage"),button=$("authSubmit");
  message.textContent="";
  button.disabled=true;
  try{
    const endpoint=authMode==="login"?"/api/auth/login":"/api/auth/register";
    const r=await fetch(endpoint,{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      credentials:"same-origin",
      body:JSON.stringify({
        username:$("username").value.trim(),
        password:$("password").value,
        ...(authMode==="register"?{cpf:$("cpf").value}: {})
      })
    });
    const d=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(d.message||"Não foi possível concluir.");
    $("authScreen").classList.add("hidden");
    $("appShell").classList.remove("hidden");
    await loadAccount();
    await loadConfig();
  }catch(err){
    message.textContent=err.message||"Erro ao conectar ao servidor.";
  }finally{
    button.disabled=false;
  }
});
$("cpf").addEventListener("input",e=>{
  const digits=e.target.value.replace(/\D/g,"").slice(0,11);
  e.target.value=digits.replace(/^(\d{3})(\d)/,"$1.$2").replace(/^(\d{3})\.(\d{3})(\d)/,"$1.$2.$3").replace(/^(\d{3})\.(\d{3})\.(\d)/,"$1.$2.$3-$4");
});

async function refreshAccount(){
  const account=await loadAccount();
  if(account){
    $("playerName").textContent=account.username||"Jogador";
    $("withdrawAvailableBalance").textContent=money(account.withdrawable_balance);
    $("buyCreditsAvailable").textContent=money(account.withdrawable_balance);
    $("withdrawAmount").max=Number(account.withdrawable_balance||0).toFixed(2);
  }
  return account;
}
function stopPixPolling(){
  if(pixPollTimer){clearTimeout(pixPollTimer);pixPollTimer=null;}
  pixDepositId=null;
}
function openFinance(){
  $("financeModal").classList.remove("hidden");
}
function closeFinance(){
  stopPixPolling();
  $("financeModal").classList.add("hidden");
  $("pixPaymentArea").classList.add("hidden");
  $("buyCreditsArea").classList.add("hidden");
  $("withdrawArea").classList.add("hidden");
  $("depositArea").classList.remove("hidden");
  $("depositMessage").textContent="";
  $("buyCreditsMessage").textContent="";
  $("withdrawMessage").textContent="";
}
$("closeFinance").addEventListener("click",closeFinance);
$("financeModal").addEventListener("click",e=>{if(e.target.id==="financeModal")closeFinance()});

function showDeposit(){
  openFinance();
  $("financeTitle").textContent="Adicionar saldo";
  $("depositArea").classList.remove("hidden");
  $("pixPaymentArea").classList.add("hidden");
  $("buyCreditsArea").classList.add("hidden");
  $("withdrawArea").classList.add("hidden");
  $("depositAmount").value="";
  $("depositMessage").textContent="";
}
$("addBalanceBtn").addEventListener("click",showDeposit);

async function createMercadoPagoPayment(){
  const amount=Number($("depositAmount").value);
  const m=$("depositMessage");
  if(!Number.isFinite(amount)||amount<=0){m.textContent="Informe o valor que deseja adicionar.";return;}
  const button=$("mercadoPagoPay");
  button.disabled=true;
  m.textContent="Preparando o pagamento seguro…";
  try{
    const d=await api("/api/payments/mercadopago/create",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({amount})
    });
    if(!d.payment?.id||!d.payment?.qrCode)throw new Error("O Mercado Pago não retornou um QR Code Pix.");
    showPixPayment(d.payment);
  }catch(error){
    m.textContent=error.message;
    button.disabled=false;
  }
}
$("mercadoPagoPay").addEventListener("click",createMercadoPagoPayment);

function showPixPayment(payment){
  stopPixPolling();
  pixDepositId=String(payment.id);
  $("depositArea").classList.add("hidden");
  $("pixPaymentArea").classList.remove("hidden");
  $("financeTitle").textContent="Pagamento Pix";
  $("pixPaymentQr").src=payment.qrCodeBase64?("data:image/png;base64,"+payment.qrCodeBase64):payment.ticketUrl;
  $("pixPaymentCopy").value=payment.qrCode||"";
  $("pixPaymentStatus").textContent="Aguardando pagamento…";
  checkPixPayment();
}
async function checkPixPayment(){
  if(!pixDepositId)return;
  try{
    const d=await api("/api/payments/mercadopago/status/"+encodeURIComponent(pixDepositId));
    const result=d.result||{};
    if(result.depositStatus==="approved"){
      $("pixPaymentStatus").textContent="Pagamento aprovado! Atualizando seu saldo…";
      stopPixPolling();
      closeFinance();
      await refreshAccount();
      return;
    }
    if(result.depositStatus==="rejected"){
      $("pixPaymentStatus").textContent="Pagamento não aprovado.";
      stopPixPolling();
      return;
    }
    $("pixPaymentStatus").textContent="Aguardando confirmação do pagamento…";
  }catch{
    $("pixPaymentStatus").textContent="Conferindo o pagamento…";
  }
  if(pixDepositId)pixPollTimer=setTimeout(checkPixPayment,1500);
}
$("pixCopyButton").addEventListener("click",async()=>{
  const value=$("pixPaymentCopy").value.trim();
  if(!value)return;
  try{await navigator.clipboard.writeText(value);}
  catch{
    const input=$("pixPaymentCopy");
    input.focus();input.select();input.setSelectionRange(0,input.value.length);
    try{document.execCommand("copy")}catch{}
  }
  $("pixCopyButton").textContent="Copiado";
  setTimeout(()=>$("pixCopyButton").textContent="Copiar",1500);
});

async function openBuyCredits(){
  const account=await refreshAccount();
  if(!account)return;
  buyCreditsAvailable=Number(account.withdrawable_balance||0);
  if(buyCreditsAvailable<=0){
    $("message").textContent="Não há saldo disponível para adicionar créditos.";
    $("message").classList.add("show");
    setTimeout(()=>$("message").classList.remove("show"),2200);
    return;
  }
  openFinance();
  $("financeTitle").textContent="Adicionar créditos";
  $("depositArea").classList.add("hidden");
  $("pixPaymentArea").classList.add("hidden");
  $("withdrawArea").classList.add("hidden");
  $("buyCreditsArea").classList.remove("hidden");
  $("buyCreditsAvailable").textContent=money(buyCreditsAvailable);
  $("buyCreditsAmount").max=buyCreditsAvailable.toFixed(2);
  $("buyCreditsAmount").value="";
  $("buyCreditsMessage").textContent="";
}
$("addCreditsBtn").addEventListener("click",openBuyCredits);
$("buyCreditsMax").addEventListener("click",()=>{if(buyCreditsAvailable>0)$("buyCreditsAmount").value=buyCreditsAvailable.toFixed(2)});
$("buyCreditsConfirm").addEventListener("click",async()=>{
  const amount=Number($("buyCreditsAmount").value);
  const m=$("buyCreditsMessage");
  if(!amount||amount<=0){m.textContent="Informe o valor para comprar créditos.";return}
  if(amount>buyCreditsAvailable){m.textContent="O valor é maior que o saldo disponível.";return}
  try{
    const d=await api("/api/credits/purchase",{
      method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({amount})
    });
    m.style.color="#35c58a";
    m.textContent=money(amount)+" convertido em "+Number(d.result.creditsAdded).toLocaleString("pt-BR",{maximumFractionDigits:2})+" créditos.";
    await refreshAccount();
    setTimeout(closeFinance,900);
  }catch(error){m.style.color="#ff5d6c";m.textContent=error.message}
});

async function openWithdraw(){
  const account=await refreshAccount();
  if(!account)return;
  const available=Number(account.withdrawable_balance||0);
  if(available<=0){
    $("message").textContent="Ainda não há saldo disponível para saque.";
    $("message").classList.add("show");
    setTimeout(()=>$("message").classList.remove("show"),2200);
    return;
  }
  openFinance();
  $("financeTitle").textContent="Saque via Pix";
  $("depositArea").classList.add("hidden");
  $("pixPaymentArea").classList.add("hidden");
  $("buyCreditsArea").classList.add("hidden");
  $("withdrawArea").classList.remove("hidden");
  $("withdrawAvailableBalance").textContent=money(available);
  $("withdrawAmount").max=available.toFixed(2);
  $("withdrawAmount").value="";
  $("withdrawPixKey").value="";
  $("withdrawMessage").textContent="";
}
$("withdrawBtn").addEventListener("click",openWithdraw);
$("withdrawMax").addEventListener("click",async()=>{
  const account=await refreshAccount();
  const available=Number(account?.withdrawable_balance||0);
  if(available>0)$("withdrawAmount").value=available.toFixed(2);
});
$("withdrawForm").addEventListener("submit",async e=>{
  e.preventDefault();
  const amount=Number($("withdrawAmount").value);
  const pixKey=$("withdrawPixKey").value.trim();
  const m=$("withdrawMessage");
  if(!amount||amount<=0){m.textContent="Informe o valor do saque.";return}
  if(!pixKey){m.textContent="Informe sua chave Pix.";return}
  try{
    await api("/api/withdrawals",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({amount,pixKey})
    });
    m.style.color="#35c58a";
    m.textContent="Saque solicitado. O valor ficará reservado até o administrador finalizar a operação.";
    await refreshAccount();
    setTimeout(closeFinance,1600);
  }catch(error){m.style.color="#ff5d6c";m.textContent=error.message}
});

$("logoutBtn").addEventListener("click",async()=>{
  try{await api("/api/auth/logout",{method:"POST"})}catch{}
  configLoaded=false;
  stopPixPolling();
  closeFinance();
  $("appShell").classList.add("hidden");
  showAuth("login");
});

$("termsBtn").addEventListener("click",()=>$("termsModal").classList.remove("hidden"));
$("closeTerms").addEventListener("click",()=>$("termsModal").classList.add("hidden"));
$("termsModal").addEventListener("click",e=>{if(e.target.id==="termsModal")$("termsModal").classList.add("hidden")});

window.addEventListener("beforeinstallprompt",e=>{
  e.preventDefault();
  deferredInstallPrompt=e;
  $("installBtn").classList.remove("hidden");
});
$("installBtn").addEventListener("click",async()=>{
  if(!deferredInstallPrompt)return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt=null;
  $("installBtn").classList.add("hidden");
});
