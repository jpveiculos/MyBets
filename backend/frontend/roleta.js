const TOTAL=80;
const GROUP_SIZE=5;
const PRIZE_COUNT=TOTAL/GROUP_SIZE;
const GROUP_ANGLE=360/PRIZE_COUNT;
// A fatia colorida ocupa metade do grupo; os 4 setores de perda
// são comprimidos para que a área preta continue exatamente igual à colorida.
const PRIZE_ANGLE=GROUP_ANGLE/2;
const LOSS_ANGLE=PRIZE_ANGLE/(GROUP_SIZE-1);

const PRIZE_INDEXES=Array.from({length:TOTAL},(_,i)=>i).filter(i=>i%GROUP_SIZE===0);
const DEFAULT_PRIZES=[2,3,4,5,2,3,4,5,2,3,4,5,2,3,4,5];

let MIN_BET=.50;
let MAX_BET=100;
let prizes=[...DEFAULT_PRIZES];
let rotation=-PRIZE_ANGLE/2;
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
    $("balance").textContent=Number(d.account.play_credits||0).toLocaleString("pt-BR",{minimumFractionDigits:0,maximumFractionDigits:2});
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
  const radius=198;

  const defs=document.createElementNS(ns,"defs");
  const gradients={
    black:["#111111","#050505","#000000"],
    2:["#168cff","#0066ff","#003399"],
    3:["#00e85a","#00b83f","#006b24"],
    4:["#c000ff","#8a00cc","#4b0075"],
    5:["#ff9d00","#ff6800","#b83a00"],
    10:["#ff2525","#e00000","#8f0000"]
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
    5:{stroke:"#ff9d00"},
    10:{stroke:"#ff2525"}
  };

  // Visual: cada grupo mostra uma única fatia colorida e uma única
  // fatia preta sólida. A divisão dos 4 setores de perda continua existindo
  // apenas na geometria lógica usada pelo sorteio e pelo ponteiro.
  for(let group=0;group<PRIZE_COUNT;group++){
    const prizeIndex=group*GROUP_SIZE;
    const prizeGeometry=sectorGeometry(prizeIndex);
    const multiplier=Number(prizes[group]);

    const prizePath=document.createElementNS(ns,"path");
    prizePath.setAttribute("d",wedge(200,200,radius,prizeGeometry.start,prizeGeometry.end));
    prizePath.setAttribute("fill","url(#wheel3d-"+multiplier+")");
    prizePath.setAttribute("stroke",colors[multiplier]?.stroke||"#ffe16a");
    prizePath.setAttribute("stroke-width","2.5");
    svg.appendChild(prizePath);

    const blackStart=prizeGeometry.end;
    const blackEnd=prizeGeometry.start+GROUP_ANGLE;
    const lossPath=document.createElementNS(ns,"path");
    lossPath.setAttribute("d",wedge(200,200,radius,blackStart,blackEnd));
    lossPath.setAttribute("fill","url(#wheel3d-black)");
    lossPath.setAttribute("stroke","none");
    lossPath.setAttribute("stroke-width","0");
    svg.appendChild(lossPath);

    const label=document.createElementNS(ns,"text");
    const labelAngle=prizeGeometry.center+1;
    const xy=polar(200,200,146,labelAngle);
    label.setAttribute("x",xy[0]);
    label.setAttribute("y",xy[1]);
    label.setAttribute("fill","#fff");
    label.setAttribute("font-size","19");
    label.setAttribute("font-family","Arial,Helvetica,sans-serif");
    label.setAttribute("font-weight","900");
    label.setAttribute("text-anchor","middle");
    label.setAttribute("dominant-baseline","middle");
    label.setAttribute("paint-order","stroke");
    label.setAttribute("stroke","#000");
    label.setAttribute("stroke-width","4");
    label.setAttribute("class","prize-label");
    // O valor acompanha o eixo da própria fatia: 0° no topo,
    // aumentando no sentido horário junto com a geometria da roleta.
    label.setAttribute("transform",`rotate(${labelAngle+270} ${xy[0]} ${xy[1]})`);
    label.textContent=String(multiplier)+"x";
    svg.appendChild(label);
  }
  const ring=document.createElementNS(ns,"circle");
  ring.setAttribute("cx","200");
  ring.setAttribute("cy","200");
  ring.setAttribute("r","199");
  ring.setAttribute("fill","none");
  ring.setAttribute("stroke","#f4c83f");
  ring.setAttribute("stroke-width","3");
  svg.appendChild(ring);
}

function updatePrizeValues(){
  const bet=getBet();
  document.querySelectorAll("#wheelSvg .prize-label").forEach((t,index)=>{
    const multiplier=Number(prizes[index]||DEFAULT_PRIZES[index]);
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

function changeBet(delta){
  const next=Math.min(MAX_BET,Math.max(MIN_BET,Number((getBet()+delta).toFixed(2))));
  $("betAmount").value=next.toFixed(2);
  updatePrizeValues();
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

    MIN_BET=Number(r.minBet)||.50;
    MAX_BET=Number(r.maxBet)||100;

    const configured=Array.isArray(r.prizes)?r.prizes.map(Number):[];
    const exactConfig=configured.length===DEFAULT_PRIZES.length&&configured.every((value,index)=>value===DEFAULT_PRIZES[index]);
    prizes=exactConfig?configured:[...DEFAULT_PRIZES];
  }catch{
    MIN_BET=.50;
    MAX_BET=100;
    prizes=[...DEFAULT_PRIZES];
  }

  $("betAmount").min=MIN_BET.toFixed(2);
  $("betAmount").max=MAX_BET.toFixed(2);
  normalizeBet();
  drawWheel();
  updatePrizeValues();

  // Estado inicial: primeiro prêmio centralizado exatamente em 0°, sob o ponteiro no topo.
  rotation=0;
  const wheel=$("wheel");
  wheel.style.transform=`rotate(${rotation}deg)`;

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
    const duration=3000;
    const start=performance.now();
    const wheel=$("wheel");

    await new Promise(resolve=>{
      function frame(now){
        const p=Math.min(1,(now-start)/duration);
        const eased=1-Math.pow(1-p,5);
        const value=from+(destination-from)*eased;
        rotation=value;
        wheel.style.transform=`rotate(${rotation}deg)`;

        if(p<1){
          requestAnimationFrame(frame);
          return;
        }

        rotation=destination;
        wheel.style.transform=`rotate(${rotation}deg)`;
        resolve();
      }

      requestAnimationFrame(frame);
    });

    // O resultado já foi confirmado pelo servidor e a animação terminou.
    // Libera imediatamente o botão, sem esperar nenhuma outra atualização de UI.
    spinning=false;
    $("spinButton").disabled=false;
    $("betMinus").disabled=false;
    $("betPlus").disabled=false;

    $("balance").textContent=Number(d.user.playCredits||0).toLocaleString("pt-BR",{minimumFractionDigits:0,maximumFractionDigits:2});
    if(d.spin.resultType==="prize")showWin(d.spin.prize);
  }catch(e){
    spinning=false;
    $("spinButton").disabled=false;
    $("betMinus").disabled=false;
    $("betPlus").disabled=false;
    $("message").textContent=e.message;
    $("message").classList.add("show");
    setTimeout(()=>$("message").classList.remove("show"),2200);
  }
}

$("betMinus").onclick=()=>changeBet(-1);
$("betPlus").onclick=()=>changeBet(1);
$("spinButton").onclick=spin;
$("betAmount").addEventListener("input",updatePrizeValues);
$("betAmount").addEventListener("change",()=>{
  normalizeBet();
  updatePrizeValues();
});

loadAccount();
loadConfig();
