import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const begin=source.indexOf('function pairExplicitlyIncompatible(');
const end=source.indexOf('function proposalForDate(',begin);
assert.ok(begin>0&&end>begin,'Le moteur automatique est localisable');
const engine=source.slice(begin,end);
const names=['aurelien','etienne','igor','ludo','stephane'];
function setup({imperatives={},answers={},present=names}={}){
  const available=Object.fromEntries(names.map(p=>[p,present.includes(p)?{status:imperatives[p]?'time':'present',time:imperatives[p]||null}:{status:'absent'}]));
  const getAvail=(date,p)=>available[p];
  const getCompat=(date,owner,responder)=>answers[owner+':'+responder]?
    {ownerTime:imperatives[owner],response:answers[owner+':'+responder]}:null;
  function inspect(date,people){
    const unknown=[],rejected=[];
    for(const owner of people){
      if(available[owner]?.status!=='time')continue;
      for(const responder of people){
        if(owner===responder||!['present','time'].includes(available[responder]?.status))continue;
        const c=getCompat(date,owner,responder),row={owner,responder,time:imperatives[owner]};
        if(!c||c.ownerTime!==imperatives[owner])unknown.push(row);
        else if(c.response==='no')rejected.push(row);
      }
    }
    return {unknown,rejected};
  }
  const canonical=people=>[...people].sort((a,b)=>names.indexOf(a)-names.indexOf(b));
  const [auto,pending]=new Function('PEOPLE','getAvail','getCompat','isAvailable','unknownCompatibilities','explicitIncompatibilities','canonical','driverSuggestion','groupCode','label',
    engine+';return [autoSuggestedGroups,pendingConfirmedGroups];')(
    names,getAvail,getCompat,v=>['present','time'].includes(v?.status),
    (date,p)=>inspect(date,p).unknown,(date,p)=>inspect(date,p).rejected,
    canonical,(date,members)=>({candidates:[members[0]]}),m=>canonical(m).join('-'),id=>id);
  return {auto:()=>auto('2026-11-10'),pending:()=>pending('2026-11-10',present)};
}
const members=g=>g.groups.map(g=>g.members.slice().sort().join(',')).sort();
test('Cas utilisateur : les quatre Oui 16:30 forment un groupe, Ludo reste seul',()=>{
 const fx=setup({imperatives:{aurelien:'16:30'},answers:{
  'aurelien:etienne':'yes','aurelien:igor':'yes','aurelien:ludo':'no','aurelien:stephane':'yes'}});
 const out=fx.auto();
 assert.equal(out.pending,false);
 assert.deepEqual(members(out),[['aurelien','etienne','igor','stephane'].sort().join(',')]);
 assert.deepEqual(out.singles,['ludo']);
 assert.deepEqual(out.rejected.map(x=>x.responder),['ludo']);
});
test('Ludo change Non en Oui : les cinq sont automatiquement réunis',()=>{
 const fx=setup({imperatives:{aurelien:'16:30'},answers:Object.fromEntries(['etienne','igor','ludo','stephane'].map(p=>['aurelien:'+p,'yes']))});
 const out=fx.auto();
 assert.deepEqual(members(out),[names.slice().sort().join(',')]);
 assert.deepEqual(out.singles,[]);
});
test('Ludo sans réponse : les quatre Oui restent ensemble dans le groupe provisoire',()=>{
 const fx=setup({imperatives:{aurelien:'16:30'},answers:{
  'aurelien:etienne':'yes','aurelien:igor':'yes','aurelien:stephane':'yes'}});
 const out=fx.auto();
 assert.equal(out.pending,true);
 assert.deepEqual(members(out),[['aurelien','etienne','igor','stephane'].sort().join(',')]);
 assert.deepEqual(out.singles,['ludo']);
});
test('Deux impératifs différents : deux groupes respectent chacun leurs réponses Oui',()=>{
 const fx=setup({imperatives:{aurelien:'16:30',ludo:'18:00'},answers:{
  'aurelien:etienne':'yes','aurelien:igor':'yes','aurelien:ludo':'no','aurelien:stephane':'no',
  'ludo:aurelien':'no','ludo:etienne':'no','ludo:igor':'no','ludo:stephane':'yes'}});
 const out=fx.auto();
 assert.deepEqual(members(out),[['aurelien','etienne','igor'].sort().join(','),['ludo','stephane'].sort().join(',')].sort());
 assert.deepEqual(out.singles,[]);
});
test('Réponses incompatibles : un refus explicite prime sur un Oui contradictoire',()=>{
 const fx=setup({imperatives:{aurelien:'16:30',etienne:'18:00'},present:['aurelien','etienne'],
 answers:{'aurelien:etienne':'yes','etienne:aurelien':'no'}});
 const out=fx.auto();
 assert.deepEqual(out.groups,[]);
 assert.deepEqual(out.singles,['aurelien','etienne']);
});
test('Sans impératif, la répartition habituelle minimise les personnes seules',()=>{
 const fx=setup();
 const out=fx.auto();
 assert.deepEqual(members(out),[names.slice().sort().join(',')]);
 assert.deepEqual(out.singles,[]);
});
