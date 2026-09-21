const TOTAL=80;
const GROUP_SIZE=5;
const VISUAL_GROUPS=16;
const PRIZE_INDEXES=Array.from({length:TOTAL},(_,i)=>i).filter(i=>i%GROUP_SIZE===4);
const DEFAULT_PRIZES=[2,3,4,5,2,3,4,5,2,3,4,5,2,3,4,10];

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
  const visualSlices=32, angle=360/visualSlices, radius=198;

  const defs=document.createElementNS(ns,"defs");
  const gradients={
    black:["#20252b","#0b0d10","#000000"],
    2:["#9dccff","#1687ff","#063d9c"],
    3:["#8affbd","#16c978","#04733f"],
    4:["#efb6ff","#a72ee0","#5c087d"],
    5:["#ffe09a","#ff8a00","#a63d00"],
    10:["#ff9a93","#ff1d12","#980500"]
  };
  Object.entries(gradients).forEach(([key,stops])=>{
    const g=document.createElementNS(ns,"linearGradient");
    g.setAttribute("id","wheel3d-"+key);
    g.setAttribute("x1","0%");g.setAttribute("y1","0%");
    g.setAttribute("x2","100%");g.setAttribute("y2","100%");
    [["0%",stops[0]],["45%",stops[1]],["100%",stops[2]]].forEach(([offset,color])=>{
      const s=document.createElementNS(ns,"stop");
      s.setAttribute("offset",offset);s.setAttribute("stop-color",color);
      g.appendChild(s);
    });
    defs.appendChild(g);
  });
  svg.appendChild(defs);

  for(let i=0;i<visualSlices;i++){
    const start=i*angle,end=start+angle;
    const path=document.createElementNS(ns,"path");
    path.setAttribute("d",wedge(200,200,radius,start,end));
    const prize=i%2===1;
    const prizePosition=(i-1)/2;
    const multiplier=Number(prizes[prizePosition]);
    const prizeColors={
      2:{fill:"#2f80ed",stroke:"#78b5ff"},
      3:{fill:"#20a464",stroke:"#70e0a6"},
      4:{fill:"#8e44ad",stroke:"#d39bea"},
      5:{fill:"#ff9f43",stroke:"#ffd08a"},
      10:{fill:"#e53935",stroke:"#ff8a80"}
    };
    const color=prizeColors[multiplier]||{fill:"#d9aa20",stroke:"#ffe16a"};
    path.setAttribute("fill",prize?`url(#wheel3d-${multiplier})`:"url(#wheel3d-black)");
    path.setAttribute("stroke",prize?color.stroke:"#3d4148");
    path.setAttribute("stroke-width",prize?"2.5":"1.5");
    svg.appendChild(path);

    if(prize){
      const label=document.createElementNS(ns,"text");
      const [x,y]=polar(200,200,146,start+angle/2);
      label.setAttribute("x",x);label.setAttribute("y",y);
      label.setAttribute("fill","#fff");label.setAttribute("font-size","20");
      label.setAttribute("font-family","Arial,Helvetica,sans-serif");
      label.setAttribute("font-weight","900");label.setAttribute("text-anchor","middle");
      label.setAttribute("dominant-baseline","middle");label.setAttribute("paint-order","stroke");
      label.setAttribute("stroke","#000");label.setAttribute("stroke-width","3");
      label.setAttribute("class","prize-label");
      label.setAttribute("data-sector-angle",String(start+angle/2));
      const LABEL_ANGLE_OFFSET=0;
      label.setAttribute("transform",`rotate(${start+angle/2-90+LABEL_ANGLE_OFFSET} ${x} ${y})`);
      label.textContent=String(multiplier)+"x";
      svg.appendChild(label);
    }
  }

  const ring=document.createElementNS(ns,"circle");
  ring.setAttribute("cx","200");ring.setAttribute("cy","200");ring.setAttribute("r","199");
  ring.setAttribute("fill","none");ring.setAttribute("stroke","#f4c83f");ring.setAttribute("stroke-width","3");
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
  $("betAmount").value=Math.min(MAX_BET,Math.max(MIN_BET,Number((getBet()+delta).toFixed(2)))).toFixed(2);
}

function targetForSector(sector){
  const s=((Number(sector)%TOTAL)+TOTAL)%TOTAL;
  const group=Math.floor(s/GROUP_SIZE);
  const position=s%GROUP_SIZE;
  const visualAngle=360/VISUAL_GROUPS;
  const groupStart=group*visualAngle;
  if(position===4){
    return -(groupStart+visualAngle/2+visualAngle/4);
  }
  const lossSectorAngle=(visualAngle/2)/4;
  return -(groupStart+position*lossSectorAngle+lossSectorAngle/2);
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
  updatePrizeValues();

  // Estado inicial: ponteiro exatamente no centro do primeiro prêmio (2x).
  rotation=targetForSector(PRIZE_INDEXES[0]);
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
    const duration=5000;
    const start=performance.now();
    const wheel=$("wheel");

    await new Promise(resolve=>{
      function frame(now){
        const p=Math.min(1,(now-start)/duration);
        const eased=1-Math.pow(1-p,5);
        const value=from+(destination-from)*eased;
        rotation=value;
        wheel.style.transform=`rotate(${rotation}deg)`;

        if(p<1){requestAnimationFrame(frame);return}
        rotation=destination;
        wheel.style.transform=`rotate(${rotation}deg)`;

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
$("betAmount").addEventListener("input",updatePrizeValues);
$("betAmount").addEventListener("change",()=>{
  normalizeBet();
  updatePrizeValues();
});

loadAccount();
loadConfig();
