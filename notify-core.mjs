// Logique pure des rappels : testable sans Firebase (voir tests/notify-core.test.mjs).
export const TZ = 'Europe/Paris';
export const REMINDER_FIRST_HOUR = 20;
export const REMINDER_LAST_HOUR = 22;
export const PEOPLE = ['aurelien','etienne','igor','ludo','stephane'];
export const LABELS = {aurelien:'Aurélien',etienne:'Étienne',igor:'Igor',ludo:'Ludo',stephane:'Stéphane'};

export function localParts(now = new Date()){
  const parts = new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(now);
  const get=t=>parts.find(p=>p.type===t)?.value;
  return {year:+get('year'),month:+get('month'),day:+get('day'),hour:+get('hour')%24,minute:+get('minute')};
}
export function isoDate(y,m,d){return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;}
function dateFromISO(ds){const [y,m,d]=ds.split('-').map(Number); return new Date(Date.UTC(y,m-1,d,12));}
export function addDaysISO(ds,n){const d=dateFromISO(ds);d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);}
function easterSunday(year){
  const a=year%19,b=Math.floor(year/100),c=year%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451),month=Math.floor((h+l-7*m+114)/31),day=((h+l-7*m+114)%31)+1;
  return new Date(Date.UTC(year,month-1,day,12));
}
export function juraHolidaySet(year){
  const eiso=easterSunday(year).toISOString().slice(0,10);
  const dates=[`${year}-01-01`,`${year}-01-02`,`${year}-05-01`,`${year}-06-23`,`${year}-08-01`,`${year}-08-15`,`${year}-11-01`,`${year}-12-25`];
  [-2,1,39,50,60].forEach(n=>dates.push(addDaysISO(eiso,n)));
  return new Set(dates);
}
function isWeekendISO(ds){const d=dateFromISO(ds).getUTCDay();return d===0||d===6;}
export function isWorkingDay(ds,calendar){
  const ex=(calendar?.exceptions||[]).find(x=>x.date===ds)||null;
  if(ex?.type==='on')return true; if(ex?.type==='off')return false;
  return !isWeekendISO(ds) && !juraHolidaySet(+ds.slice(0,4)).has(ds);
}
export function frDate(ds){return new Intl.DateTimeFormat('fr-FR',{weekday:'long',day:'numeric',month:'long',timeZone:TZ}).format(dateFromISO(ds));}

// Fenêtre de rappel (heure de Paris) et date visée : le lendemain.
export function reminderWindow(now = new Date()){
  const p=localParts(now);
  const open=p.hour>=REMINDER_FIRST_HOUR&&p.hour<=REMINDER_LAST_HOUR;
  const today=isoDate(p.year,p.month,p.day);
  return {open,today,target:addDaysISO(today,1),clock:`${String(p.hour).padStart(2,'0')}:${String(p.minute).padStart(2,'0')}`};
}

// Décision pour une personne. marker = document notificationRuns existant (ou null).
export function reminderDecision({notificationsEnabled,status,marker}){
  if(notificationsEnabled!==true)return {action:'skip',reason:'rappel désactivé dans ses réglages'};
  if(status)return {action:'skip',reason:`statut déjà renseigné (${status})`};
  // Les anciens marqueurs sans statut sont considérés comme déjà envoyés.
  if(marker&&marker.status!=='retry')return {action:'skip',reason:'rappel déjà envoyé'};
  return {action:'send',reason:marker?'nouvel essai':'premier envoi'};
}
