import test from 'node:test';
import assert from 'node:assert/strict';
import {
  historyLiveStartFor,
  makeArchiveBaseline,
  splitBaselineParts,
  combineBaselineParts,
  isValidBaseline,
  selectFreshBaseline,
  applyArchiveBaseline,
  replaceLiveEntries,
  encodedBytes
} from '../quota-core.mjs';

const TEST_CUTOFF='2026-09-01';
const d=(id,data)=>({id,data});
const maps=()=>({tripDays:new Map(),availability:new Map(),legacyStatus:new Map(),plans:new Map()});
const canonical=x=>[...x].sort();
const tripsFrom=tripDays=>{
  const out=[];
  for(const [date,day] of tripDays) for(const g of day.groups||[]) out.push({date,members:canonical(g.members||g.participants||[]),driver:g.driver||g.driverId});
  return out;
};
const groupCounts=(trips,members,before='9999-12-31')=>{
  const key=canonical(members).join('|'),counts=Object.fromEntries(members.map(p=>[p,0]));
  for(const t of trips) if(t.date<before&&canonical(t.members).join('|')===key&&t.driver in counts) counts[t.driver]++;
  return counts;
};

test('live window rolls on the first day of each month',()=>{
  assert.equal(historyLiveStartFor(new Date(2026,8,16,12)),'2026-09-01');
  assert.equal(historyLiveStartFor(new Date(2026,8,30,23,59)),'2026-09-01');
  assert.equal(historyLiveStartFor(new Date(2026,9,1,0,1)),'2026-10-01');
});

test('archive boundary',()=>{
  const b=makeArchiveBaseline({liveStart:TEST_CUTOFF,generation:'g1',generatedAtMs:1,
    tripDaysDocs:[d('2026-08-31',{groups:[{id:'a',members:['ludo','igor'],driver:'igor'}]}),d('2026-09-01',{groups:[]})],
    availabilityDocs:[d('2026-08-31_igor',{date:'2026-08-31',profileId:'igor',status:'present'}),d('2026-09-01_igor',{date:'2026-09-01',profileId:'igor',status:'present'})]
  });
  assert.equal(b.liveStart,TEST_CUTOFF);
  assert.equal(b.tripDays.length,1);
  assert.equal(b.availability.length,1);
});

test('round trip keeps useful history data',()=>{
  const b=makeArchiveBaseline({liveStart:TEST_CUTOFF,generation:'g2',generatedAtMs:2,
    tripDaysDocs:[d('2026-08-29',{source:'repair',groups:[{id:'g1',participants:['ludo','igor'],driverId:'ludo'}]})],
    availabilityDocs:[d('2026-08-29_igor',{date:'2026-08-29',profileId:'igor',status:'time',time:'16:15'})],
    legacyStatusDocs:[d('2026-08-28_ludo',{date:'2026-08-28',profileId:'ludo',status:'alone'})],
    plansDocs:[d('2026-08-29',{date:'2026-08-29',groups:[{id:'g1',participants:['igor','ludo'],driverId:'ludo'}]})]
  });
  const rebuilt=combineBaselineParts(splitBaselineParts(b),TEST_CUTOFF);
  assert.equal(isValidBaseline(rebuilt,TEST_CUTOFF),true);
  const target=maps();
  applyArchiveBaseline(rebuilt,target);
  assert.deepEqual(target.tripDays.get('2026-08-29').groups[0].members,['igor','ludo']);
  assert.equal(target.tripDays.get('2026-08-29').groups[0].driver,'ludo');
  assert.equal(target.tripDays.get('2026-08-29').groups[0].source,'repair');
  assert.equal(target.availability.get('2026-08-29_igor').time,'16:15');
  assert.equal(target.legacyStatus.get('2026-08-28_ludo').status,'alone');
  assert.equal(target.plans.get('2026-08-29').groups[0].driver,'ludo');
});

test('live range replacement preserves archive keys',()=>{
  const m=new Map([['2026-08-31_igor',{v:'archive'}],['2026-09-01_igor',{v:'old'}],['2026-09-02_igor',{v:'stale'}]]);
  replaceLiveEntries(m,[['2026-09-01_igor',{v:'fresh'}],['2026-09-03_igor',{v:'new'}]],TEST_CUTOFF);
  assert.equal(m.get('2026-08-31_igor').v,'archive');
  assert.equal(m.get('2026-09-01_igor').v,'fresh');
  assert.equal(m.has('2026-09-02_igor'),false);
  assert.equal(m.get('2026-09-03_igor').v,'new');
});

test('generation mismatch is rejected',()=>{
  const parts=splitBaselineParts(makeArchiveBaseline({liveStart:TEST_CUTOFF,generation:'g3',generatedAtMs:3}));
  parts.plans={...parts.plans,generation:'other'};
  assert.throws(()=>combineBaselineParts(parts,TEST_CUTOFF),/Génération incohérente/);
});

