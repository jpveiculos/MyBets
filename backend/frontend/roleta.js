const TOTAL=40;
const PRIZE_INDEXES=Array.from({length:TOTAL},(_,i)=>i).filter(i=>i%4===3);
const DEFAULT_PRIZES=[2,2,2,2,2,2,2,2,2,2];

let MIN_BET=.50;
let MAX_BET=100;
let prizes=[...DEFAULT_PRIZES];
let rotation=0;
let spinning=false;
let configLoaded=false;

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
    $("balance").textContent=money(d.account.available_balance);
  }catch{
    location.href="/";
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

function drawWheel(){
  const svg=$("wheelSvg");
  svg.innerHTML="";
  const ns="http://www.w3.org/2000/svg";
  const visualSlices=20, angle=360/visualSlices, radius=186;

  for(let i=0;i<visualSlices;i++){
    const start=i*angle,end=start+angle;
    const path=document.createElementNS(ns,"path");
    path.setAttribute("d",wedge(200,200,radius,start,end));
    const prize=i%2===1;
    path.setAttribute("fill",prize?"#d9aa20":"#07090d");
    path.setAttribute("stroke",prize?"#ffe16a":"#6b4c0d");
    path.setAttribute("stroke-width",prize?"3":"2");
    svg.appendChild(path);

    if(prize){
      const label=document.createElementNS(ns,"text");
      const [x,y]=polar(200,200,145,start+angle/2);
      label.setAttribute("x",x);label.setAttribute("y",y);
      label.setAttribute("fill","#fff");label.setAttribute("font-size","32");
      label.setAttribute("font-family","Arial,Helvetica,sans-serif");
      label.setAttribute("font-weight","900");label.setAttribute("text-anchor","middle");
      label.setAttribute("dominant-baseline","middle");label.setAttribute("paint-order","stroke");
      label.setAttribute("stroke","#000");label.setAttribute("stroke-width","4");
      label.setAttribute("class","prize-label");
      const logicalSector=i*2+3;
      const prizePosition=PRIZE_INDEXES.indexOf(logicalSector);
      label.textContent=String(prizes[prizePosition]||DEFAULT_PRIZES[prizePosition])+"x";
      svg.appendChild(label);
    }
  }

  const ring=document.createElementNS(ns,"circle");
  ring.setAttribute("cx","200");ring.setAttribute("cy","200");ring.setAttribute("r","187");
  ring.setAttribute("fill","none");ring.setAttribute("stroke","#f4c83f");ring.setAttribute("stroke-width","3");
  svg.appendChild(ring);
}

function updatePrizeLabels(angle=rotation){
  document.querySelectorAll("#wheelSvg .prize-label").forEach(t=>{
    const x=Number(t.getAttribute("x")),y=Number(t.getAttribute("y"));
    t.setAttribute("transform",`rotate(${-angle} ${x} ${y})`);
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

function changeBet(delta){
  $("betAmount").value=Math.min(MAX_BET,Math.max(MIN_BET,Number((getBet()+delta).toFixed(2)))).toFixed(2);
}

function targetForSector(sector){
  const s=((Number(sector)%TOTAL)+TOTAL)%TOTAL;
  const group=Math.floor(s/4);
  const position=s%4;
  const groupAngle=360/(TOTAL/4);
  const halfAngle=groupAngle/2;
  const groupStart=group*groupAngle;

  // Cada grupo representa 4 setores lógicos:
  // 3 perdas ocupam a fatia preta e 1 prêmio ocupa a fatia amarela.
  // Como a roleta exibe 20 fatias visuais (10 pretas + 10 amarelas),
  // o ponteiro termina sempre dentro da cor correspondente ao resultado.
  if(position===3){
    // Prêmio: centro da fatia amarela (18° a 36° dentro de cada grupo).
    return -(groupStart+halfAngle+halfAngle/2);
  }

  // Perda: centro da fatia preta (0° a 18° dentro de cada grupo).
  return -(groupStart+halfAngle/2);
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
    MIN_BET=Number(r.minBet)||.50;
    MAX_BET=Number(r.maxBet)||100;
    prizes=Array.isArray(r.prizes)&&r.prizes.length===DEFAULT_PRIZES.length?r.prizes.map(Number):[...DEFAULT_PRIZES];
  }catch{
    MIN_BET=.50;MAX_BET=100;prizes=[...DEFAULT_PRIZES];
  }
  $("betAmount").min=MIN_BET.toFixed(2);
  $("betAmount").max=MAX_BET.toFixed(2);
  normalizeBet();
  drawWheel();
  updatePrizeLabels();
  configLoaded=true;
}

async function spin(){
  if(spinning||!configLoaded)return;
  normalizeBet();
  const bet=getBet();
  if(bet<MIN_BET||bet>MAX_BET)return;

  spinning=true;
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
    const destination=rotation+1080+delta;
    const duration=5000;
    const start=performance.now();
    const wheel=$("wheel");

    await new Promise(resolve=>{
      function frame(now){
        const p=Math.min(1,(now-start)/duration);
        const eased=1-Math.pow(1-p,5);
        const value=from+(destination-from)*eased;
        wheel.style.transform=`rotate(${value}deg)`;
        updatePrizeLabels(value);
        if(p<1){requestAnimationFrame(frame);return}
        rotation=destination;
        wheel.style.transform=`rotate(${rotation}deg)`;
        updatePrizeLabels(rotation);
        resolve();
      }
      requestAnimationFrame(frame);
    });

    $("balance").textContent=money(d.user.availableBalance);
    if(d.spin.resultType==="prize")showWin(d.spin.prize);
  }catch(e){
    $("message").textContent=e.message;
    $("message").classList.add("show");
    setTimeout(()=>$("message").classList.remove("show"),2200);
  }finally{
    spinning=false;
    $("spinButton").disabled=false;
    $("betMinus").disabled=false;
    $("betPlus").disabled=false;
  }
}

$("betMinus").onclick=()=>changeBet(-1);
$("betPlus").onclick=()=>changeBet(1);
$("spinButton").onclick=spin;
$("betAmount").addEventListener("change",normalizeBet);

loadAccount();
loadConfig();
