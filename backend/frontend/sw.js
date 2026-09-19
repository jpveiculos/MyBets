const CACHE_NAME="mybets-v3";
const APP_SHELL=["/","/index.html","/admin.html","/admin-manifest.json","/style.css"];

self.addEventListener("install",event=>{
  event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(APP_SHELL)).then(()=>self.skipWaiting()));
});
self.addEventListener("activate",event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE_NAME).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});
self.addEventListener("fetch",event=>{
  if(event.request.method!=="GET")return;
  event.respondWith(fetch(event.request).catch(()=>caches.match(event.request)));
});
self.addEventListener("push",event=>{
  const fallback={title:"MyBets",body:"Você tem uma nova notificação.",url:"/admin.html",tag:"mybets"};
  let data=fallback;
  try{data={...fallback,...event.data.json()}}catch{try{data.body=event.data.text()}catch{}}
  const tasks=[];
  const count=Number(data.unreadCount);
  if(Number.isFinite(count)&&"setAppBadge" in self.navigator)tasks.push(self.navigator.setAppBadge(Math.max(0,count)));
  tasks.push(self.registration.showNotification(data.title,{
    body:data.body,
    icon:data.icon||"/icon-192.svg",
    badge:data.badge||"/icon-192.svg",
    tag:data.tag||"mybets",
    data:{url:data.url||"/admin.html"},
    renotify:true
  }));
  event.waitUntil(Promise.all(tasks));
});
self.addEventListener("notificationclick",event=>{
  event.notification.close();
  const url=event.notification.data?.url||"/admin.html";
  event.waitUntil(clients.matchAll({type:"window",includeUncontrolled:true}).then(list=>{
    for(const client of list){if("focus" in client)return client.navigate(url).then(()=>client.focus())}
    return clients.openWindow(url);
  }));
});