import { publicGameConfig, spinGame } from "./engine.js";
export const lucky7={id:"lucky7",name:"My Lucky 7",rows:1,columns:3,minBet:1,maxBet:100,scale:10000000,rtpBps:2608,symbols:[{id:"seven",label:"7️⃣",multiplier:10},{id:"star",label:"⭐",multiplier:5},{id:"bell",label:"🔔",multiplier:4},{id:"cherry",label:"🍒",multiplier:3},{id:"lemon",label:"🍋",multiplier:2}],outcomes:[{symbol:"seven",label:"7️⃣",multiplier:10,weight:6145},{symbol:"star",label:"⭐",multiplier:5,weight:42945},{symbol:"bell",label:"🔔",multiplier:4,weight:92025},{symbol:"cherry",label:"🍒",multiplier:3,weight:245955},{symbol:"lemon",label:"🍋",multiplier:2,weight:612930}]};
export const lucky7Config=()=>publicGameConfig(lucky7);
export const spinLucky7=args=>spinGame(lucky7,args);
