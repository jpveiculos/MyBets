const CACHE_NAME="mybets-v1";
const APP_SHELL=["/","/index.html","/admin.html","/admin-manifest.json","/style.css"];

self.addEventListener("install",event=>{
  event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(APP_SHELL)).then(()=>self.skipWaiting()));
});
self.addEventListener("activate",event=>{
  event.waitUntil(self.clients.claim());
});
self.addEventListener("fetch",event=>{
  if(event.request.method!=="GET") return;
  event.respondWith(fetch(event.request).catch(()=>caches.match(event.request)));
});
self.addEventListener("push",event=>{
  let data={title:"MyBets",body:"Você tem uma nova notificação.",url:"/admin.html",badge:"/icon-192.png"};
  try{data={...data,...event.data.json()}}catch{try{data.body=event.data.text()}catch{}}
  event.waitUntil(self.registration.showNotification(data.title,{
    body:data.body,
    icon:data.icon||"/icon-192.png",
    badge:data.badge||"/icon-192.png",
    tag:data.tag||"mybets",
    data:{url:data.url||"/admin.html"},
    renotify:true
  }));
});
self.addEventListener("notificationclick",event=>{
  event.notification.close();
  const url=event.notification.data?.url||"/admin.html";
  event.waitUntil(clients.matchAll({type:"window",includeUncontrolled:true}).then(list=>{
    for(const client of list){if("focus" in client)return client.navigate(url).then(()=>client.focus())}
    return clients.openWindow(url);
  }));
});
