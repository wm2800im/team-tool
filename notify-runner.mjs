import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { PEOPLE, LABELS, isWorkingDay, frDate, reminderWindow, reminderDecision } from './notify-core.mjs';

const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
if (!raw) throw new Error('Secret FIREBASE_SERVICE_ACCOUNT_JSON absent.');
const app = initializeApp({ credential: cert(JSON.parse(raw)) });
const db = getFirestore(app);
const messaging = getMessaging(app);
const APP_BASE_URL = process.env.APP_BASE_URL || 'https://wm2800im.github.io/team-tool/';

async function enabledTokens(profileId=null){
  const snap=await db.collection('pushTokens').get();
  return snap.docs.map(d=>({id:d.id,...d.data()})).filter(x=>x.enabled!==false && x.token && (!profileId||x.profileId===profileId));
}
async function sendTokens(tokenDocs,title,body){
  if(!tokenDocs.length)return {successCount:0,failureCount:0};
  const r=await messaging.sendEachForMulticast({tokens:tokenDocs.map(x=>x.token),notification:{title,body},webpush:{fcmOptions:{link:APP_BASE_URL}}});
  const bad=[];
  r.responses.forEach((x,i)=>{if(!x.success && ['messaging/registration-token-not-registered','messaging/invalid-registration-token'].includes(x.error?.code))bad.push(tokenDocs[i].id);});
  await Promise.all(bad.map(id=>db.collection('pushTokens').doc(id).delete().catch(()=>{})));
  if(bad.length)console.log(`  ${bad.length} jeton(s) périmé(s) supprimé(s).`);
  return {successCount:r.successCount,failureCount:r.failureCount};
}

async function processBroadcastRequests(){
  const snap=await db.collection('notificationRequests').where('status','==','pending').get();
  console.log(`Demandes de test en attente : ${snap.size}`);
  for(const d of snap.docs){
    const req=d.data();
    try{
      const r=await sendTokens(await enabledTokens(),req.title||'Covoiturage',req.body||'Notification de test ✅');
      await d.ref.update({status:'sent',sentAt:FieldValue.serverTimestamp(),successCount:r.successCount,failureCount:r.failureCount});
      console.log(`Broadcast ${d.id}: ${r.successCount} ok, ${r.failureCount} échec(s)`);
    }catch(e){
      console.error('Broadcast',d.id,e);
      await d.ref.update({status:'error',error:String(e?.message||e).slice(0,500),processedAt:FieldValue.serverTimestamp()}).catch(()=>{});
    }
  }
}

async function process20hReminders(){
  const w=reminderWindow();
  if(!w.open){console.log(`Rappels : ${w.clock} à Paris, hors fenêtre 20h00–22h59.`);return;}
  const calendarSnap=await db.collection('config').doc('calendar').get();
  const calendar=calendarSnap.exists?calendarSnap.data():{exceptions:[]};
  if(!isWorkingDay(w.target,calendar)){console.log(`Rappels : ${w.clock} à Paris, ${w.target} non travaillé, aucun rappel.`);return;}
  console.log(`Rappels : ${w.clock} à Paris, pour ${frDate(w.target)} (${w.target}).`);
  const prefSnap=await db.collection('preferences').get();
  const prefs=new Map(prefSnap.docs.map(d=>[d.id,d.data()]));
  for(const pid of PEOPLE){
    const marker=db.collection('notificationRuns').doc(`reminder_${w.target}_${pid}`);
    try{
      const avail=await db.collection('availability').doc(`${w.target}_${pid}`).get();
      const markerSnap=await marker.get();
      const decision=reminderDecision({
        notificationsEnabled:prefs.get(pid)?.notificationsEnabled,
        status:avail.exists?avail.data()?.status:null,
        marker:markerSnap.exists?markerSnap.data():null
      });
      if(decision.action==='skip'){console.log(`- ${LABELS[pid]} : ${decision.reason}.`);continue;}
      const toks=await enabledTokens(pid);
      if(!toks.length){
        await marker.set({type:'reminder',date:w.target,profileId:pid,status:'retry',reason:'no-enabled-token',lastAttemptAt:FieldValue.serverTimestamp(),attempts:FieldValue.increment(1)},{merge:true});
        console.log(`- ${LABELS[pid]} : aucun appareil actif, nouvel essai au prochain passage.`);
        continue;
      }
      const r=await sendTokens(toks,'Covoiturage',`Ton statut pour ${frDate(w.target)} n’est pas encore renseigné.`);
      const ok=r.successCount>0;
      await marker.set({type:'reminder',date:w.target,profileId:pid,status:ok?'sent':'retry',...(ok?{sentAt:FieldValue.serverTimestamp()}:{reason:'push-failed',lastAttemptAt:FieldValue.serverTimestamp()}),successCount:r.successCount,failureCount:r.failureCount,attempts:FieldValue.increment(1)},{merge:true});
      console.log(`- ${LABELS[pid]} : ${ok?`rappel envoyé (${decision.reason}) sur ${r.successCount} appareil(s)`:`échec d’envoi sur ${toks.length} appareil(s), nouvel essai au prochain passage`}.`);
    }catch(e){
      console.error(`- ${LABELS[pid]} : erreur`,e);
      await marker.set({type:'reminder',date:w.target,profileId:pid,status:'retry',reason:'exception',error:String(e?.message||e).slice(0,500),lastAttemptAt:FieldValue.serverTimestamp(),attempts:FieldValue.increment(1)},{merge:true}).catch(()=>{});
    }
  }
}

await processBroadcastRequests();
await process20hReminders();
