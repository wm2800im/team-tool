import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const slice=(start,end)=>{
  const i=source.indexOf('function '+start+'('),j=source.indexOf(end,i);
  assert.ok(i>=0&&j>i,`${start} localisable`);
  return source.slice(i,j);
};
const names=['aurelien','etienne','igor','ludo','stephane'];
const canonical=people=>[...new Set(people)].sort((a,b)=>names.indexOf(a)-names.indexOf(b));

// Suggestion réelle de conducteur : compteurs du groupe complet, candidats avec voiture.
const driverSuggestionFactory=trips=>new Function('canonical','flattenTrips','lastDrivingDateBefore','groupCode',
  slice('driverSuggestion','async function addSelectedGroup(')+';return driverSuggestion;')(canonical,()=>trips,()=>'',m=>canonical(m).join(''));

test('Suggestion : la personne sans voiture est sautée mais garde son compteur',()=>{
  const members=['aurelien','etienne','stephane'];
  const suggest=driverSuggestionFactory([
    {date:'2026-11-02',participants:members,driver:'etienne'},
    {date:'2026-11-03',participants:members,driver:'stephane'}
  ]);
  const normal=suggest('2026-11-10',members);
  assert.deepEqual(normal.candidates,['aurelien']);
  const carless=suggest('2026-11-10',members,['etienne','stephane']);
  assert.equal(carless.counts.aurelien,0,'Le compteur d’Aurélien est inchangé : il redevient prioritaire au trajet suivant');
  assert.ok(!carless.candidates.includes('aurelien'));
});

function engine(status){
  const avail=Object.fromEntries(names.map(p=>[p,status[p]||{status:'absent'}]));
  const getAvail=(d,p)=>avail[p];
  const suggest=driverSuggestionFactory([]);
  const code=source.slice(source.indexOf('function pairExplicitlyIncompatible('),source.indexOf('function proposalForDate('));
  return new Function('PEOPLE','getAvail','getCompat','isAvailable','unknownCompatibilities','explicitIncompatibilities','canonical','driverSuggestion','groupCode','label',
    code+';return autoSuggestedGroups;')(names,getAvail,()=>null,v=>['present','time'].includes(v?.status),()=>[],()=>[],canonical,suggest,m=>canonical(m).join('-'),id=>id);
}

test('Répartition : le conducteur proposé a toujours une voiture',()=>{
  const out=engine({aurelien:{status:'present',noCar:true},etienne:{status:'present'},stephane:{status:'present'}})('2026-11-10');
  assert.equal(out.groups.length,1);
  assert.notEqual(out.groups[0].driver,'aurelien');
});

test('Répartition : jamais de groupe sans aucune voiture',()=>{
  const out=engine({aurelien:{status:'present',noCar:true},etienne:{status:'present',noCar:true},stephane:{status:'present'}})('2026-11-10');
  for(const g of out.groups)assert.ok(g.members.some(p=>p==='stephane'),'Chaque groupe contient une voiture');
  assert.equal(out.groups[0].driver,'stephane');
  assert.deepEqual(out.singles,[]);
});

test('Plan manuel : un conducteur sans voiture est remplacé, la composition est conservée',()=>{
  const avail={aurelien:{status:'present',noCar:true},etienne:{status:'present'},stephane:{status:'present'}};
  const saved=[{id:'manual',members:['aurelien','etienne','stephane'],driver:'aurelien'}];
  const proposalForDate=new Function('currentPlan','globalCompatibilityState','canonical','PEOPLE','isAvailable','getAvail','autoSuggestedGroups','savedPlanNeedsAvailabilityRefresh','updatedProposalFromSaved','driverSuggestion',
    slice('proposalForDate','function normalizedGroupSignature(')+';return proposalForDate;')(
    ()=>saved,()=>({pending:false,unknown:[],rejected:[]}),canonical,names,v=>['present','time'].includes(v?.status),(d,p)=>avail[p],
    ()=>{throw new Error('pas de recalcul automatique');},()=>false,()=>{throw new Error('pas de recalcul');},driverSuggestionFactory([]));
  const out=proposalForDate('2026-11-10');
  assert.equal(out.saved,true);
  assert.deepEqual(out.groups[0].members,['aurelien','etienne','stephane']);
  assert.notEqual(out.groups[0].driver,'aurelien');
  assert.equal(saved[0].driver,'aurelien','Le plan enregistré n’est pas modifié en mémoire');
});

test('Validation, choix manuel et Delle refusent un conducteur sans voiture',()=>{
  assert.match(source,/if\(!hasCar\(ds,driver\)\)throw new Error/);
  assert.match(source,/if\(newDriver!==\(group\?\.driver\|\|group\?\.driverId\)&&!hasCar\(ds,newDriver\)\)return false;/);
  assert.match(source,/il ne peut pas conduire jusqu’à Delle/);
  assert.match(source,/current\.find\(x=>x\.p===driver\)\?\.v\?\.noCar===true/);
});
