import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js';
import {
  getAuth, signInAnonymously, onAuthStateChanged, setPersistence, browserLocalPersistence
} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js';
import {
  getFirestore, collection, doc, getDoc, getDocs, setDoc, deleteDoc, updateDoc, writeBatch,
  onSnapshot, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const PEOPLE = ['aurelien','etienne','igor','ludo','stephane'];
const LABELS = {aurelien:'Aurélien',etienne:'Étienne',igor:'Igor',ludo:'Ludo',stephane:'Stéphane'};
const INITIAL = {aurelien:'A',etienne:'E',igor:'I',ludo:'L',stephane:'S'};
const STATUS = {
  present:{label:'Présent',cls:'present'}, absent:{label:'Absent',cls:'absent'},
  alone:{label:'Seul',cls:'alone'}, time:{label:'Impératif',cls:'time'}, missing:{label:'Non renseigné',cls:'missing'}
};
const REVIEW_DEFAULT = [
  {date:'2020-07-10',reason:'notation historique ambiguë',raw:'I / S / A / E'},
  {date:'2021-06-10',reason:'code duo chevauche un groupe ≥3',raw:'SE+A+EA'},
  {date:'2022-07-07',reason:'code duo chevauche un groupe ≥3',raw:'EA'},
  {date:'2021-10/12',reason:'écart de compteur historique',raw:'Groupe Aurélien/Stéphane/Étienne/Ludo : +1 Ludo sans saisie journalière identifiable'}
];

let authUser = null;
let profileId = null;
let profiles = new Map();
let availability = new Map();
let legacyStatus = new Map();
let compatibilities = new Map();
let plans = new Map();
let tripDays = new Map();
let reviewItems = REVIEW_DEFAULT;
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
const nextCarpoolISO = () => {
  const n=appNowParts();
  let d=fromISO(appTodayISO());
  // Jusqu'à 08:59 inclus : le covoiturage courant reste celui d'aujourd'hui.
  // À partir de 09:00 : on passe au prochain jour ouvré.
  if(n.hour>=9) d=addDays(d,1);
  while(isWeekend(d)) d=addDays(d,1);
  return iso(d);
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
  $('identityName').textContent=label(profileId);
  if(profileId==='igor') $('adminNav').classList.remove('hidden');
  initStaticUI();
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
  profileId=pid;
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
    profileId=linkSnap.data().profileId;
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

function subscribeSharedData(){
  setLoading('Chargement des données…','Synchronisation de l’historique et des disponibilités.');
  const watch=(name,ref,handler)=>{
    const off=onSnapshot(ref,snap=>{
      handler(snap); initializedSnapshots.add(name);
      if(initializedSnapshots.size>=6){ hideLoading(); renderAll(); }
    },err=>{console.error(name,err);$('syncDot').classList.add('off');$('syncText').textContent='Erreur de synchronisation';});
    unsubscribers.push(off);
  };
  watch('profiles',collection(db,'profiles'),snap=>{ profiles=new Map(snap.docs.map(d=>[d.id,d.data()])); $('identityName').textContent=label(profileId); });
  watch('availability',collection(db,'availability'),snap=>{ availability=new Map(snap.docs.map(d=>[d.id,d.data()])); renderAll(); });
  watch('legacyStatus',collection(db,'legacyStatus'),snap=>{ legacyStatus=new Map(snap.docs.map(d=>[d.id,d.data()])); renderAll(); });
  watch('compatibilities',collection(db,'compatibilities'),snap=>{ compatibilities=new Map(snap.docs.map(d=>[d.id,d.data()])); renderAll(); });
  watch('plans',collection(db,'plans'),snap=>{ plans=new Map(snap.docs.map(d=>[d.id,d.data()])); renderAll(); });
  watch('tripDays',collection(db,'tripDays'),snap=>{ tripDays=new Map(snap.docs.map(d=>[d.id,d.data()])); renderAll(); });
  loadReviewConfig();
}
async function loadReviewConfig(){
  try{const s=await getDoc(doc(db,'config','app')); if(s.exists()&&Array.isArray(s.data().review)) reviewItems=s.data().review;}catch(e){}
}

function initStaticUI(){
  fillTimeSelect($('timeLimit'),'16:15'); fillTimeSelect($('rangeTime'),'16:15');
  const t=nextCarpoolISO(); $('groupDate').value=t; $('rangeStart').value=t; $('rangeEnd').value=iso(addDays(fromISO(t),4));
  qsa('#nav button[data-page]').forEach(b=>b.addEventListener('click',()=>openPage(b.dataset.page)));
  qsa('.status-btn').forEach(b=>b.addEventListener('click',()=>handleTomorrowStatus(b.dataset.status)));
  $('saveTime').addEventListener('click',()=>setAvailability(nextCarpoolISO(),'time',$('timeLimit').value));
  $('rangeStatus').addEventListener('change',()=>{$('rangeTimeField').style.display=$('rangeStatus').value==='time'?'flex':'none';});
  $('applyRange').addEventListener('click',applyRange);
  $('groupDate').addEventListener('change',renderGroups);
  $('addGroup').addEventListener('click',addSelectedGroup);
  $('validateTrips').addEventListener('click',validateTrips);
  $('summaryPeriod').addEventListener('change',renderSummary);
  $('historyFilter').addEventListener('input',renderHistory);
  $('exportHistory').addEventListener('click',exportHistoryCSV);
  $('installBtn').addEventListener('click',installPwa);
  if($('legacyImportFile')) $('legacyImportFile').addEventListener('change',()=>{
    const file=$('legacyImportFile').files?.[0];
    const btn=$('legacyImportButton');
    if(btn) btn.disabled=!file;
    const status=$('legacyImportStatus');
    if(status) status.textContent=file?`Fichier sélectionné : ${file.name}`:'Aucun import lancé.';
  });
  if($('legacyImportButton')) $('legacyImportButton').addEventListener('click',importLegacyStatusSelected);
  setInterval(()=>{ if($('tomorrow')?.classList.contains('active')) renderTomorrow(); },60000);
  window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;$('installBtn').style.display='inline-block';});
  if('serviceWorker' in navigator) navigator.serviceWorker.register('./service-worker.js').catch(console.warn);
}
function fillTimeSelect(sel,value='16:15'){
  sel.innerHTML='';
  for(let h=14;h<=20;h++) for(const m of [0,15,30,45]){
    if(h===20&&m>0)continue;
    const v=`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
    const o=document.createElement('option');o.value=v;o.textContent=v;sel.appendChild(o);
  }
  sel.value=value;
}
function openPage(page){
  qsa('.page').forEach(x=>x.classList.toggle('active',x.id===page));
  qsa('#nav button[data-page]').forEach(x=>x.classList.toggle('active',x.dataset.page===page));
  if(page==='groups')renderGroups(); if(page==='summary')renderSummary(); if(page==='history')renderHistory(); if(page==='admin')renderAdmin();
}

async function handleTomorrowStatus(st){
  if(st==='time'){
    const v=getAvail(nextCarpoolISO(),profileId); $('timeLimit').value=v?.time||'16:15'; $('timeBox').style.display='flex';
    return;
  }
  $('timeBox').style.display='none'; await setAvailability(nextCarpoolISO(),st,null);
}
async function setAvailability(date,status,time=null){
  try{
    await setDoc(doc(db,'availability',availKey(date,profileId)),{
      date,profileId,status,time:status==='time'?time:null,updatedAt:serverTimestamp(),updatedByUid:authUser.uid
    });
    toast(`${fmtDate(date,{weekday:'short',day:'numeric',month:'short'})} : ${statusMeta({status,time}).label}`);
  }catch(e){alert(friendlyError(e));}
}
async function clearAvailability(date){
  try{await deleteDoc(doc(db,'availability',availKey(date,profileId)));toast('Saisie supprimée.');}catch(e){alert(friendlyError(e));}
}

function renderAll(){
  if(!profileId||$('appShell').style.display==='none')return;
  renderTomorrow(); renderPlanning(); renderGroups(); renderSummary(); renderHistory();
}
function renderTomorrow(){
  const ds=nextCarpoolISO();
  $('tomorrowTitle').textContent=`Prochain — ${fmtDate(ds)}`;
  $('tomorrowSubtitle').textContent='Indique ton statut ; tu peux le modifier à tout moment.';
  const mine=getAvail(ds,profileId);
  qsa('.status-btn').forEach(b=>b.classList.toggle('selected',mine?.status===b.dataset.status));
  $('timeBox').style.display=mine?.status==='time'?'flex':'none'; if(mine?.status==='time')$('timeLimit').value=mine.time||'16:15';
  $('tomorrowSaved').textContent=mine?`Enregistré : ${statusMeta(mine).label}`:'Pas encore renseigné.';
  const box=$('collectiveTomorrow'); box.innerHTML=''; let answered=0;
  PEOPLE.forEach(p=>{
    const v=getAvail(ds,p); if(v)answered++; const m=statusMeta(v);
    const row=document.createElement('div');row.className='person-row';
    row.innerHTML=`<div class="avatar">${INITIAL[p]}</div><div class="grow"><strong>${label(p)}</strong></div><span class="pill ${m.cls}">${m.label}</span>`;
    box.appendChild(row);
  });
  const count=document.createElement('div');count.className='footer-note';count.textContent=`${answered}/5 réponses reçues`;box.appendChild(count);
  renderTimeCompatibility(ds,mine);
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
  const ownerV=getAvail(date,owner); if(ownerV?.status!=='time')return;
  try{
    await setDoc(doc(db,'compatibilities',compatKey(date,owner,profileId)),{
      date,ownerId:owner,responderId:profileId,response,ownerTime:ownerV.time,updatedAt:serverTimestamp()
    });
    toast(response==='yes'?'Compatibilité validée.':'Incompatibilité enregistrée.');
  }catch(e){alert(friendlyError(e));}
}

function workingDays(start,count){
  const out=[];let d=fromISO(start);while(out.length<count){if(d.getDay()!==0&&d.getDay()!==6)out.push(iso(d));d=addDays(d,1);}return out;
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
  while(d<=end){if(d.getDay()!==0&&d.getDay()!==6){const ds=iso(d);jobs.push(setDoc(doc(db,'availability',availKey(ds,profileId)),{date:ds,profileId,status:st,time:st==='time'?tm:null,updatedAt:serverTimestamp(),updatedByUid:authUser.uid}));n++;}d=addDays(d,1);}
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
  const out=[];tripDays.forEach((day,date)=>{(day.groups||[]).forEach((g,i)=>out.push({date,id:g.id||`${date}-${i}`,participants:g.members||g.participants||[],driver:g.driver||g.driverId,source:g.source||day.source||'v3'}));});return out;
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
  await setDoc(doc(db,'plans',date),{date,groups:groups.map(g=>({id:g.id||crypto.randomUUID(),members:canonical(g.members),driver:g.driver})),updatedAt:serverTimestamp(),updatedBy:profileId});
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
  const ds=$('groupDate').value,groups=currentPlan(ds);if(!groups.length)return;
  const overlap=groupsHaveOverlap(groups);if(overlap){alert(`${label(overlap)} apparaît dans plusieurs groupes. Corrige avant de valider.`);return;}
  for(const g of groups){if(g.members.length<2||!g.members.includes(g.driver)){alert('Un groupe est invalide.');return;}if(!isPastDate(ds)&&explicitIncompatibilities(ds,g.members).length){alert('Un groupe contient une incompatibilité horaire.');return;}}
  const existing=tripDays.get(ds);
  if(existing?.groups?.length && !confirm(`Des trajets sont déjà validés pour ${fmtDate(ds)}. La validation remplacera entièrement les groupes existants pour cette date. Continuer ?`))return;
  const normalized=groups.map(g=>({id:g.id||crypto.randomUUID(),members:canonical(g.members),driver:g.driver,source:'v3'}));
  try{
    await setDoc(doc(db,'tripDays',ds),{date:ds,groups:normalized,source:'v3',updatedAt:serverTimestamp(),updatedBy:profileId});
    await setDoc(doc(db,'plans',ds),{date:ds,groups:normalized,validatedAt:serverTimestamp(),updatedAt:serverTimestamp(),updatedBy:profileId});
    $('validationMessage').textContent=`${normalized.length} trajet(s) validé(s) pour ${fmtDate(ds)}.`;toast('Trajets validés.');
  }catch(e){alert(friendlyError(e));}
}
function renderValidatedInfo(ds){
  const groups=tripGroupsForDate(ds),box=$('validatedTodayInfo');
  if(!groups.length){box.innerHTML='';return;}
  box.innerHTML=`<div class="notice oknotice"><strong>${groups.length} trajet(s) déjà validé(s)</strong><div class="small">Valider de nouveau remplacera les groupes de cette date, ce qui évite les doublons.</div></div>`;
}
async function loadValidatedIntoPlan(date){
  const groups=tripGroupsForDate(date).map(g=>({id:g.id||crypto.randomUUID(),members:canonical(g.members||g.participants||[]),driver:g.driver||g.driverId}));
  if(groups.length)await savePlan(date,groups);
  $('groupDate').value=date;openPage('groups');renderGroups();
}
async function deleteHistoryGroup(date,id){
  const day=tripDays.get(date);if(!day)return;const groups=(day.groups||[]).filter(g=>(g.id||'')!==id);
  if(!confirm(`Supprimer ce trajet du ${fmtDate(date)} ?`))return;
  try{if(groups.length)await setDoc(doc(db,'tripDays',date),{...day,groups,updatedAt:serverTimestamp(),updatedBy:profileId});else await deleteDoc(doc(db,'tripDays',date));toast('Trajet supprimé.');}catch(e){alert(friendlyError(e));}
}

function periodMatch(date,period){if(period==='month')return date.startsWith(currentYM());if(period==='year')return date.startsWith(`${nowYear()}-`);return true;}
function renderSummary(){
  if(!$('summaryUser'))return;const period=$('summaryPeriod').value;$('summaryUser').textContent=label(profileId);
  let driver=0,passenger=0;const carpoolDates=new Set();
  flattenTrips().filter(t=>periodMatch(t.date,period)).forEach(t=>{if(t.participants.includes(profileId)){carpoolDates.add(t.date);if(t.driver===profileId)driver++;else passenger++;}});

  const current=[...availability.values()].filter(v=>v.profileId===profileId&&periodMatch(v.date,period));
  const currentByDate=new Map(current.map(v=>[v.date,v]));
  let present=0,alone=0,absent=0,time=0;
  current.forEach(v=>{if(v.status==='present')present++;else if(v.status==='time'){present++;time++;}else if(v.status==='alone')alone++;else if(v.status==='absent')absent++;});

  const legacy=[...legacyStatus.values()].filter(v=>v.profileId===profileId&&periodMatch(v.date,period)&&!currentByDate.has(v.date)&&!carpoolDates.has(v.date));
  let legacyAbsent=0,legacyAlone=0,legacyAmbiguous=0;
  legacy.forEach(v=>{if(v.legacyStatus==='absent')legacyAbsent++;else if(v.legacyStatus==='alone')legacyAlone++;else if(v.legacyStatus==='absent_or_alone')legacyAmbiguous++;});

  const trackedDates=new Set(carpoolDates);
  current.forEach(v=>trackedDates.add(v.date)); legacy.forEach(v=>trackedDates.add(v.date));
  const exactPresenceDates=new Set(carpoolDates);
  current.forEach(v=>{if(v.status==='present'||v.status==='time'||v.status==='alone')exactPresenceDates.add(v.date);});
  legacy.forEach(v=>{if(v.legacyStatus==='alone')exactPresenceDates.add(v.date);});

  $('kDriver').textContent=driver;$('kPassenger').textContent=passenger;$('kSaved').textContent=passenger;$('kCarpooled').textContent=carpoolDates.size;$('kPresent').textContent=trackedDates.size;
  $('statusStats').innerHTML=`
    <div class="person-row"><span class="grow">Présent renseigné (nouvelle appli)</span><strong>${present}</strong></div>
    <div class="person-row"><span class="grow">Seul (nouvelle appli)</span><strong>${alone}</strong></div>
    <div class="person-row"><span class="grow">Absent (nouvelle appli)</span><strong>${absent}</strong></div>
    <div class="person-row"><span class="grow">Avec impératif horaire</span><strong>${time}</strong></div>
    <div class="person-row"><span class="grow">Absent historique certain</span><strong>${legacyAbsent}</strong></div>
    <div class="person-row"><span class="grow">Seul historique certain</span><strong>${legacyAlone}</strong></div>
    <div class="person-row"><span class="grow">Absent ou seul (ancien Excel)</span><strong>${legacyAmbiguous}</strong></div>`;

  let rateText='';
  if(legacyAmbiguous===0){
    const rate=exactPresenceDates.size?Math.round((carpoolDates.size/exactPresenceDates.size)*100):0;
    rateText=`<p>Taux de covoiturage sur les jours de présence identifiables : <strong>${rate}%</strong>.</p>`;
  }else{
    rateText=`<p>Le taux historique exact n’est pas affiché : <strong>${legacyAmbiguous} jour(s)</strong> de l’ancien Excel sont codés « absent ou seul » et ne permettent pas de distinguer les deux situations.</p>`;
  }
  $('summaryNote').innerHTML=`<p><strong>${passenger} jour(s)</strong> où ta voiture n’a pas été utilisée grâce au covoiturage.</p>${rateText}<p><strong>${trackedDates.size} jour(s)</strong> disposent d’une information exploitable sur cette période (trajet ou statut). Les statuts historiques détaillés sont récupérés à partir de juin 2022 ; les trajets, eux, remontent à 2020.</p>`;
}
function renderHistory(){
  if(!$('historyList'))return;const all=flattenTrips().sort((a,b)=>b.date.localeCompare(a.date));$('historyCount').textContent=all.length;
  if(reviewItems?.length){$('reviewBox').style.display='block';$('reviewList').innerHTML=reviewItems.map(x=>`<div>• ${x.date} — ${x.raw||x.reason} <span class="muted">(${x.reason})</span></div>`).join('');}else $('reviewBox').style.display='none';
  const q=($('historyFilter').value||'').trim().toLowerCase();let ts=all;
  if(q)ts=ts.filter(t=>`${t.date} ${groupCode(t.participants)} ${canonical(t.participants).map(label).join(' ')} ${label(t.driver)}`.toLowerCase().includes(q));
  ts=ts.slice(0,300);
  $('historyList').innerHTML=ts.map(t=>`<div class="hist-row"><div>${t.date}</div><div><strong>${groupCode(t.participants)}</strong> · ${canonical(t.participants).map(label).join(', ')}</div><div class="driver">🚗 ${label(t.driver)}</div><div class="hist-actions"><button class="btn secondary smallbtn edit-trip" data-date="${t.date}">Modifier</button><button class="btn danger smallbtn delete-trip" data-date="${t.date}" data-id="${t.id}">Suppr.</button></div></div>`).join('')||'<div class="empty">Aucun résultat.</div>';
  $('historyList').querySelectorAll('.edit-trip').forEach(b=>b.addEventListener('click',()=>loadValidatedIntoPlan(b.dataset.date)));
  $('historyList').querySelectorAll('.delete-trip').forEach(b=>b.addEventListener('click',()=>deleteHistoryGroup(b.dataset.date,b.dataset.id)));
}
function exportHistoryCSV(){
  const rows=[['Date','Groupe','Participants','Conducteur','Source']];
  flattenTrips().sort((a,b)=>a.date.localeCompare(b.date)).forEach(t=>rows.push([t.date,groupCode(t.participants),canonical(t.participants).map(label).join(' + '),label(t.driver),t.source||'']));
  const esc=v=>`"${String(v??'').replaceAll('"','""')}"`;const csv='\ufeff'+rows.map(r=>r.map(esc).join(';')).join('\r\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`Historique_Covoiturage_${iso(new Date())}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Historique exporté.');
}

async function renderAdmin(){
  if(profileId!=='igor')return;
  $('inviteList').innerHTML='<div class="muted">Chargement…</div>';$('deviceList').innerHTML='<div class="muted">Chargement…</div>';
  try{
    const [invSnap,devSnap]=await Promise.all([getDocs(collection(db,'invitations')),getDocs(collection(db,'deviceLinks'))]);
    const invs=invSnap.docs.map(d=>({token:d.id,...d.data()}));
    $('inviteList').innerHTML='';
    PEOPLE.forEach(pid=>{
      const active=invs.filter(x=>x.profileId===pid&&x.active===true).sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0))[0];
      const div=document.createElement('div');div.className='admin-item';
      if(active){const url=`${baseAppUrl()}?invite=${active.token}`;div.innerHTML=`<strong>${label(pid)}</strong><div class="linkbox">${url}</div><div class="row"><button class="btn secondary smallbtn copy-invite" data-url="${url}">Copier le lien</button><button class="btn danger smallbtn regen-invite" data-pid="${pid}">Régénérer</button></div>`;}
      else div.innerHTML=`<strong>${label(pid)}</strong><div class="small muted">Aucun lien actif.</div><button class="btn secondary smallbtn regen-invite" data-pid="${pid}">Créer un lien</button>`;
      $('inviteList').appendChild(div);
    });
    $('inviteList').querySelectorAll('.copy-invite').forEach(b=>b.addEventListener('click',async()=>{await navigator.clipboard.writeText(b.dataset.url);toast('Lien copié.');}));
    $('inviteList').querySelectorAll('.regen-invite').forEach(b=>b.addEventListener('click',()=>regenerateInvite(b.dataset.pid,invs)));
    const devices=devSnap.docs.map(d=>({uid:d.id,...d.data()}));$('deviceList').innerHTML='';
    if(!devices.length)$('deviceList').innerHTML='<div class="empty">Aucun appareil.</div>';
    devices.sort((a,b)=>label(a.profileId).localeCompare(label(b.profileId),'fr')).forEach(x=>{
      const div=document.createElement('div');div.className='admin-item';const isCurrent=x.uid===authUser.uid;
      div.innerHTML=`<div class="row"><strong class="grow">${label(x.profileId)}${isCurrent?' · cet appareil':''}</strong><button class="btn danger smallbtn revoke-device" data-uid="${x.uid}">Révoquer</button></div><div class="small muted">ID : ${x.uid.slice(0,10)}…</div>`;$('deviceList').appendChild(div);
    });
    $('deviceList').querySelectorAll('.revoke-device').forEach(b=>b.addEventListener('click',()=>revokeDevice(b.dataset.uid)));
  }catch(e){$('inviteList').innerHTML=`<div class="notice danger">${friendlyError(e)}</div>`;$('deviceList').innerHTML='';}
}
async function importLegacyStatusSelected(){
  if(profileId!=='igor')return;
  const input=$('legacyImportFile');
  const file=input?.files?.[0];
  if(!file){ alert('Choisis d’abord le fichier JSON à importer.'); return; }
  try{
    const payload=JSON.parse(await file.text());
    const records=Array.isArray(payload)?payload:payload.records;
    if(!Array.isArray(records)||!records.length) throw new Error('Fichier sans enregistrements.');
    if(!confirm(`Importer ${records.length} statuts historiques dans la base commune ? Les documents portant le même identifiant seront remplacés.`)) return;
    const status=$('legacyImportStatus'); if(status)status.textContent='Import en cours…';
    let done=0;
    for(let i=0;i<records.length;i+=400){
      const batch=writeBatch(db);
      records.slice(i,i+400).forEach(r=>{
        if(!r.date||!r.profileId||!r.legacyStatus)return;
        const id=legacyKey(r.date,r.profileId);
        batch.set(doc(db,'legacyStatus',id),{date:r.date,profileId:r.profileId,legacyStatus:r.legacyStatus,code:r.code??null,source:r.source||'ancien Excel',importedAt:serverTimestamp()});
      });
      await batch.commit(); done=Math.min(i+400,records.length); if(status)status.textContent=`${done}/${records.length} importés…`;
    }
    if(status)status.textContent=`Import terminé : ${records.length} statuts historiques.`;
    toast('Statuts historiques importés.');
  }catch(e){console.error(e);alert(`Import impossible : ${friendlyError(e)}`);}finally{
    if(input) input.value='';
    const btn=$('legacyImportButton'); if(btn) btn.disabled=true;
  }
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

async function installPwa(){
  if(installPrompt){installPrompt.prompt();await installPrompt.userChoice;installPrompt=null;$('installBtn').style.display='none';return;}
  const isiOS=/iphone|ipad|ipod/i.test(navigator.userAgent);if(isiOS)alert('Sur iPhone/iPad : Safari → bouton Partager → Ajouter à l’écran d’accueil.');else alert('Utilise le menu du navigateur puis “Installer l’application” ou “Ajouter à l’écran d’accueil”.');
}

window.addEventListener('online',()=>{$('syncDot')?.classList.remove('off');if($('syncText'))$('syncText').textContent='Base commune';});
window.addEventListener('offline',()=>{$('syncDot')?.classList.add('off');if($('syncText'))$('syncText').textContent='Hors ligne';});
window.addEventListener('beforeunload',()=>unsubscribers.forEach(f=>f()));

start();
