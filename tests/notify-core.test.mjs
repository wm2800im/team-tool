import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {reminderDecision,reminderWindow,isWorkingDay} from '../notify-core.mjs';

test('Rappel : envoyé seulement si activé, non renseigné et pas déjà envoyé',()=>{
  assert.equal(reminderDecision({notificationsEnabled:true,status:null,marker:null}).action,'send');
  assert.equal(reminderDecision({notificationsEnabled:false,status:null,marker:null}).action,'skip');
  assert.equal(reminderDecision({notificationsEnabled:undefined,status:null,marker:null}).action,'skip');
  assert.equal(reminderDecision({notificationsEnabled:true,status:'present',marker:null}).action,'skip');
  assert.equal(reminderDecision({notificationsEnabled:true,status:null,marker:{status:'sent'}}).action,'skip');
  assert.equal(reminderDecision({notificationsEnabled:true,status:null,marker:{}}).action,'skip','Ancien marqueur sans statut = déjà envoyé');
  assert.equal(reminderDecision({notificationsEnabled:true,status:null,marker:{status:'retry'}}).action,'send');
});

test('Fenêtre : 20h00–22h59 à Paris, cible le lendemain (hiver et été)',()=>{
  assert.equal(reminderWindow(new Date('2026-11-24T18:59:00Z')).open,false,'19h59 hiver');
  assert.equal(reminderWindow(new Date('2026-11-24T19:00:00Z')).open,true,'20h00 hiver');
  assert.equal(reminderWindow(new Date('2026-11-24T21:59:00Z')).open,true,'22h59 hiver');
  assert.equal(reminderWindow(new Date('2026-11-24T22:00:00Z')).open,false,'23h00 hiver');
  assert.equal(reminderWindow(new Date('2026-07-07T18:00:00Z')).open,true,'20h00 été');
  assert.equal(reminderWindow(new Date('2026-07-07T21:00:00Z')).open,false,'23h00 été');
  assert.equal(reminderWindow(new Date('2026-11-24T19:30:00Z')).target,'2026-11-25');
  assert.equal(reminderWindow(new Date('2026-11-24T23:30:00Z')).target,'2026-11-26','Après minuit à Paris, la date avance');
});

test('Calendrier : week-end, fériés jurassiens et exceptions',()=>{
  assert.equal(isWorkingDay('2026-11-25',{}),true);
  assert.equal(isWorkingDay('2026-11-28',{}),false);
  assert.equal(isWorkingDay('2026-12-25',{}),false);
  assert.equal(isWorkingDay('2026-11-25',{exceptions:[{date:'2026-11-25',type:'off'}]}),false);
});

test('Planification : au moins 3 passages par heure de rappel, en hiver comme en été',()=>{
  const yml=readFileSync(new URL('../.github/workflows/notifications.yml',import.meta.url),'utf8');
  const crons=[...yml.matchAll(/cron:\s*'([^']+)'/g)].map(m=>m[1].split(/\s+/));
  assert.ok(crons.length>0);
  assert.ok(!/timezone:/.test(yml),'Heures exprimées en UTC, sans fuseau ambigu');
  const expand=f=>f.split(',').flatMap(p=>{const [a,b]=p.split('-').map(Number);return b==null?[a]:Array.from({length:b-a+1},(_,i)=>a+i);});
  const slots=crons.flatMap(([m,h])=>expand(h).flatMap(hh=>expand(m).map(mm=>({hh,mm}))));
  for(const offset of [1,2]){ // Paris = UTC+1 en hiver, UTC+2 en été
    for(const parisHour of [20,21,22]){
      const n=slots.filter(s=>s.hh===parisHour-offset).length;
      assert.ok(n>=3,`${parisHour}h Paris (UTC+${offset}) : ${n} passage(s)`);
    }
  }
  assert.ok(slots.every(s=>s.mm!==0),'Jamais à l’heure pile (heure la plus chargée chez GitHub)');
});
