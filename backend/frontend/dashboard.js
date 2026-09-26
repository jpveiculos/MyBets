let financeMode="deposit";
let playerUsername="";
let playerId="";
let playCredits=0;
let withdrawableBalance=0;
let buyCreditsAvailable=0;
let mercadoPagoWindow=null;

const $=id=>document.getElementById(id);
const money=v=>Number(v||0).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});

async function api(url,options={}){
  const r=await fetch(url,{credentials:"same-origin",...options});
  const d=await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(d.message||"Erro na operação.");
  return d;
}

async function load(){
  try{
    const a=await api("/api/account");
    playerUsername=a.account.username;
    playerId=String(a.account.id);
    playCredits=Number(a.account.play_credits||0);
    withdrawableBalance=Number(a.account.withdrawable_balance||0);

    $("welcome").textContent="Olá, "+playerUsername;
    $("playCredits").textContent=playCredits.toLocaleString("pt-BR",{minimumFractionDigits:0,maximumFractionDigits:2});
    $("balance").textContent=money(withdrawableBalance);
    $("reserved").textContent="Reservado: "+money(a.account.reserved_balance);
    $("withdrawAvailableBalance").textContent=money(withdrawableBalance);
    $("withdrawAmount").max=withdrawableBalance>0?withdrawableBalance.toFixed(2):"0.01";
    $("withdrawMax").disabled=withdrawableBalance<=0;
    $("withdrawBtn").disabled=withdrawableBalance<=0;
    $("withdrawBtn").title=withdrawableBalance>0?"Solicitar saque":"Não há saldo disponível para saque";
    const hint=$("withdrawHint");
    if(hint) hint.textContent="Saque via Pix";

    const params=new URLSearchParams(location.search);
    const payment=params.get("payment");
    if(payment){
      const m=$("depositMessage");
      if(payment==="approved"){
        m.style.color="#35c58a";
        m.textContent="Pagamento confirmado. Seus créditos foram adicionados automaticamente.";
        financeMode="deposit";
        $("financeModal").classList.remove("hidden");
        showDepositPromotion();
      }else if(payment==="pending"){
        m.style.color="#f5b942";
        m.textContent="Pagamento recebido e ainda em processamento. Os créditos serão liberados automaticamente quando o Mercado Pago confirmar.";
        financeMode="deposit";
        $("financeModal").classList.remove("hidden");
        showDepositPromotion();
      }else if(payment==="failed"){
        m.style.color="#ff5d6c";
        m.textContent="O pagamento não foi aprovado. Você pode tentar novamente.";
        financeMode="deposit";
        $("financeModal").classList.remove("hidden");
        showDepositPromotion();
      }
      history.replaceState({},document.title,location.pathname);
    }
  }catch(e){location.href="/"}
}

function showDepositPromotion(){
  $("depositPromo").classList.remove("hidden");
  $("withdrawArea").classList.add("hidden");
  $("buyCreditsArea").classList.add("hidden");
  $("financeTitle").textContent="Adicionar créditos";
  $("depositPlayer").textContent=playerUsername||"Jogador";
}

async function openDeposit(){
  financeMode="deposit";
  $("financeModal").classList.remove("hidden");
  showDepositPromotion();
  $("depositAmount").value="";
  $("depositMessage").textContent="";
  $("depositPlayer").textContent=playerUsername||"Jogador";

  try{
    const settings=await api("/api/settings/public");
    if(settings.settings.mercadopago_enabled!==true){
      $("depositMessage").style.color="#ff5d6c";
      $("depositMessage").textContent="O pagamento automático ainda não está configurado no servidor.";
    }
  }catch(e){
    $("depositMessage").style.color="#ff5d6c";
    $("depositMessage").textContent=e.message;
  }
}

async function createMercadoPagoPayment(){
  const amount=Number($("depositAmount").value);
  const m=$("depositMessage");
  if(!amount||amount<=0){
    m.style.color="#ff5d6c";
    m.textContent="Informe o valor que deseja adicionar.";
    return;
  }

  const button=$("mercadoPagoPay");
  button.disabled=true;
  m.style.color="";
  m.textContent="Preparando o pagamento seguro…";

  try{
    const d=await api("/api/payments/mercadopago/create",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({amount})
    });
    if(!d.payment?.checkoutUrl) throw new Error("O Mercado Pago não retornou o checkout.");
    mercadoPagoWindow=window.open(d.payment.checkoutUrl,"_blank","noopener,noreferrer");
    if(!mercadoPagoWindow){
      window.location.href=d.payment.checkoutUrl;
    }else{
      m.style.color="#f5b942";
      m.textContent="O Mercado Pago foi aberto. Após a confirmação, esta janela será fechada automaticamente.";
    }
  }catch(e){
    button.disabled=false;
    m.style.color="#ff5d6c";
    m.textContent=e.message;
  }
}

