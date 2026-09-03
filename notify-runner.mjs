import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';

const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
if (!raw) throw new Error('Secret FIREBASE_SERVICE_ACCOUNT_JSON absent.');
const serviceAccount = JSON.parse(raw);
const app = initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore(app);
const messaging = getMessaging(app);
const APP_BASE_URL = process.env.APP_BASE_URL || 'https://wm2800im.github.io/team-tool/';
const TZ = 'Europe/Paris';
const PEOPLE = ['aurelien','etienne','igor','ludo','stephane'];
const LABELS = {aurelien:'Aurélien',etienne:'Étienne',igor:'Igor',ludo:'Ludo',stephane:'Stéphane'};

function localParts(){
  const parts = new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(new Date());
  const get=t=>parts.find(p=>p.type===t)?.value;
  return {year:+get('year'),month:+get('month'),day:+get('day'),hour:+get('hour'),minute:+get('minute')};
}
function isoDate(y,m,d){return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;}
function dateFromISO(ds){const [y,m,d]=ds.split('-').map(Number); return new Date(Date.UTC(y,m-1,d,12));}
function addDaysISO(ds,n){const d=dateFromISO(ds);d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);}
function easterSunday(year){
  const a=year%19,b=Math.floor(year/100),c=year%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451),month=Math.floor((h+l-7*m+114)/31),day=((h+l-7*m+114)%31)+1;
  return new Date(Date.UTC(year,month-1,day,12));
}
function juraHolidaySet(year){
  const e=easterSunday(year), eiso=e.toISOString().slice(0,10);
  const dates=[`${year}-01-01`,`${year}-01-02`,`${year}-05-01`,`${year}-06-23`,`${year}-08-01`,`${year}-08-15`,`${year}-11-01`,`${year}-12-25`];
  [-2,1,39,50,60].forEach(n=>dates.push(addDaysISO(eiso,n)));
  return new Set(dates);
}
function isWeekendISO(ds){const d=dateFromISO(ds).getUTCDay();return d===0||d===6;}
function exceptionFor(ds,calendar){return (calendar?.exceptions||[]).find(x=>x.date===ds)||null;}
function isWorkingDay(ds,calendar){
  const ex=exceptionFor(ds,calendar); if(ex?.type==='on')return true; if(ex?.type==='off')return false;
  const y=+ds.slice(0,4); return !isWeekendISO(ds) && !juraHolidaySet(y).has(ds);
}
function frDate(ds){return new Intl.DateTimeFormat('fr-FR',{weekday:'long',day:'numeric',month:'long',timeZone:TZ}).format(dateFromISO(ds));}

async function enabledTokens(profileId=null){
  const snap=await db.collection('pushTokens').get();
  return snap.docs.map(d=>({id:d.id,...d.data()})).filter(x=>x.enabled!==false && x.token && (!profileId||x.profileId===profileId));
}
async function sendTokens(tokenDocs,title,body){
  if(!tokenDocs.length)return {successCount:0,failureCount:0};
  const tokens=tokenDocs.map(x=>x.token);
  const r=await messaging.sendEachForMulticast({tokens,notification:{title,body},webpush:{fcmOptions:{link:APP_BASE_URL}}});
  const bad=[];
  r.responses.forEach((x,i)=>{if(!x.success && ['messaging/registration-token-not-registered','messaging/invalid-registration-token'].includes(x.error?.code))bad.push(tokenDocs[i].id);});
  await Promise.all(bad.map(id=>db.collection('pushTokens').doc(id).delete().catch(()=>{})));
  return {successCount:r.successCount,failureCount:r.failureCount};
}

async function processBroadcastRequests(){
  const snap=await db.collection('notificationRequests').where('status','==','pending').get();
  for(const d of snap.docs){
    const req=d.data();
    try{
      const toks=await enabledTokens();
      const r=await sendTokens(toks,req.title||'Covoiturage',req.body||'Notification de test ✅');
      await d.ref.update({status:'sent',sentAt:FieldValue.serverTimestamp(),successCount:r.successCount,failureCount:r.failureCount});
      console.log(`Broadcast ${d.id}: ${r.successCount} ok, ${r.failureCount} échec(s)`);
    }catch(e){
      console.error('Broadcast',d.id,e);
      await d.ref.update({status:'error',error:String(e?.message||e).slice(0,500),processedAt:FieldValue.serverTimestamp()}).catch(()=>{});
    }
  }
}

async function process20hReminders(){
  const now=localParts();
  if(now.hour!==20)return;
  const today=isoDate(now.year,now.month,now.day), target=addDaysISO(today,1);
  const calendarSnap=await db.collection('config').doc('calendar').get();
  const calendar=calendarSnap.exists?calendarSnap.data():{exceptions:[]};
  if(!isWorkingDay(target,calendar)){console.log(`${target}: non travaillé, aucun rappel.`);return;}
  const prefSnap=await db.collection('preferences').get();
  const prefs=new Map(prefSnap.docs.map(d=>[d.id,d.data()]));
  for(const pid of PEOPLE){
    if(prefs.get(pid)?.notificationsEnabled!==true)continue;
    const avail=await db.collection('availability').doc(`${target}_${pid}`).get();
    if(avail.exists && avail.data()?.status)continue;
    const marker=db.collection('notificationRuns').doc(`reminder_${target}_${pid}`);
    if((await marker.get()).exists)continue;
    const toks=await enabledTokens(pid);
    if(!toks.length)continue;
    const body=`Ton statut pour ${frDate(target)} n’est pas encore renseigné.`;
    const r=await sendTokens(toks,'Covoiturage',body);
    await marker.set({type:'reminder',date:target,profileId:pid,sentAt:FieldValue.serverTimestamp(),successCount:r.successCount,failureCount:r.failureCount});
    console.log(`Rappel ${LABELS[pid]} ${target}: ${r.successCount} ok`);
  }
}

await processBroadcastRequests();
await process20hReminders();
