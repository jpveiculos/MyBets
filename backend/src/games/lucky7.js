import { publicGameConfig, spinGame } from "./engine.js";
export const lucky7={id:"lucky7",name:"My Lucky 7",rows:1,columns:3,minBet:1,maxBet:100,scale:10000000,rtpBps:5216,symbols:[{id:"seven",label:"7️⃣",multiplier:10},{id:"star",label:"⭐",multiplier:5},{id:"bell",label:"🔔",multiplier:4},{id:"cherry",label:"🍒",multiplier:3},{id:"lemon",label:"🍋",multiplier:2}],outcomes:[{symbol:"seven",label:"7️⃣",multiplier:10,weight:12290},{symbol:"star",label:"⭐",multiplier:5,weight:85890},{symbol:"bell",label:"🔔",multiplier:4,weight:184050},{symbol:"cherry",label:"🍒",multiplier:3,weight:491910},{symbol:"lemon",label:"🍋",multiplier:2,weight:1225860}]};
export const lucky7Config=()=>publicGameConfig(lucky7);
export const spinLucky7=args=>spinLucky7(args);
