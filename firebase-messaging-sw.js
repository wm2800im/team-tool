importScripts('./public-config.js');
importScripts('https://www.gstatic.com/firebasejs/12.18.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.18.0/firebase-messaging-compat.js');
const cfg=self.COVOIT_ENV?.firebaseConfig;
if(cfg && cfg.apiKey && cfg.apiKey!=='REMPLACER'){
  firebase.initializeApp(cfg);
  firebase.messaging();
}
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const link=event.notification?.data?.link || '../';
  event.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(list=>{
    for(const c of list){if('focus' in c)return c.focus();}
    return clients.openWindow?clients.openWindow(link):null;
  }));
});