async function openWithdraw(){
  try{
    const a=await api("/api/account");
    playCredits=Number(a.account.play_credits||0);
    withdrawableBalance=Number(a.account.withdrawable_balance||0);

    $("playCredits").textContent=playCredits.toLocaleString("pt-BR",{minimumFractionDigits:0,maximumFractionDigits:2});
    $("balance").textContent=money(withdrawableBalance);
    $("reserved").textContent="Reservado: "+money(a.account.reserved_balance);
    $("withdrawAvailableBalance").textContent=money(withdrawableBalance);
    $("withdrawAmount").max=withdrawableBalance>0?withdrawableBalance.toFixed(2):"0.01";
    $("withdrawMax").disabled=withdrawableBalance<=0;
    $("withdrawBtn").disabled=withdrawableBalance<=0;

    if(withdrawableBalance<=0){
      $("withdrawMessage").textContent="Ainda não há saldo disponível para saque.";
      return;
    }

    financeMode="withdraw";
    $("financeModal").classList.remove("hidden");
    $("depositPromo").classList.add("hidden");
    $("financeTitle").textContent="Solicitar saque";
    $("withdrawArea").classList.remove("hidden");
    $("buyCreditsArea").classList.add("hidden");
    $("withdrawMessage").textContent="";
    $("withdrawForm").reset();
    $("withdrawAvailableBalance").textContent=money(withdrawableBalance);
    $("withdrawAmount").max=withdrawableBalance.toFixed(2);
    $("withdrawMax").disabled=false;
  }catch(e){alert(e.message)}
}

async function openBuyCredits(){
  try{
    const a=await api("/api/account");
    buyCreditsAvailable=Number(a.account.withdrawable_balance||0);
    $("buyCreditsAvailable").textContent=money(buyCreditsAvailable);
    $("buyCreditsAmount").max=buyCreditsAvailable>0?buyCreditsAvailable.toFixed(2):"0.01";
    $("buyCreditsAmount").value="";
    $("buyCreditsMessage").textContent="";
    $("depositPromo").classList.add("hidden");
    $("withdrawArea").classList.add("hidden");
    $("buyCreditsArea").classList.remove("hidden");
    $("financeTitle").textContent="Comprar créditos";
    $("financeModal").classList.remove("hidden");
  }catch(e){alert(e.message)}
}

$("buyCreditsMax").onclick=()=>{
  if(buyCreditsAvailable>0) $("buyCreditsAmount").value=buyCreditsAvailable.toFixed(2);
};

$("buyCreditsConfirm").onclick=async()=>{
  const amount=Number($("buyCreditsAmount").value);
  const m=$("buyCreditsMessage");
  if(!amount||amount<=0){m.textContent="Informe o valor para comprar créditos.";return}
  if(amount>buyCreditsAvailable){m.textContent="O valor é maior que o saldo disponível.";return}
  try{
    const d=await api("/api/credits/purchase",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({amount})
    });
    m.style.color="#35c58a";
    m.textContent=amount.toLocaleString("pt-BR",{style:"currency",currency:"BRL"})+
      " convertido em "+Number(d.result.creditsAdded).toLocaleString("pt-BR",{maximumFractionDigits:2})+" créditos.";
    setTimeout(()=>{$("financeModal").classList.add("hidden");load()},1200);
  }catch(e){m.style.color="#ff5d6c";m.textContent=e.message}
};

$("addCreditsBtn").onclick=openDeposit;
$("platformCreditsBtn").onclick=openBuyCredits;
$("withdrawBtn").onclick=openWithdraw;
$("mercadoPagoPay").onclick=createMercadoPagoPayment;

$("withdrawMax").onclick=()=>{
  if(withdrawableBalance>0) $("withdrawAmount").value=withdrawableBalance.toFixed(2);
};

$("withdrawForm").onsubmit=async e=>{
  e.preventDefault();
  const m=$("withdrawMessage");
  m.style.color="#ff5d6c";
  try{
    await api("/api/withdrawals",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({
        amount:Number($("withdrawAmount").value),
        pixKey:$("withdrawPixKey").value.trim()
      })
    });
    m.style.color="#35c58a";
    m.textContent="Saque solicitado. O valor ficará reservado até o administrador finalizar a operação.";
    setTimeout(()=>{$("financeModal").classList.add("hidden");load()},1800);
  }catch(e){m.textContent=e.message}
};

window.addEventListener("message",async event=>{
  if(event.origin!==location.origin) return;
  if(event.data?.type!=="mybets-mercadopago-result") return;

  if(mercadoPagoWindow && !mercadoPagoWindow.closed){
    try{ mercadoPagoWindow.close(); }catch{}
  }

  $("financeModal").classList.add("hidden");
  $("depositMessage").textContent="";
  await load();
});

$("closeFinance").onclick=()=>{
  $("financeModal").classList.add("hidden");
  $("buyCreditsArea").classList.add("hidden");
};

$("logout").onclick=async()=>{
  await api("/api/auth/logout",{method:"POST"});
  location.href="/";
};

load();
