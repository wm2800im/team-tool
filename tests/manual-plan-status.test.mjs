import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
function extract(start,end){
  const i=source.indexOf('function '+start+'('),j=source.indexOf('function '+end+'(',i);
  assert.ok(i>=0&&j>i,'Fonctions métier accessibles');
  return source.slice(i,j);
}
const business=extract('recordUpdateMillis','explicitIncompatibilities')+extract('proposalForDate','normalizedGroupSignature');
const PEOPLE=['aurelien','etienne','igor','ludo','stephane'];
function fixture({status,updated={},planUpdated=1000,manual=[{id:'manual',members:['etienne','igor','ludo','stephane'],driver:'stephane'}],today='2026-11-11'}){
  const availability=new Map(Object.entries(status).map(([p,s])=>[p,{status:s,updatedAt:{toMillis:()=>updated[p]||500}}]));
  const plans=new Map([['2026-11-11',{groups:manual,updatedAt:{toMillis:()=>planUpdated}}]]);
  const autoSuggestedGroups=()=> {
    const members=PEOPLE.filter(p=>['present','time'].includes(availability.get(p)?.status));
    return {groups:members.length>1?[{id:'auto',members,driver:'etienne'}]:[],singles:members.length===1?members:[],pending:false,unknown:[],rejected:[]};
  };
  const exec=new Function('PEOPLE','isAvailable','getAvail','plans','isPastDate','currentPlan','autoSuggestedGroups','canonical','globalCompatibilityState',business+';return {proposalForDate,displayedPlan};');
  return exec(PEOPLE,v=>['present','time'].includes(v?.status),(_,p)=>availability.get(p),plans,d=>d<today,d=>plans.get(d)?.groups||[],autoSuggestedGroups,a=>a,()=>({pending:false,unknown:[],rejected:[]}));
}
const base={aurelien:'present',etienne:'present',igor:'present',ludo:'present',stephane:'present'};
test('11 novembre : Ludo seul sort, Aurélien présent entre, Stéphane reste conducteur',()=>{
 const x=fixture({status:{...base,ludo:'alone'}});const proposed=x.proposalForDate('2026-11-11');
 assert.equal(proposed.saved,false);
 assert.deepEqual(proposed.groups[0].members,['aurelien','etienne','igor','stephane']);
 assert.equal(proposed.groups[0].driver,'stephane');
 assert.deepEqual(x.displayedPlan('2026-11-11'),proposed.groups);
});
test('Absent : le groupe manuel périmé est abandonné',()=>{
 const x=fixture({status:{...base,ludo:'absent'}});
 assert.equal(x.proposalForDate('2026-11-11').groups[0].members.includes('ludo'),false);
});
test('Manuel cohérent : composition et conducteur conservés',()=>{
 const x=fixture({status:base});
 const p=x.proposalForDate('2026-11-11');
 assert.equal(p.saved,true);
 assert.deepEqual(p.groups[0].members,['etienne','igor','ludo','stephane']);
 assert.equal(p.groups[0].driver,'stephane');
});
test('Nouvelle disponibilité après le plan : une personne redevenue présente est prise en compte',()=>{
 const x=fixture({status:base,updated:{aurelien:2000}});
 assert.equal(x.proposalForDate('2026-11-11').saved,false);
});
test('Saisie historique : les groupes réels restent modifiables malgré les statuts',()=>{
 const x=fixture({status:{...base,ludo:'alone'},today:'2026-11-12'});
 assert.equal(x.proposalForDate('2026-11-11').saved,true);
});
test('Validation : contrôle serveur des statuts et impératifs avant écriture',()=>{
 assert.match(source,/getDocFromServer\(doc\(db,'availability',availKey\(date,p\)\)\)/);
 assert.match(source,/await assertLiveGroupStatus\(ds,members\)/);
 assert.match(source,/for\(const g of groups\)await assertLiveGroupStatus\(ds,g.members\)/);
});