test('first launch can immediately reuse a freshly built local baseline',()=>{
  const local=makeArchiveBaseline({liveStart:TEST_CUTOFF,generation:'local-first',generatedAtMs:100});
  assert.equal(selectFreshBaseline(local,null,0,TEST_CUTOFF)?.generation,'local-first');
});

test('a dirty marker newer than local baseline forces a rebuild',()=>{
  const local=makeArchiveBaseline({liveStart:TEST_CUTOFF,generation:'local-stale',generatedAtMs:100});
  assert.equal(selectFreshBaseline(local,null,101,TEST_CUTOFF),null);
});

test('newer server baseline wins over older local cache',()=>{
  const local=makeArchiveBaseline({liveStart:TEST_CUTOFF,generation:'local-old',generatedAtMs:100});
  const server=makeArchiveBaseline({liveStart:TEST_CUTOFF,generation:'server-new',generatedAtMs:120});
  assert.equal(selectFreshBaseline(local,server,0,TEST_CUTOFF)?.generation,'server-new');
});

test('historical rebuild replaces an old driver cleanly',()=>{
  const first=makeArchiveBaseline({liveStart:TEST_CUTOFF,generation:'g4',generatedAtMs:4,tripDaysDocs:[d('2026-08-25',{groups:[{id:'g',members:['igor','ludo'],driver:'igor'}]})]});
  const second=makeArchiveBaseline({liveStart:TEST_CUTOFF,generation:'g5',generatedAtMs:5,tripDaysDocs:[d('2026-08-25',{groups:[{id:'g',members:['igor','ludo'],driver:'ludo'}]})]});
  const target=maps();
  applyArchiveBaseline(first,target);
  assert.equal(target.tripDays.get('2026-08-25').groups[0].driver,'igor');
  applyArchiveBaseline(second,target);
  assert.equal(target.tripDays.get('2026-08-25').groups[0].driver,'ludo');
});

test('driver counters are identical before and after archive/live split',()=>{
  const raw=[
    d('2026-08-25',{groups:[{id:'a',members:['igor','ludo'],driver:'igor'}]}),
    d('2026-08-28',{groups:[{id:'b',members:['ludo','igor'],driver:'ludo'}]}),
    d('2026-09-02',{groups:[{id:'c',members:['igor','ludo'],driver:'igor'}]}),
    d('2026-09-03',{groups:[{id:'d',members:['igor','ludo','stephane'],driver:'stephane'}]})
  ];
  const expectedMap=new Map(raw.map(x=>[x.id,x.data]));
  const baseline=makeArchiveBaseline({liveStart:TEST_CUTOFF,generation:'counts',generatedAtMs:7,tripDaysDocs:raw});
  const target=maps();applyArchiveBaseline(baseline,target);
  replaceLiveEntries(target.tripDays,raw.filter(x=>x.id>=TEST_CUTOFF).map(x=>[x.id,x.data]),TEST_CUTOFF);
  assert.deepEqual(groupCounts(tripsFrom(target.tripDays),['igor','ludo'],'2026-09-04'),groupCounts(tripsFrom(expectedMap),['igor','ludo'],'2026-09-04'));
  assert.deepEqual(groupCounts(tripsFrom(target.tripDays),['igor','ludo','stephane'],'2026-09-04'),groupCounts(tripsFrom(expectedMap),['igor','ludo','stephane'],'2026-09-04'));
});

test('compact Firestore parts stay comfortably below document size in a large fixture',()=>{
  const tripDaysDocs=[],availabilityDocs=[],legacyStatusDocs=[],plansDocs=[];
  const people=['aurelien','etienne','igor','ludo','stephane'];
  for(let i=0;i<900;i++){
    const dt=new Date(Date.UTC(2022,0,3+i));
    const ds=dt.toISOString().slice(0,10);
    if(ds>=TEST_CUTOFF)break;
    tripDaysDocs.push(d(ds,{groups:[{id:`g${i}`,members:people,driver:people[i%5]}]}));
    plansDocs.push(d(ds,{date:ds,groups:[{id:`g${i}`,members:people,driver:people[i%5]}]}));
    for(const p of people){
      availabilityDocs.push(d(`${ds}_${p}`,{date:ds,profileId:p,status:i%7===0?'alone':'present'}));
      legacyStatusDocs.push(d(`${ds}_${p}`,{date:ds,profileId:p,status:i%11===0?'alone':'absent'}));
    }
  }
  const parts=splitBaselineParts(makeArchiveBaseline({liveStart:TEST_CUTOFF,generation:'big',generatedAtMs:6,tripDaysDocs,availabilityDocs,legacyStatusDocs,plansDocs}));
  for(const part of Object.values(parts)) assert.ok(encodedBytes(part)<800000);
});
