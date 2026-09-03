import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js';
import { getMessaging, getToken, deleteToken, onMessage, isSupported as messagingSupported } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-messaging.js';
import {
  getAuth, signInAnonymously, onAuthStateChanged, setPersistence, browserLocalPersistence
} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js';
import {
  getFirestore, collection, doc, getDoc, getDocs, setDoc, deleteDoc, updateDoc, writeBatch,
  onSnapshot, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';
const ENV = globalThis.COVOIT_ENV || {};
const firebaseConfig = ENV.firebaseConfig || {};
const APP_VERSION = ENV.version || '4.4.0';
const IS_TEST = ENV.environment === 'test';
const VAPID_KEY = ENV.vapidKey || '';
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
let messaging = null;
let messagingSwRegistration = null;
let currentFcmToken = null;

const PEOPLE = ['aurelien','etienne','igor','ludo','stephane'];
const LABELS = {aurelien:'Aurélien',etienne:'Étienne',igor:'Igor',ludo:'Ludo',stephane:'Stéphane'};
const INITIAL = {aurelien:'A',etienne:'E',igor:'I',ludo:'L',stephane:'S'};
const STATUS = {
  present:{label:'Présent',cls:'present'}, absent:{label:'Absent',cls:'absent'},
  alone:{label:'Seul',cls:'alone'}, time:{label:'Impératif',cls:'time'}, missing:{label:'Non renseigné',cls:'missing'}
};


let authUser = null;
let profileId = null;
let linkedProfileId = null;
let profiles = new Map();
let availability = new Map();
let legacyStatus = new Map();
let compatibilities = new Map();
let plans = new Map();
let tripDays = new Map();
let preferences = new Map();
let calendarConfig = {exceptions:[]};
let unsubscribers = [];
let installPrompt = null;
let initializedSnapshots = new Set();
let appUiInitialized = false;
let accessUiInitialized = false;

const $ = id => document.getElementById(id);
const qsa = sel => [...document.querySelectorAll(sel)];
const label = id => LABELS[id] || profiles.get(id)?.name || id;
const canonical = arr => [...new Set(arr)].sort((a,b)=>label(a).localeCompare(label(b),'fr'));
const groupCode = arr => canonical(arr).map(p=>INITIAL[p]||'?').join('');
const tripGroupsForDate = d => tripDays.get(d)?.groups || [];
const iso = d => {
  const x = new Date(d);
  const y = x.getFullYear(), m = String(x.getMonth()+1).padStart(2,'0'), day = String(x.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
};
const fromISO = s => new Date(`${s}T12:00:00`);
const addDays = (d,n) => { const x=new Date(d); x.setDate(x.getDate()+n); return x; };
// Le covoiturage fonctionne sur l'heure locale France/Suisse (même fuseau horaire).
// On ne dépend volontairement pas du fuseau configuré sur le navigateur/appareil,
// afin d'éviter un décalage de date autour de minuit.
const APP_TIME_ZONE = 'Europe/Paris';
const appNowParts = () => {
  const parts = new Intl.DateTimeFormat('fr-FR', {
    timeZone: APP_TIME_ZONE,
    year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', hourCycle:'h23'
  }).formatToParts(new Date());
  const get = type => parts.find(p=>p.type===type)?.value;
  return { year:Number(get('year')), month:Number(get('month')), day:Number(get('day')), hour:Number(get('hour')) };
};
const appTodayISO = () => {
  const n=appNowParts();
  return `${n.year}-${String(n.month).padStart(2,'0')}-${String(n.day).padStart(2,'0')}`;
};
const todayISO = () => appTodayISO();
const isWeekend = d => d.getDay()===0 || d.getDay()===6;
function easterSunday(year){
  const a=year%19,b=Math.floor(year/100),c=year%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451),month=Math.floor((h+l-7*m+114)/31),day=((h+l-7*m+114)%31)+1;
  return new Date(year,month-1,day,12,0,0);
}
function juraHolidaySet(year){
  const e=easterSunday(year), dates=[`${year}-01-01`,`${year}-01-02`,`${year}-05-01`,`${year}-06-23`,`${year}-08-01`,`${year}-08-15`,`${year}-11-01`,`${year}-12-25`];
  [-2,1,39,50,60].forEach(n=>dates.push(iso(addDays(e,n))));
  return new Set(dates);
}
function calendarException(date){ return (calendarConfig?.exceptions||[]).find(x=>x.date===date)||null; }
function isWorkingDayISO(ds){
  const ex=calendarException(ds); if(ex?.type==='on')return true; if(ex?.type==='off')return false;
  const d=fromISO(ds); if(isWeekend(d))return false; return !juraHolidaySet(d.getFullYear()).has(ds);
}
const nextCarpoolISO = () => {
  const n=appNowParts(); let d=fromISO(appTodayISO()); if(n.hour>=9)d=addDays(d,1);
  while(!isWorkingDayISO(iso(d)))d=addDays(d,1); return iso(d);
};
const isPastDate = ds => ds < todayISO();
const fmtDate = (s, opts={weekday:'long',day:'numeric',month:'long'}) => fromISO(s).toLocaleDateString('fr-FR',opts);
const nowYear = () => appTodayISO().slice(0,4);
const currentYM = () => appTodayISO().slice(0,7);
const availKey = (date,pid) => `${date}_${pid}`;
const compatKey = (date,owner,responder) => `${date}_${owner}_${responder}`;
const legacyKey = (date,pid) => `${date}_${pid}`;
const baseAppUrl = () => `${location.origin}${location.pathname.replace(/index\.html$/,'').replace(/\/$/,'')}/`;

function toast(msg){
  const el=$('toast'); el.textContent=msg; el.classList.add('show'); clearTimeout(toast._t); toast._t=setTimeout(()=>el.classList.remove('show'),2400);
}
function setLoading(title,text=''){
  $('loadingOverlay').style.display='grid'; $('loadingTitle').textContent=title; $('loadingText').textContent=text;
}
function hideLoading(){ $('loadingOverlay').style.display='none'; }
function showAccess(message=''){
  $('appShell').style.display='none'; $('accessScreen').style.display='block'; hideLoading();
  if(message){$('accessError').style.display='block';$('accessError').textContent=message}else $('accessError').style.display='none';
}
function showApp(){ $('accessScreen').style.display='none'; $('appShell').style.display='block'; }
function statusMeta(v){
  if(!v)return STATUS.missing;
  if(v.status==='time')return {label:`Impératif ${v.time||''}`.trim(),cls:'time'};
  return STATUS[v.status]||STATUS.missing;
}
function isAvailable(v){ return !!v && (v.status==='present'||v.status==='time'); }
function getAvail(date,pid){ return availability.get(availKey(date,pid)) || null; }
function getCompat(date,owner,responder){ return compatibilities.get(compatKey(date,owner,responder)) || null; }

async function start(){
  try{
    initAccessUI();
    setLoading('Connexion à la base commune…','Identification de cet appareil.');
    await setPersistence(auth,browserLocalPersistence);
    if(!auth.currentUser) await signInAnonymously(auth);
    authUser = auth.currentUser;
    if(!authUser){
      await new Promise((resolve,reject)=>{
        const off=onAuthStateChanged(auth,u=>{ if(u){authUser=u;off();resolve();}},reject);
      });
    }
    await resolveDeviceIdentity();
    if(!profileId) return;
    launchLinkedApp();
  }catch(err){
    console.error(err);
    showAccess(`Connexion impossible : ${friendlyError(err)}`);
  }
}

function launchLinkedApp(){
  if(appUiInitialized) return;
  appUiInitialized=true;
  showApp();
  linkedProfileId = linkedProfileId || profileId;
  $('identityName').textContent=label(profileId);
  initStaticUI();
  initSettingsUI();
  subscribeSharedData();
}

function initAccessUI(){
  if(accessUiInitialized) return;
  accessUiInitialized=true;
  const input=$('deviceInviteInput');
  const linkBtn=$('linkDeviceBtn');
  const pasteBtn=$('pasteInviteBtn');
  if(linkBtn) linkBtn.addEventListener('click',linkDeviceFromInput);
  if(input) input.addEventListener('keydown',e=>{if(e.key==='Enter')linkDeviceFromInput();});
  if(pasteBtn) pasteBtn.addEventListener('click',async()=>{
    try{
      const txt=await navigator.clipboard.readText();
      if(txt){ input.value=txt.trim(); input.focus(); }
    }catch(e){
      input.focus();
      showAccessError('Le collage automatique est bloqué par le navigateur. Fais un appui long dans le champ puis « Coller ».');
    }
  });
}

function showAccessError(message=''){
  const el=$('accessError');
  if(!el) return;
  el.style.display=message?'block':'none';
  el.textContent=message;
}

function extractInviteToken(raw){
  const value=(raw||'').trim();
  if(!value) return null;
  try{
    const u=new URL(value);
    const token=u.searchParams.get('invite');
    if(token) return token.trim();
  }catch(e){}
  const m=value.match(/[?&]invite=([^&#]+)/i);
  if(m) return decodeURIComponent(m[1]).trim();
  // Les tokens générés par l'application sont 48 caractères hexadécimaux.
  if(/^[a-f0-9]{48}$/i.test(value)) return value.toLowerCase();
  return null;
}

async function associateInviteToken(invite){
  const invRef=doc(db,'invitations',invite);
  const invSnap=await getDoc(invRef);
  if(!invSnap.exists() || invSnap.data().active!==true){
    throw new Error('Ce lien personnel est invalide ou a été désactivé. Demande un nouveau lien à Igor.');
  }
  const pid=invSnap.data().profileId;
  await setDoc(doc(db,'deviceLinks',authUser.uid),{
    profileId:pid, inviteToken:invite, createdAt:serverTimestamp(), userAgent:navigator.userAgent.slice(0,300)
  });
  profileId=pid; linkedProfileId=pid;
  return pid;
}

async function linkDeviceFromInput(){
  const input=$('deviceInviteInput');
  const token=extractInviteToken(input?.value);
  showAccessError('');
  if(!token){
    showAccessError('Colle le lien personnel complet reçu sur WhatsApp, ou uniquement son code d’invitation.');
    return;
  }
  try{
    setLoading('Liaison de cet appareil…','Vérification du lien personnel.');
    const pid=await associateInviteToken(token);
    cleanInviteParam();
    launchLinkedApp();
    toast(`Cet appareil est maintenant associé à ${label(pid)}.`);
  }catch(e){
    console.error(e);
    showAccess(e?.message || friendlyError(e));
  }
}

async function resolveDeviceIdentity(){
  const uid=authUser.uid;
  const linkRef=doc(db,'deviceLinks',uid);
  const linkSnap=await getDoc(linkRef);
  const params=new URLSearchParams(location.search);
  const invite=params.get('invite');
  if(linkSnap.exists()){
    profileId=linkSnap.data().profileId; linkedProfileId=profileId;
    if(invite) cleanInviteParam();
    return;
  }
  if(!invite){ showAccess(); return; }
  setLoading('Association de cet appareil…','Vérification du lien personnel.');
  try{
    const pid=await associateInviteToken(invite);
    cleanInviteParam();
    toast(`Cet appareil est maintenant associé à ${label(pid)}.`);
  }catch(e){
    showAccess(e?.message || friendlyError(e));
  }
}
function cleanInviteParam(){
  const u=new URL(location.href); u.searchParams.delete('invite'); history.replaceState({},'',u.pathname+u.search+u.hash);
}
function friendlyError(err){
  const c=err?.code||'';
  if(c.includes('permission-denied')) return 'accès refusé par les règles Firestore.';
  if(c.includes('network-request-failed')||c.includes('unavailable')) return 'réseau indisponible.';
  return err?.message||String(err);
}

function activePage(id){ return $(id)?.classList.contains('active'); }
function refreshForData(name){
  if(!profileId || $('appShell').style.display==='none')return;
  if(name==='profiles'){ $('identityName').textContent=label(profileId); renderSettings(); return; }
  if(name==='availability'){ if(activePage('tomorrow'))renderTomorrow(); if(activePage('planning'))renderPlanning(); if(activePage('groups'))renderGroups(); if(activePage('history'))renderSummary(); return; }
  if(name==='legacyStatus'){ if(activePage('history'))renderSummary(); return; }
  if(name==='compatibilities'){ if(activePage('tomorrow'))renderTomorrow(); if(activePage('groups'))renderGroups(); return; }
  if(name==='plans'){ if(activePage('tomorrow'))renderTomorrow(); if(activePage('groups'))renderGroups(); return; }
  if(name==='tripDays'){ if(activePage('tomorrow'))renderTomorrow(); if(activePage('groups'))renderGroups(); if(activePage('history')){renderSummary();renderHistory();} return; }
  if(name==='preferences'){ applyTheme(); renderSettings(); return; }
  if(name==='calendar'){ if(activePage('tomorrow'))renderTomorrow(); if(activePage('planning'))renderPlanning(); if(activePage('groups'))renderGroups(); if(activePage('admin'))renderAdmin(); }
}
function subscribeSharedData(){
  setLoading('Chargement des données…','Synchronisation de l’historique et des disponibilités.');
  let initialRendered=false;
  const completeInitial=()=>{
    if(initializedSnapshots.size>=8 && !initialRendered){ initialRendered=true; hideLoading(); renderAll(); }
  };
  const watch=(name,ref,handler)=>{
    const off=onSnapshot(ref,snap=>{
      handler(snap); initializedSnapshots.add(name); completeInitial(); if(initialRendered)refreshForData(name);
    },err=>{console.error(name,err);showConnectionAlert('Erreur de synchronisation');});
    unsubscribers.push(off);
  };
  watch('profiles',collection(db,'profiles'),snap=>{ profiles=new Map(snap.docs.map(d=>[d.id,d.data()])); });
  watch('availability',collection(db,'availability'),snap=>{ availability=new Map(snap.docs.map(d=>[d.id,d.data()])); });
  watch('legacyStatus',collection(db,'legacyStatus'),snap=>{ legacyStatus=new Map(snap.docs.map(d=>[d.id,d.data()])); });
  watch('compatibilities',collection(db,'compatibilities'),snap=>{ compatibilities=new Map(snap.docs.map(d=>[d.id,d.data()])); });
  watch('plans',collection(db,'plans'),snap=>{ plans=new Map(snap.docs.map(d=>[d.id,d.data()])); });
  watch('tripDays',collection(db,'tripDays'),snap=>{ tripDays=new Map(snap.docs.map(d=>[d.id,d.data()])); });
  watch('preferences',collection(db,'preferences'),snap=>{ preferences=new Map(snap.docs.map(d=>[d.id,d.data()])); });
  const offCalendar=onSnapshot(doc(db,'config','calendar'),snap=>{ calendarConfig=snap.exists()?snap.data():{exceptions:[]}; initializedSnapshots.add('calendar'); completeInitial(); if(initialRendered)refreshForData('calendar'); },err=>{console.error('calendar',err); initializedSnapshots.add('calendar'); completeInitial();});
  unsubscribers.push(offCalendar);
}

function initStaticUI(){
  fillTimeSelect($('timeLimit'),'16:15'); fillTimeSelect($('rangeTime'),'16:15');
  const t=nextCarpoolISO(); $('groupDate').value=t; $('rangeStart').value=t; $('rangeEnd').value=iso(addDays(fromISO(t),4));
  qsa('#nav button[data-page]').forEach(b=>b.addEventListener('click',()=>openPage(b.dataset.page)));
  qsa('.status-btn').forEach(b=>b.addEventListener('click',()=>handleTomorrowStatus(b.dataset.status)));
  $('saveTime').addEventListener('click',()=>setAvailability(nextCarpoolISO(),'time',$('timeLimit').value));
  $('rangeStatus').addEventListener('change',()=>{$('rangeTimeField').style.display=$('rangeStatus').value==='time'?'flex':'none';});
  $('applyRange').addEventListener('click',applyRange); $('groupDate').addEventListener('change',renderGroups); $('addGroup').addEventListener('click',addSelectedGroup); $('validateTrips').addEventListener('click',validateTrips);
  $('summaryPeriod').addEventListener('change',()=>{renderSummary();renderHistory();}); $('historyFilter').addEventListener('input',renderHistory); $('exportHistory').addEventListener('click',exportHistoryCSV); $('installBtn').addEventListener('click',installPwa);
  $('menuBtn').addEventListener('click',openSettingsMenu); $('closeMenuBtn').addEventListener('click',closeSettingsMenu); $('menuBackdrop').addEventListener('click',closeSettingsMenu); $('openAdminBtn').addEventListener('click',()=>{closeSettingsMenu();openPage('admin');});
  $('aboutToggle').addEventListener('click',()=>{const details=$('aboutDetails');const open=details.style.display!=='none';details.style.display=open?'none':'block';$('aboutToggle').classList.toggle('open',!open);});
  $('donateBtn').addEventListener('click',()=>{const el=$('coffeeThanks');if(el){el.style.display='block';setTimeout(()=>{el.style.display='none';},3500);}});
  $('notificationsToggle').addEventListener('change',toggleNotifications); $('localNotificationTestBtn')?.addEventListener('click',testLocalNotification); $('copyFcmTokenBtn')?.addEventListener('click',copyFcmToken); qsa('[data-theme]').forEach(b=>b.addEventListener('click',()=>saveTheme(b.dataset.theme)));
  $('addCalendarException').addEventListener('click',addCalendarException); $('exportTestSnapshot').addEventListener('click',exportTestSnapshot); $('importTestSnapshot').addEventListener('click',importTestSnapshot); $('adminBroadcastTestBtn')?.addEventListener('click',queueAdminBroadcastTest);
  $('testUserSwitch').addEventListener('change',()=>switchTestUser($('testUserSwitch').value));
  setInterval(()=>{ if($('tomorrow')?.classList.contains('active')) renderTomorrow(); },60000);
  window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;$('installBtn').style.display='inline-block';});
  if('serviceWorker' in navigator) navigator.serviceWorker.register('./service-worker.js').catch(console.warn);
  initMessaging().catch(console.warn);
}
function fillTimeSelect(sel,value='16:15'){
  sel.innerHTML='';
  const start=15*60+15, end=18*60;
  for(let total=start;total<=end;total+=15){
    const h=Math.floor(total/60),m=total%60;
    const v=`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
    const o=document.createElement('option');o.value=v;o.textContent=v;sel.appendChild(o);
  }
  sel.value=[...sel.options].some(o=>o.value===value)?value:'16:15';
}
function openPage(page){
  qsa('.page').forEach(x=>x.classList.toggle('active',x.id===page)); qsa('#nav button[data-page]').forEach(x=>x.classList.toggle('active',x.dataset.page===page));
  if(page==='groups')renderGroups(); if(page==='history'){renderSummary();renderHistory();} if(page==='admin')renderAdmin();
}
async function handleTomorrowStatus(st){
  if(st==='time'){const v=getAvail(nextCarpoolISO(),profileId);$('timeLimit').value=v?.time||'16:15';$('timeBox').style.display='flex';return;}
  $('timeBox').style.display='none';await setAvailability(nextCarpoolISO(),st,null);
}
async function setAvailability(date,status,time=null){
  const key=availKey(date,profileId), previous=availability.get(key);
  const optimistic={date,profileId,status,time:status==='time'?time:null,updatedByUid:authUser.uid};
  availability.set(key,optimistic);
  if(activePage('tomorrow'))renderTomorrow(); if(activePage('planning'))renderPlanning(); if(activePage('groups'))renderGroups(); if(activePage('history'))renderSummary();
  toast(`${fmtDate(date,{weekday:'short',day:'numeric',month:'short'})} : ${statusMeta(optimistic).label} · enregistrement…`);
  try{
    await setDoc(doc(db,'availability',key),{...optimistic,updatedAt:serverTimestamp()});
    toast('✓ Enregistré');
  }catch(e){
    if(previous)availability.set(key,previous);else availability.delete(key);
    refreshForData('availability'); alert(friendlyError(e));
  }
}
async function clearAvailability(date){
  const key=availKey(date,profileId),previous=availability.get(key); availability.delete(key); refreshForData('availability'); toast('Saisie supprimée · enregistrement…');
  try{await deleteDoc(doc(db,'availability',key));toast('✓ Enregistré');}catch(e){if(previous)availability.set(key,previous);refreshForData('availability');alert(friendlyError(e));}
}

function renderAll(){
  if(!profileId||$('appShell').style.display==='none')return;
  $('identityName').textContent=label(profileId); renderTomorrow(); renderPlanning(); renderGroups(); renderSummary(); renderHistory(); renderSettings();
  if($('admin')?.classList.contains('active'))renderAdmin();
}
function renderTomorrow(){
  const ds=nextCarpoolISO(); $('tomorrowTitle').textContent=fmtDate(ds); $('tomorrowSubtitle').textContent='Prochain jour travaillé';
  const mine=getAvail(ds,profileId),mineMeta=statusMeta(mine);
  qsa('.status-btn').forEach(b=>b.classList.toggle('selected',mine?.status===b.dataset.status));
  $('timeBox').style.display=mine?.status==='time'?'flex':'none'; if(mine?.status==='time')$('timeLimit').value=mine.time||'16:15';
  const mineSummary=$('myTomorrowSummary'); if(mineSummary)mineSummary.textContent='';
  const box=$('collectiveTomorrow');box.innerHTML='';let answered=0;
  PEOPLE.forEach(p=>{const v=getAvail(ds,p);if(v)answered++;const m=statusMeta(v);const row=document.createElement('div');row.className='person-row compact-person';row.innerHTML=`<div class="avatar">${INITIAL[p]}</div><div class="grow"><strong>${label(p)}</strong></div><span class="pill ${m.cls}">${m.label}</span>`;box.appendChild(row);});
  const count=document.createElement('div');count.className='responses-count';count.textContent=`${answered}/5 renseignés`;box.appendChild(count); renderTimeCompatibility(ds,mine); renderQuickProposal(ds);
}
function renderTimeCompatibility(ds,mine){
  const box=$('timeCompatibilityBox');
  if(!mine || !isAvailable(mine)){box.style.display='none';box.innerHTML='';return;}
  const constraints=PEOPLE.filter(p=>p!==profileId).map(p=>({p,v:getAvail(ds,p)})).filter(x=>x.v?.status==='time');
  if(!constraints.length){box.style.display='none';box.innerHTML='';return;}
  box.style.display='block';
  box.innerHTML='<strong>Impératifs horaires des collègues</strong><div class="small muted">Réponds uniquement pour les horaires qui te concernent.</div>';
  constraints.forEach(({p,v})=>{
    const r=getCompat(ds,p,profileId); const current=(r&&r.ownerTime===v.time)?r.response:null;
    const item=document.createElement('div');item.className='compat-item';
    item.innerHTML=`<div><strong>${label(p)}</strong> doit partir au plus tard à <strong>${v.time}</strong>.</div><div class="small muted">Peux-tu partir avec ${label(p)} à cet horaire ?</div>
      <div class="compat-actions"><button class="compat-btn yes ${current==='yes'?'selected':''}" data-owner="${p}" data-answer="yes">✅ Oui</button><button class="compat-btn no ${current==='no'?'selected':''}" data-owner="${p}" data-answer="no">❌ Non</button></div>`;
    box.appendChild(item);
  });
  box.querySelectorAll('.compat-btn').forEach(b=>b.addEventListener('click',()=>saveCompatibility(ds,b.dataset.owner,b.dataset.answer)));
}
async function saveCompatibility(date,owner,response){
  const ownerV=getAvail(date,owner); if(ownerV?.status!=='time')return; const key=compatKey(date,owner,profileId),previous=compatibilities.get(key);
  const optimistic={date,ownerId:owner,responderId:profileId,response,ownerTime:ownerV.time}; compatibilities.set(key,optimistic);
  if(activePage('tomorrow'))renderTomorrow(); if(activePage('groups'))renderGroups(); toast(response==='yes'?'Compatibilité validée · enregistrement…':'Incompatibilité enregistrée · enregistrement…');
  try{await setDoc(doc(db,'compatibilities',key),{...optimistic,updatedAt:serverTimestamp()});toast('✓ Enregistré');}
  catch(e){if(previous)compatibilities.set(key,previous);else compatibilities.delete(key);refreshForData('compatibilities');alert(friendlyError(e));}
}

function workingDays(start,count){
  const out=[];let d=fromISO(start);while(out.length<count){const ds=iso(d);if(isWorkingDayISO(ds))out.push(ds);d=addDays(d,1);}return out;
}
function renderPlanning(){
  const list=$('plannerList'); if(!list)return; list.innerHTML='';
  workingDays(nextCarpoolISO(),15).forEach(ds=>{
    const v=getAvail(ds,profileId); const row=document.createElement('div');row.className='planner-row';
    row.innerHTML=`<strong>${fmtDate(ds,{weekday:'short',day:'numeric',month:'short'})}</strong>
      <select data-day="${ds}" class="planner-select input"><option value="">Non renseigné</option><option value="present">Présent</option><option value="absent">Absent</option><option value="alone">Seul</option><option value="time">Impératif horaire</option></select>`;
    const sel=row.querySelector('select');sel.value=v?.status||'';
    if(v?.status==='time'){
      const ts=document.createElement('select');ts.className='planner-time input';fillTimeSelect(ts,v.time||'16:15');
      ts.addEventListener('change',()=>setAvailability(ds,'time',ts.value));row.appendChild(ts);
    }
    sel.addEventListener('change',()=>{
      if(!sel.value) clearAvailability(ds);
      else if(sel.value==='time') setAvailability(ds,'time',v?.time||'16:15');
      else setAvailability(ds,sel.value,null);
    });
    list.appendChild(row);
  });
}
async function applyRange(){
  const a=$('rangeStart').value,b=$('rangeEnd').value,st=$('rangeStatus').value,tm=$('rangeTime').value;
  if(!a||!b||a>b){alert('Vérifie les dates.');return;}
  const jobs=[];let d=fromISO(a),end=fromISO(b),n=0;
  while(d<=end){const ds=iso(d);if(isWorkingDayISO(ds)){jobs.push(setDoc(doc(db,'availability',availKey(ds,profileId)),{date:ds,profileId,status:st,time:st==='time'?tm:null,updatedAt:serverTimestamp(),updatedByUid:authUser.uid}));n++;}d=addDays(d,1);}
  try{await Promise.all(jobs);toast(`${n} jour(s) renseigné(s).`);}catch(e){alert(friendlyError(e));}
}

function currentPlan(date){ return plans.get(date)?.groups || []; }
function explicitIncompatibilities(date,members){
  const out=[];
  members.forEach(owner=>{
    const ov=getAvail(date,owner); if(ov?.status!=='time')return;
    members.filter(r=>r!==owner).forEach(responder=>{
      const rv=getAvail(date,responder); if(!isAvailable(rv))return;
      const c=getCompat(date,owner,responder);
      if(c?.ownerTime===ov.time && c.response==='no') out.push({owner,responder,time:ov.time});
    });
  }); return out;
}
function unknownCompatibilities(date,members){
  const out=[];
  members.forEach(owner=>{
    const ov=getAvail(date,owner); if(ov?.status!=='time')return;
    members.filter(r=>r!==owner).forEach(responder=>{
      const rv=getAvail(date,responder); if(!isAvailable(rv))return;
      const c=getCompat(date,owner,responder);
      if(!c || c.ownerTime!==ov.time) out.push({owner,responder,time:ov.time});
    });
  }); return out;
}
function renderGroups(){
  if(!$('availablePeople'))return; const ds=$('groupDate').value||nextCarpoolISO();
  const past=isPastDate(ds); const groups=currentPlan(ds); const assigned=new Set(groups.flatMap(g=>g.members));
  const box=$('availablePeople');box.innerHTML='';
  PEOPLE.forEach(p=>{
    const v=getAvail(ds,p),m=statusMeta(v); const can=!assigned.has(p) && (past || isAvailable(v));
    const row=document.createElement('label');row.className='person-row';
    const info=assigned.has(p)?'Déjà dans un groupe':(past?`${m.label} · saisie a posteriori`:m.label);
    row.innerHTML=`<input type="checkbox" class="group-check" value="${p}" ${can?'checked':'disabled'}><div class="avatar">${INITIAL[p]}</div><div class="grow"><strong>${label(p)}</strong><div class="small muted">${info}</div></div>`;
    box.appendChild(row);
  });
  box.querySelectorAll('.group-check').forEach(c=>c.addEventListener('change',()=>renderGroupCompatibilityMessage(ds)));
  renderGroupCompatibilityMessage(ds); renderDraftGroups(ds); renderValidatedInfo(ds);
}
function renderGroupCompatibilityMessage(ds){
  const members=qsa('.group-check:checked').map(x=>x.value),msg=$('groupCompatibilityMessage');
  if(members.length<2){msg.innerHTML='';return;}
  if(isPastDate(ds)){
    const unusual=members.filter(p=>!isAvailable(getAvail(ds,p))).map(p=>`${label(p)} (${statusMeta(getAvail(ds,p)).label})`);
    msg.innerHTML=`<div class="notice oknotice"><strong>Saisie a posteriori</strong><div class="small">Tous les covoitureurs peuvent être sélectionnés, même sans statut « Présent ».${unusual.length?` Sélection actuelle : ${unusual.join(' · ')}.`:''}</div></div>`;
    return;
  }
  const bad=explicitIncompatibilities(ds,members),unknown=unknownCompatibilities(ds,members);
  if(bad.length)msg.innerHTML=`<div class="group-error">❌ Groupe incompatible : ${bad.map(x=>`${label(x.responder)} a refusé ${x.time} avec ${label(x.owner)}`).join(' · ')}</div>`;
  else if(unknown.length)msg.innerHTML=`<div class="group-warning">⚠️ Compatibilité non confirmée : ${unknown.map(x=>`${label(x.responder)} ↔ ${label(x.owner)} ${x.time}`).join(' · ')}</div>`;
  else msg.innerHTML='';
}
function flattenTrips(){
  const out=[];tripDays.forEach((day,date)=>{(day.groups||[]).forEach((g,i)=>out.push({date,id:g.id||`${date}-${i}`,participants:g.members||g.participants||[],driver:g.driver||g.driverId,source:g.source||day.source||'app'}));});return out;
}
function driverSuggestion(ds,members){
  const target=canonical(members).join('|'); const counts=Object.fromEntries(members.map(p=>[p,0]));
  flattenTrips().filter(t=>t.date<ds&&canonical(t.participants).join('|')===target).forEach(t=>{if(t.driver in counts)counts[t.driver]++;});
  const min=Math.min(...members.map(p=>counts[p]));let candidates=canonical(members.filter(p=>counts[p]===min));
  if(candidates.length>1){const prev=iso(addDays(fromISO(ds),-1));const drovePrev=new Set(flattenTrips().filter(t=>t.date===prev).map(t=>t.driver));const notPrev=candidates.filter(p=>!drovePrev.has(p));if(notPrev.length)candidates=notPrev;}
  return {counts,candidates,key:groupCode(members)};
}
async function addSelectedGroup(){
  const ds=$('groupDate').value;const members=qsa('.group-check:checked').map(x=>x.value);
  if(members.length<2||members.length>5){alert('Sélectionne entre 2 et 5 personnes.');return;}
  const bad=isPastDate(ds)?[]:explicitIncompatibilities(ds,members);if(bad.length){alert('Ce groupe contient une incompatibilité horaire explicite.');return;}
  const sug=driverSuggestion(ds,members);const groups=[...currentPlan(ds),{id:crypto.randomUUID(),members:canonical(members),driver:sug.candidates[0]||canonical(members)[0]}];
  await savePlan(ds,groups);toast('Groupe ajouté.');
}
async function savePlan(date,groups){
  const previous=plans.get(date); const normalized=groups.map(g=>({id:g.id||crypto.randomUUID(),members:canonical(g.members),driver:g.driver}));
  plans.set(date,{date,groups:normalized,updatedBy:profileId});
  if(activePage('tomorrow'))renderTomorrow(); if(activePage('groups'))renderGroups();
  try{await setDoc(doc(db,'plans',date),{date,groups:normalized,updatedAt:serverTimestamp(),updatedBy:profileId});}
  catch(e){if(previous)plans.set(date,previous);else plans.delete(date);refreshForData('plans');throw e;}
}
function renderDraftGroups(ds){
  const box=$('draftGroups'),gs=currentPlan(ds);box.innerHTML='';
  if(!gs.length){box.innerHTML='<div class="empty">Aucun groupe prévu.</div>';$('validateTrips').disabled=true;return;}
  $('validateTrips').disabled=false;
  gs.forEach((g,idx)=>{
    const sug=driverSuggestion(ds,g.members),equal=sug.candidates.length>1;const div=document.createElement('div');div.className='group-card';
    div.innerHTML=`<div class="row" style="justify-content:space-between"><strong>Groupe ${idx+1} · ${sug.key}</strong><button class="btn danger smallbtn del-group" data-id="${g.id}">Supprimer</button></div>
      <div class="group-members">${canonical(g.members).map(p=>`<span class="member-chip">${label(p)}</span>`).join('')}</div>
      <div class="suggestion ${equal?'tie':''}">${equal?`⚖️ Égalité : ${sug.candidates.map(label).join(' / ')}`:`🚗 Conducteur conseillé : ${label(sug.candidates[0])}`}<div class="small">Compteurs : ${canonical(g.members).map(p=>`${label(p)} ${sug.counts[p]}`).join(' · ')}</div></div>
      <div class="field"><label>Conducteur réel / prévu</label><select class="driver-select input" data-id="${g.id}">${canonical(g.members).map(p=>`<option value="${p}" ${g.driver===p?'selected':''}>${label(p)}</option>`).join('')}</select></div>`;
    box.appendChild(div);
  });
  box.querySelectorAll('.del-group').forEach(b=>b.addEventListener('click',async()=>{await savePlan(ds,currentPlan(ds).filter(g=>g.id!==b.dataset.id));toast('Groupe supprimé.');}));
  box.querySelectorAll('.driver-select').forEach(s=>s.addEventListener('change',async()=>{const gs=currentPlan(ds).map(g=>g.id===s.dataset.id?{...g,driver:s.value}:g);await savePlan(ds,gs);toast('Conducteur modifié.');}));
}
function groupsHaveOverlap(groups){
  const seen=new Set();for(const g of groups){for(const p of g.members){if(seen.has(p))return p;seen.add(p);}}return null;
}
async function validateTrips(){
  const ds=$('groupDate').value,groups=currentPlan(ds);if(!groups.length)return;try{await validateGroupsForDate(ds,groups);$('validationMessage').textContent=`${groups.length} trajet(s) validé(s) pour ${fmtDate(ds)}.`;}catch(e){alert(friendlyError(e));}
}
function renderValidatedInfo(ds){
  const groups=tripGroupsForDate(ds),box=$('validatedTodayInfo');
  if(!groups.length){box.innerHTML='';return;}
  box.innerHTML=`<div class="notice oknotice"><strong>${groups.length} trajet(s) déjà validé(s)</strong><div class="small">Valider de nouveau remplacera les groupes de cette date, ce qui évite les doublons.</div></div>`;
}
function loadValidatedIntoPlan(date){
  const groups=tripGroupsForDate(date).map(g=>({id:g.id||crypto.randomUUID(),members:canonical(g.members||g.participants||[]),driver:g.driver||g.driverId}));
  $('groupDate').value=date; if(groups.length)savePlan(date,groups).catch(e=>alert(friendlyError(e)));
  openPage('groups'); renderGroups(); toast('Trajet chargé pour modification.');
}
async function deleteHistoryGroup(date,id){
  const day=tripDays.get(date);if(!day)return;const groups=(day.groups||[]).filter(g=>(g.id||'')!==id);
  if(!confirm(`Supprimer ce trajet du ${fmtDate(date)} ?`))return;
  const previous=day;
  if(groups.length)tripDays.set(date,{...day,groups,updatedBy:profileId});else tripDays.delete(date);
  if(activePage('tomorrow'))renderTomorrow();if(activePage('groups')){renderGroups();renderValidatedInfo(date);}if(activePage('history')){renderSummary();renderHistory();}
  toast('Trajet supprimé · enregistrement…');
  try{
    if(groups.length)await setDoc(doc(db,'tripDays',date),{...day,groups,updatedAt:serverTimestamp(),updatedBy:profileId});else await deleteDoc(doc(db,'tripDays',date));
    toast('✓ Trajet supprimé');
  }catch(e){tripDays.set(date,previous);refreshForData('tripDays');alert(friendlyError(e));}
}

function periodMatch(date,period){if(period==='month')return date.startsWith(currentYM());if(period==='year')return date.startsWith(`${nowYear()}-`);return true;}
function renderSummary(){
  if(!$('summaryUser'))return; const period=$('summaryPeriod').value; $('summaryUser').textContent=label(profileId);
  let driver=0,passenger=0;const carpoolDates=new Set(); flattenTrips().filter(t=>periodMatch(t.date,period)).forEach(t=>{if(t.participants.includes(profileId)){carpoolDates.add(t.date);if(t.driver===profileId)driver++;else passenger++;}});
  const current=[...availability.values()].filter(v=>v.profileId===profileId&&periodMatch(v.date,period)); const currentByDate=new Map(current.map(v=>[v.date,v]));
  const legacy=[...legacyStatus.values()].filter(v=>v.profileId===profileId&&periodMatch(v.date,period)&&!currentByDate.has(v.date)&&!carpoolDates.has(v.date));
  const trackedDates=new Set(carpoolDates); current.forEach(v=>trackedDates.add(v.date)); legacy.forEach(v=>trackedDates.add(v.date));
  $('kDriver').textContent=driver; $('kPassenger').textContent=passenger; $('kCarpooled').textContent=carpoolDates.size; $('kTracked').textContent=trackedDates.size;
}
function buildHistoryCounterSnapshots(trips){
  const states=new Map(),snapshots=new Map(); const ordered=[...trips].sort((a,b)=>a.date.localeCompare(b.date)||String(a.id).localeCompare(String(b.id)));
  for(const t of ordered){const members=canonical(t.participants),key=members.join('|');let state=states.get(key);if(!state){state=Object.fromEntries(members.map(p=>[p,0]));states.set(key,state);}if(t.driver in state)state[t.driver]++;snapshots.set(`${t.date}|${t.id}`,{...state});}return snapshots;
}
function renderHistory(){
  if(!$('historyList'))return; const raw=flattenTrips(),counterSnapshots=buildHistoryCounterSnapshots(raw),all=[...raw].sort((a,b)=>b.date.localeCompare(a.date)); $('historyCount').textContent=all.length; renderQualityChecks(all);
  const q=($('historyFilter').value||'').trim().toLowerCase();let ts=all; if(q)ts=ts.filter(t=>`${t.date} ${groupCode(t.participants)} ${canonical(t.participants).map(label).join(' ')} ${label(t.driver)}`.toLowerCase().includes(q)); ts=ts.slice(0,300);
  $('historyList').innerHTML=ts.map(t=>{const counts=counterSnapshots.get(`${t.date}|${t.id}`)||{};return `<div class="hist-row"><div>${t.date}</div><div><strong>${groupCode(t.participants)}</strong> · ${canonical(t.participants).map(label).join(', ')}</div><div class="driver">🚗 ${label(t.driver)}</div><div class="hist-actions"><button class="btn secondary smallbtn edit-trip" data-date="${t.date}">Modifier</button><button class="btn danger smallbtn delete-trip" data-date="${t.date}" data-id="${t.id}">Suppr.</button></div><div class="hist-counter">Compteurs après ce trajet : ${canonical(t.participants).map(p=>`${label(p)} <strong>${counts[p]||0}</strong>`).join(' · ')}</div></div>`;}).join('')||'<div class="empty">Aucun résultat.</div>';
  $('historyList').querySelectorAll('.edit-trip').forEach(b=>b.addEventListener('click',()=>loadValidatedIntoPlan(b.dataset.date))); $('historyList').querySelectorAll('.delete-trip').forEach(b=>b.addEventListener('click',()=>deleteHistoryGroup(b.dataset.date,b.dataset.id)));
}
function exportHistoryCSV(){
  const rows=[['Date','Groupe','Participants','Conducteur','Source']];
  flattenTrips().sort((a,b)=>a.date.localeCompare(b.date)).forEach(t=>rows.push([t.date,groupCode(t.participants),canonical(t.participants).map(label).join(' + '),label(t.driver),t.source||'']));
  const esc=v=>`"${String(v??'').replaceAll('"','""')}"`;const csv='\ufeff'+rows.map(r=>r.map(esc).join(';')).join('\r\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`Historique_Covoiturage_${iso(new Date())}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Historique exporté.');
}

async function queueAdminBroadcastTest(){
  if(linkedProfileId!=='igor'){alert('Action réservée à Igor.');return;}
  if(!confirm('Envoyer une notification de test à tous les appareils ayant activé les notifications ?'))return;
  const btn=$('adminBroadcastTestBtn'),state=$('adminBroadcastState');
  if(btn){btn.disabled=true;btn.textContent='Envoi demandé…';}
  if(state)state.textContent='Mise en file d’attente…';
  try{
    const id=`broadcast_${Date.now()}_${crypto.randomUUID().slice(0,8)}`;
    await setDoc(doc(db,'notificationRequests',id),{
      type:'broadcast-test',title:'Covoiturage',body:'Notification de test ✅',status:'pending',createdBy:'igor',createdAt:serverTimestamp()
    });
    if(state)state.textContent='✓ Demande enregistrée. Envoi à tous les appareils activés dans quelques minutes.';
    toast('Notification de test demandée.');
  }catch(e){if(state)state.textContent='Erreur : '+friendlyError(e);alert(friendlyError(e));}
  finally{if(btn){btn.disabled=false;btn.textContent='🔔 Envoyer à tous';}}
}

async function renderAdmin(){
  if(linkedProfileId!=='igor')return; $('inviteList').innerHTML='<div class="muted">Chargement…</div>'; $('deviceList').innerHTML='<div class="muted">Chargement…</div>';
  try{
    const [invSnap,devSnap]=await Promise.all([getDocs(collection(db,'invitations')),getDocs(collection(db,'deviceLinks'))]); const invs=invSnap.docs.map(d=>({token:d.id,...d.data()})); $('inviteList').innerHTML='';
    PEOPLE.forEach(pid=>{const active=invs.filter(x=>x.profileId===pid&&x.active===true).sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0))[0];const div=document.createElement('div');div.className='admin-item';if(active){const url=`${baseAppUrl()}?invite=${active.token}`;div.innerHTML=`<strong>${label(pid)}</strong><div class="linkbox">${url}</div><div class="row"><button class="btn secondary smallbtn copy-invite" data-url="${url}">Copier le lien</button><button class="btn danger smallbtn regen-invite" data-pid="${pid}">Régénérer</button></div>`;}else div.innerHTML=`<strong>${label(pid)}</strong><div class="small muted">Aucun lien actif.</div><button class="btn secondary smallbtn regen-invite" data-pid="${pid}">Créer un lien</button>`;$('inviteList').appendChild(div);});
    $('inviteList').querySelectorAll('.copy-invite').forEach(b=>b.addEventListener('click',async()=>{await navigator.clipboard.writeText(b.dataset.url);toast('Lien copié.');})); $('inviteList').querySelectorAll('.regen-invite').forEach(b=>b.addEventListener('click',()=>regenerateInvite(b.dataset.pid,invs)));
    const devices=devSnap.docs.map(d=>({uid:d.id,...d.data()})); $('deviceList').innerHTML=''; if(!devices.length)$('deviceList').innerHTML='<div class="empty">Aucun appareil.</div>'; devices.sort((a,b)=>label(a.profileId).localeCompare(label(b.profileId),'fr')).forEach(x=>{const div=document.createElement('div');div.className='admin-item';const isCurrent=x.uid===authUser.uid;div.innerHTML=`<div class="row"><strong class="grow">${label(x.profileId)}${isCurrent?' · cet appareil':''}</strong><button class="btn danger smallbtn revoke-device" data-uid="${x.uid}">Révoquer</button></div><div class="small muted">ID : ${x.uid.slice(0,10)}…</div>`;$('deviceList').appendChild(div);}); $('deviceList').querySelectorAll('.revoke-device').forEach(b=>b.addEventListener('click',()=>revokeDevice(b.dataset.uid)));
    renderCalendarExceptions(); $('testImportBlock').style.display=IS_TEST?'flex':'none';
  }catch(e){$('inviteList').innerHTML=`<div class="notice danger">${friendlyError(e)}</div>`;$('deviceList').innerHTML='';}
}
function randomToken(){const b=new Uint8Array(24);crypto.getRandomValues(b);return [...b].map(x=>x.toString(16).padStart(2,'0')).join('');}
async function regenerateInvite(pid,invs=[]){
  if(!confirm(`Régénérer le lien personnel de ${label(pid)} ? Les appareils déjà associés continueront de fonctionner.`))return;
  try{
    const current=invs.filter(x=>x.profileId===pid&&x.active===true);await Promise.all(current.map(x=>updateDoc(doc(db,'invitations',x.token),{active:false,disabledAt:serverTimestamp()})));
    const token=randomToken();await setDoc(doc(db,'invitations',token),{profileId:pid,active:true,createdAt:serverTimestamp(),createdBy:'igor'});toast('Nouveau lien créé.');renderAdmin();
  }catch(e){alert(friendlyError(e));}
}
async function revokeDevice(uid){
  if(!confirm('Révoquer cet appareil ? Il devra réutiliser le lien personnel pour être associé de nouveau.'))return;
  try{await deleteDoc(doc(db,'deviceLinks',uid));toast('Appareil révoqué.');if(uid===authUser.uid){setTimeout(()=>location.reload(),800)}else renderAdmin();}catch(e){alert(friendlyError(e));}
}



function showConnectionAlert(message=''){
  const el=$('connectionAlert'); if(!el)return; el.style.display=message?'block':'none'; el.textContent=message;
}
function openSettingsMenu(){ $('menuBackdrop').style.display='block'; $('sideMenu').classList.add('open'); $('sideMenu').setAttribute('aria-hidden','false'); renderSettings(); }
function closeSettingsMenu(){ $('menuBackdrop').style.display='none'; $('sideMenu').classList.remove('open'); $('sideMenu').setAttribute('aria-hidden','true'); }
function pref(pid=profileId){ return preferences.get(pid)||{theme:'auto',notificationsEnabled:false}; }
function resolvedTheme(theme){ if(theme==='dark'||theme==='light')return theme; return matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'; }
function applyTheme(){ const theme=pref(profileId).theme||'auto'; document.documentElement.dataset.theme=resolvedTheme(theme); qsa('[data-theme]').forEach(b=>b.classList.toggle('active',b.dataset.theme===theme)); }
async function saveTheme(theme){ const previous=pref(profileId),optimistic={...previous,theme};preferences.set(profileId,optimistic);applyTheme();renderSettings();try{await setDoc(doc(db,'preferences',profileId),{theme,updatedAt:serverTimestamp()},{merge:true});}catch(e){preferences.set(profileId,previous);applyTheme();renderSettings();alert(friendlyError(e));} }
function initSettingsUI(){
  $('aboutVersion').textContent=APP_VERSION; $('testBanner').style.display=IS_TEST?'block':'none'; $('testSwitchBlock').style.display=IS_TEST?'block':'none'; $('adminMenuBlock').style.display=linkedProfileId==='igor'?'block':'none';
  if(IS_TEST){$('testUserSwitch').innerHTML=PEOPLE.map(p=>`<option value="${p}">${label(p)}</option>`).join('');$('testUserSwitch').value=profileId;}
  renderSettings();
}
function renderSettings(){
  if(!$('menuProfileName'))return; $('menuProfileName').textContent=IS_TEST&&profileId!==linkedProfileId?`${label(linkedProfileId)} · simulation ${label(profileId)}`:label(profileId); $('aboutVersion').textContent=APP_VERSION;
  $('adminMenuBlock').style.display=linkedProfileId==='igor'?'block':'none'; $('testSwitchBlock').style.display=IS_TEST?'block':'none'; if(IS_TEST)$('testUserSwitch').value=profileId;
  const theme=pref(profileId).theme||'auto'; qsa('[data-theme]').forEach(b=>b.classList.toggle('active',b.dataset.theme===theme));
  const np=pref(linkedProfileId); $('notificationsToggle').checked=np.notificationsEnabled===true; $('notificationsToggle').disabled=IS_TEST&&profileId!==linkedProfileId;
  $('notificationStatus').textContent=(IS_TEST&&profileId!==linkedProfileId)?'Repasse sur Igor pour tester les notifications de cet appareil.':(np.notificationsEnabled?'Rappel activé à 20h.':'Désactivé par défaut.');
  const canUseNotificationsHere=!IS_TEST||profileId===linkedProfileId;
  const nta=$('notificationTestActions'); if(nta)nta.style.display=(canUseNotificationsHere&&np.notificationsEnabled)?'flex':'none';
  const copyTokenBtn=$('copyFcmTokenBtn'); if(copyTokenBtn)copyTokenBtn.style.display=IS_TEST?'':'none';
  $('simulatedBadge').style.display=IS_TEST&&profileId!==linkedProfileId?'inline-block':'none'; $('simulatedBadge').textContent=IS_TEST&&profileId!==linkedProfileId?`simule ${label(profileId)}`:'';
}
function switchTestUser(pid){ if(!IS_TEST||!PEOPLE.includes(pid))return; profileId=pid; $('identityName').textContent=label(pid); applyTheme(); renderAll(); renderSettings(); closeSettingsMenu(); toast(`Simulation : ${label(pid)}`); }

async function initMessaging(){
  if(!('Notification' in window) || !(await messagingSupported()))return;
  messaging=getMessaging(app);
  if('serviceWorker' in navigator){try{messagingSwRegistration=await navigator.serviceWorker.register('./firebase-messaging-sw.js',{scope:'./fcm/'});}catch(e){console.warn('FCM SW',e);}}
  onMessage(messaging,payload=>toast(payload?.notification?.body||'Nouvelle notification Covoiturage'));
}
async function toggleNotifications(){
  const el=$('notificationsToggle'); const enable=el.checked;
  if(IS_TEST&&profileId!==linkedProfileId){el.checked=false;alert('Repasse sur Igor pour activer les notifications de cet appareil.');return;}
  try{
    if(enable){
      if(!VAPID_KEY||VAPID_KEY.includes('REMPLACER'))throw new Error('La clé Web Push VAPID n’est pas encore configurée.');
      if(!messaging)await initMessaging(); const permission=await Notification.requestPermission(); if(permission!=='granted')throw new Error('Autorisation de notification refusée sur cet appareil.');
      const token=await getToken(messaging,{vapidKey:VAPID_KEY,serviceWorkerRegistration:messagingSwRegistration||undefined}); if(!token)throw new Error('Impossible d’obtenir le jeton de notification.'); currentFcmToken=token;
      await setDoc(doc(db,'pushTokens',authUser.uid),{profileId:linkedProfileId,token,enabled:true,userAgent:navigator.userAgent.slice(0,300),updatedAt:serverTimestamp()});
      await setDoc(doc(db,'preferences',linkedProfileId),{notificationsEnabled:true,updatedAt:serverTimestamp()},{merge:true}); toast('Notifications activées.');
    }else{
      await setDoc(doc(db,'preferences',linkedProfileId),{notificationsEnabled:false,updatedAt:serverTimestamp()},{merge:true}); await deleteDoc(doc(db,'pushTokens',authUser.uid)).catch(()=>{}); if(messaging)await deleteToken(messaging).catch(()=>{}); currentFcmToken=null; toast('Notifications désactivées.');
    }
  }catch(e){console.error(e);el.checked=!enable;alert(e.message||friendlyError(e));}
}

async function ensureFcmToken(){
  if(currentFcmToken)return currentFcmToken;
  if(!VAPID_KEY)throw new Error('Clé VAPID absente.');
  if(!messaging)await initMessaging();
  if(Notification.permission!=='granted')throw new Error('Active d’abord les notifications.');
  currentFcmToken=await getToken(messaging,{vapidKey:VAPID_KEY,serviceWorkerRegistration:messagingSwRegistration||undefined});
  return currentFcmToken;
}
async function testLocalNotification(){
  try{
    if(Notification.permission!=='granted')throw new Error('Active d’abord les notifications.');
    const reg=messagingSwRegistration || await navigator.serviceWorker.ready;
    await reg.showNotification(IS_TEST?'Covoiturage · TEST':'Covoiturage',{body:'Notification de test reçue correctement ✅',icon:'./icon-192.png',badge:'./icon-192.png',data:{link:'../'}});
    toast('Notification de test envoyée sur cet appareil.');
  }catch(e){alert(e.message||friendlyError(e));}
}
async function copyFcmToken(){
  try{const token=await ensureFcmToken();await navigator.clipboard.writeText(token);toast('Jeton FCM copié.');}
  catch(e){alert(e.message||friendlyError(e));}
}

function pairExplicitlyIncompatible(date,a,b){
  for(const [owner,responder] of [[a,b],[b,a]]){const ov=getAvail(date,owner);if(ov?.status!=='time')continue;const c=getCompat(date,owner,responder);if(c?.ownerTime===ov.time&&c.response==='no')return true;}return false;
}
function partitionPeople(items){
  const out=[]; function rec(i,groups){if(i===items.length){out.push(groups.map(g=>[...g]));return;}const p=items[i];for(let g=0;g<groups.length;g++){groups[g].push(p);rec(i+1,groups);groups[g].pop();}groups.push([p]);rec(i+1,groups);groups.pop();}rec(0,[]);return out;
}
function globalCompatibilityState(date,people){
  const unknown=unknownCompatibilities(date,people);
  const rejected=explicitIncompatibilities(date,people);
  return {unknown,rejected,pending:unknown.length>0};
}
function autoSuggestedGroups(date){
  const availablePeople=PEOPLE.filter(p=>isAvailable(getAvail(date,p))); if(availablePeople.length<2)return {groups:[],singles:availablePeople,pending:false,unknown:[],rejected:[]};
  const state=globalCompatibilityState(date,availablePeople);
  // Tant qu'une compatibilité liée à un impératif n'est pas renseignée, on ne répartit personne.
  // On conserve le groupe naturel complet comme aperçu, mais sa validation est bloquée.
  if(state.pending){
    const sug=driverSuggestion(date,availablePeople);
    return {groups:[{id:`auto-${groupCode(availablePeople)}`,members:canonical(availablePeople),driver:sug.candidates[0]||canonical(availablePeople)[0]}],singles:[],pending:true,unknown:state.unknown,rejected:state.rejected};
  }
  const order=[...availablePeople].sort((a,b)=>{const av=getAvail(date,a),bv=getAvail(date,b);if(av?.status==='time'&&bv?.status!=='time')return -1;if(bv?.status==='time'&&av?.status!=='time')return 1;if(av?.status==='time'&&bv?.status==='time')return (av.time||'').localeCompare(bv.time||'');return label(a).localeCompare(label(b),'fr');});
  let best=null,bestScore=Infinity; for(const part of partitionPeople(order)){
    let invalid=false; for(const g of part){for(let i=0;i<g.length;i++)for(let j=i+1;j<g.length;j++){if(pairExplicitlyIncompatible(date,g[i],g[j]))invalid=true;}}
    if(invalid)continue; const singles=part.filter(g=>g.length===1).length,score=singles*100+part.length*10;
    if(score<bestScore){bestScore=score;best=part;}
  }
  const part=best||order.map(p=>[p]); const singles=part.filter(g=>g.length===1).flat(); const groups=part.filter(g=>g.length>=2).map(g=>{const sug=driverSuggestion(date,g);return{id:`auto-${groupCode(g)}`,members:canonical(g),driver:sug.candidates[0]||canonical(g)[0]};}); return {groups,singles,pending:false,unknown:[],rejected:state.rejected};
}
function proposalForDate(date){
  const saved=currentPlan(date);
  if(saved.length){
    const all=canonical(saved.flatMap(g=>g.members)); const state=globalCompatibilityState(date,all);
    return{groups:saved,singles:[],saved:true,pending:state.pending,unknown:state.unknown,rejected:state.rejected};
  }
  const auto=autoSuggestedGroups(date);return{...auto,saved:false};
}
function normalizedGroupSignature(groups){return groups.map(g=>`${canonical(g.members||g.participants||[]).join('|')}>${g.driver||g.driverId||''}`).sort().join('||');}
function validatedSummaryHTML(ds){
  const groups=tripGroupsForDate(ds); if(!groups.length)return '';
  const lines=groups.map((g,i)=>{const members=canonical(g.members||g.participants||[]),driver=g.driver||g.driverId,passengers=members.filter(p=>p!==driver);return `<div class="validated-line"><span>${groups.length>1?`<strong>Groupe ${i+1} · </strong>`:''}🚗 <strong>${label(driver)}</strong>${passengers.length?` · Passagers : ${passengers.map(label).join(', ')}`:''}</span></div>`;}).join('');
  return `<div class="validated-summary"><div class="validated-title">✓ Covoiturage validé</div>${lines}</div>`;
}
function renderQuickProposal(ds){
  const box=$('quickProposal'); if(!box)return; const proposal=proposalForDate(ds),gs=proposal.groups,validated=tripGroupsForDate(ds);
  if(!gs.length){box.innerHTML=validatedSummaryHTML(ds)||'<div class="empty compact-empty">Pas encore de groupe proposé.</div>';return;}
  const sameAsValidated=validated.length>0 && normalizedGroupSignature(gs)===normalizedGroupSignature(validated);
  const groupsHtml=gs.map((g,i)=>{
    const sug=driverSuggestion(ds,g.members),suggested=sug.candidates.length>1?`Égalité : ${sug.candidates.map(label).join(' / ')}`:`Suggéré : ${label(sug.candidates[0])}`;
    return `<div class="proposal-group-simple ${i?'with-separator':''}">
      <div class="proposal-main-line"><strong>${gs.length>1?`Groupe ${i+1} · `:''}${g.members.map(label).join(' · ')}</strong><span class="proposal-suggested">${suggested}</span></div>
      <div class="proposal-counter-line">Compteurs : ${canonical(g.members).map(p=>`${label(p)} ${sug.counts[p]}`).join(' · ')}</div>
      <div class="proposal-driver-row"><label>Conducteur réel</label><select class="quick-driver input" data-id="${g.id}">${canonical(g.members).map(p=>`<option value="${p}" ${g.driver===p?'selected':''}>${label(p)}</option>`).join('')}</select></div>
    </div>`;
  }).join('');
  const pendingHtml=proposal.pending?`<div class="proposal-pending"><strong>⏳ Répartition en attente</strong>${proposal.rejected?.length?`${proposal.rejected.map(x=>`${label(x.responder)} ne peut pas partir à ${x.time} avec ${label(x.owner)}`).join(' · ')}<br>`:''}${proposal.unknown.length} réponse(s) de compatibilité encore attendue(s). Aucun groupe n’est réparti automatiquement avant ces réponses.</div>`:'';
  box.innerHTML=`<div class="proposal-shell ${sameAsValidated?'is-validated':''}"><div class="proposal-head"><h3>Covoiturage proposé</h3>${proposal.saved?'<span class="small muted">modifié manuellement</span>':''}</div>${groupsHtml}${pendingHtml}${proposal.singles.length?`<div class="group-warning">Sans groupe : ${proposal.singles.map(label).join(', ')}</div>`:''}${validatedSummaryHTML(ds)}<div class="quick-actions"><button id="quickValidate" class="btn" ${(sameAsValidated||proposal.pending)?'disabled':''}>${proposal.pending?'En attente des réponses':sameAsValidated?'✓ Trajet validé':validated.length?'↻ Mettre à jour le trajet':`✓ Valider le${gs.length>1?'s':''} trajet${gs.length>1?'s':''}`}</button><button id="quickModify" class="btn secondary">Modifier</button></div>${IS_TEST&&validated.length?'<button id="quickResetTest" class="test-reset-link" type="button">↺ Réinitialiser ce trajet TEST</button>':''}<div id="quickSaveState" class="small muted quick-save-state"></div></div>`;
  box.querySelectorAll('.quick-driver').forEach(sel=>sel.addEventListener('change',()=>{
    const current=proposalForDate(ds).groups.map(g=>({...g})); const target=current.find(g=>g.id===sel.dataset.id)||current.find(g=>groupCode(g.members)===sel.dataset.id.replace('auto-','')); if(!target)return; target.driver=sel.value;
    const savePromise=savePlan(ds,current); const state=$('quickSaveState'); if(state)state.textContent='Enregistrement du conducteur…';
    savePromise.then(()=>{const st=$('quickSaveState');if(st)st.textContent='✓ Conducteur enregistré';}).catch(e=>alert(friendlyError(e)));
  }));
  const validateBtn=$('quickValidate'); if(validateBtn&&!sameAsValidated&&!proposal.pending)validateBtn.addEventListener('click',async()=>{validateBtn.disabled=true;validateBtn.textContent='Enregistrement…';const state=$('quickSaveState');if(state)state.textContent='Validation du covoiturage…';try{await validateGroupsForDate(ds,proposalForDate(ds).groups);renderTomorrow();}catch(e){alert(friendlyError(e));renderTomorrow();}});
  $('quickModify').addEventListener('click',()=>{$('groupDate').value=ds;openPage('groups');renderGroups();});
  const resetBtn=$('quickResetTest');if(resetBtn)resetBtn.addEventListener('click',()=>resetTestTrip(ds));
}

async function validateGroupsForDate(ds,groups){
  if(!groups.length)return;const overlap=groupsHaveOverlap(groups);if(overlap){alert(`${label(overlap)} apparaît dans plusieurs groupes.`);return;}for(const g of groups){if(g.members.length<2||!g.members.includes(g.driver)){alert('Un groupe est invalide.');return;}if(!isPastDate(ds)&&explicitIncompatibilities(ds,g.members).length){alert('Un groupe contient une incompatibilité horaire.');return;}}
  const existing=tripDays.get(ds),same=existing?.groups?.length&&normalizedGroupSignature(existing.groups)===normalizedGroupSignature(groups);if(existing?.groups?.length&&!same&&!confirm(`Des trajets sont déjà validés pour ${fmtDate(ds)}. Les remplacer ?`))return;
  const normalized=groups.map(g=>({id:g.id||crypto.randomUUID(),members:canonical(g.members),driver:g.driver,source:IS_TEST?'test':'app'})); const previousTrip=tripDays.get(ds),previousPlan=plans.get(ds);
  tripDays.set(ds,{date:ds,groups:normalized,source:IS_TEST?'test':'app',updatedBy:profileId}); plans.set(ds,{date:ds,groups:normalized,updatedBy:profileId}); if(activePage('tomorrow'))renderTomorrow(); if(activePage('groups')){renderGroups();renderValidatedInfo(ds);} if(activePage('history')){renderSummary();renderHistory();}
  try{await Promise.all([setDoc(doc(db,'tripDays',ds),{date:ds,groups:normalized,source:IS_TEST?'test':'app',updatedAt:serverTimestamp(),updatedBy:profileId}),setDoc(doc(db,'plans',ds),{date:ds,groups:normalized,validatedAt:serverTimestamp(),updatedAt:serverTimestamp(),updatedBy:profileId})]);toast('✓ Trajet enregistré');}
  catch(e){if(previousTrip)tripDays.set(ds,previousTrip);else tripDays.delete(ds);if(previousPlan)plans.set(ds,previousPlan);else plans.delete(ds);refreshForData('tripDays');refreshForData('plans');throw e;}
}

async function resetTestTrip(ds){
  if(!IS_TEST||linkedProfileId!=='igor')return;
  const previousTrip=tripDays.get(ds),previousPlan=plans.get(ds);
  tripDays.delete(ds);plans.delete(ds);
  if(activePage('tomorrow'))renderTomorrow();if(activePage('groups')){renderGroups();renderValidatedInfo(ds);}if(activePage('history')){renderSummary();renderHistory();}
  toast('🧪 Trajet TEST réinitialisé · enregistrement…');
  try{
    await Promise.all([deleteDoc(doc(db,'tripDays',ds)),deleteDoc(doc(db,'plans',ds))]);
    toast('✓ Prêt pour un nouveau test');
  }catch(e){
    if(previousTrip)tripDays.set(ds,previousTrip);
    if(previousPlan)plans.set(ds,previousPlan);
    refreshForData('tripDays');refreshForData('plans');alert(friendlyError(e));
  }
}

function counterSnapshotAfterTrip(t){
  const target=canonical(t.participants).join('|'),counts=Object.fromEntries(canonical(t.participants).map(p=>[p,0])); flattenTrips().filter(x=>x.date<=t.date&&canonical(x.participants).join('|')===target).sort((a,b)=>a.date.localeCompare(b.date)).forEach(x=>{if(x.driver in counts)counts[x.driver]++;}); return counts;
}
function qualityChecks(){
  const issues=[]; tripDays.forEach((day,date)=>{const seen=new Set(),codes=new Set();for(const g of day.groups||[]){const m=canonical(g.members||g.participants||[]),driver=g.driver||g.driverId;if(m.length<2)issues.push(`${date} : groupe de moins de 2 personnes`);if(!driver||!m.includes(driver))issues.push(`${date} : conducteur absent du groupe ${groupCode(m)}`);const code=m.join('|');if(codes.has(code))issues.push(`${date} : groupe ${groupCode(m)} enregistré deux fois`);codes.add(code);for(const p of m){if(seen.has(p))issues.push(`${date} : ${label(p)} apparaît dans plusieurs groupes`);seen.add(p);const av=getAvail(date,p);if(av&&(av.status==='absent'||av.status==='alone'))issues.push(`${date} : ${label(p)} est dans un trajet mais son statut est « ${statusMeta(av).label} »`);}}});return [...new Set(issues)];
}
function renderQualityChecks(){const items=qualityChecks(),box=$('qualityBox'),list=$('qualityList');if(!items.length){box.className='notice oknotice';list.innerHTML='✅ Tout est OK.';}else{box.className='notice';list.innerHTML=items.slice(0,30).map(x=>`<div>• ${x}</div>`).join('')+(items.length>30?`<div>… et ${items.length-30} autre(s)</div>`:'');}}

function renderCalendarExceptions(){
  const box=$('calendarExceptions');if(!box)return;const xs=[...(calendarConfig?.exceptions||[])].sort((a,b)=>a.date.localeCompare(b.date));box.innerHTML=xs.length?xs.map((x,i)=>`<div class="calendar-item"><strong>${x.date}</strong><span class="pill ${x.type==='off'?'absent':'present'}">${x.type==='off'?'Non travaillé':'Travaillé'}</span><span class="grow small muted">${x.note||''}</span><button class="btn danger smallbtn remove-calendar" data-i="${i}">Suppr.</button></div>`).join(''):'<div class="small muted">Aucune exception entreprise.</div>';box.querySelectorAll('.remove-calendar').forEach(b=>b.addEventListener('click',()=>removeCalendarException(Number(b.dataset.i))));
}
async function addCalendarException(){const date=$('calendarDate').value;if(!date){alert('Choisis une date.');return;}const type=$('calendarType').value,note=$('calendarNote').value.trim(),xs=[...(calendarConfig?.exceptions||[])].filter(x=>x.date!==date);xs.push({date,type,note});await setDoc(doc(db,'config','calendar'),{exceptions:xs,updatedAt:serverTimestamp()},{merge:true});$('calendarNote').value='';toast('Exception calendrier ajoutée.');}
async function removeCalendarException(i){const xs=[...(calendarConfig?.exceptions||[])];xs.splice(i,1);await setDoc(doc(db,'config','calendar'),{exceptions:xs,updatedAt:serverTimestamp()},{merge:true});toast('Exception supprimée.');}

const SNAPSHOT_COLLECTIONS=['profiles','availability','legacyStatus','compatibilities','plans','tripDays','preferences'];
async function exportTestSnapshot(){
  if(linkedProfileId!=='igor')return;const data={schema:1,exportedAt:new Date().toISOString(),collections:{},calendar:calendarConfig||{exceptions:[]}};for(const name of SNAPSHOT_COLLECTIONS){const snap=await getDocs(collection(db,name));data.collections[name]=snap.docs.map(d=>({id:d.id,data:d.data()}));}downloadJson(data,`Covoiturage_TEST_snapshot_${todayISO()}.json`);toast('Copie TEST exportée.');
}
function downloadJson(data,name){const blob=new Blob([JSON.stringify(data,(k,v)=>v?.toDate?v.toDate().toISOString():v,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function importTestSnapshot(){
  if(!IS_TEST||linkedProfileId!=='igor')return;const f=$('testSnapshotFile').files?.[0];if(!f){alert('Choisis le fichier de copie TEST.');return;}const payload=JSON.parse(await f.text());if(!confirm('Remplacer les données métier de la base TEST par cette copie ?'))return;
  for(const name of SNAPSHOT_COLLECTIONS){const old=await getDocs(collection(db,name));for(let i=0;i<old.docs.length;i+=400){const b=writeBatch(db);old.docs.slice(i,i+400).forEach(d=>b.delete(d.ref));await b.commit();}const recs=payload.collections?.[name]||[];for(let i=0;i<recs.length;i+=400){const b=writeBatch(db);recs.slice(i,i+400).forEach(r=>b.set(doc(db,name,r.id),r.data));await b.commit();}}
  await setDoc(doc(db,'config','calendar'),payload.calendar||{exceptions:[]});toast('Base TEST actualisée.');
}
async function installPwa(){
  if(installPrompt){installPrompt.prompt();await installPrompt.userChoice;installPrompt=null;$('installBtn').style.display='none';return;}
  const isiOS=/iphone|ipad|ipod/i.test(navigator.userAgent);if(isiOS)alert('Sur iPhone/iPad : Safari → bouton Partager → Ajouter à l’écran d’accueil.');else alert('Utilise le menu du navigateur puis “Installer l’application” ou “Ajouter à l’écran d’accueil”.');
}

window.addEventListener('online',()=>showConnectionAlert(''));
window.addEventListener('offline',()=>showConnectionAlert('Hors connexion'));
window.addEventListener('beforeunload',()=>unsubscribers.forEach(f=>f()));

start();
