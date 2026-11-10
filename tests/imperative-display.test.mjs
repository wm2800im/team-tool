import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
function extract(start,end) {
  const i=source.indexOf('function '+start+'(');
  const j=source.indexOf('function '+end+'(',i);
  assert.ok(i>=0&&j>i,'Fonctions de production conservées');
  return source.slice(i,j);
}
const people=['aurelien','etienne','igor','ludo','stephane'];
const names={aurelien:'Aurélien',etienne:'Étienne',igor:'Igor',ludo:'Ludo',stephane:'Stéphane'};
function fixture(aurelien='no',ludo=null) {
  const availability=Object.fromEntries(people.map(p=>[p,{status:p==='etienne'?'time':'present',time:p==='etienne'?'16:30':null}]));
  const answers={aurelien,igor:'yes',ludo,stephane:'yes'};
  const group={id:'manual',members:['etienne','igor','ludo','stephane'],driver:'etienne'};
  const inspect=(date,members)=>{
    const unknown=[],rejected=[];
    for (const owner of members) {
      if (availability[owner]?.status!=='time')continue;
      for (const responder of members) {
        if (owner===responder||!['time','present'].includes(availability[responder]?.status))continue;
        const row={owner,responder,time:availability[owner].time};
        if (answers[responder]==null)unknown.push(row);
        else if (answers[responder]==='no')rejected.push(row);
      }
    }
    return {unknown,rejected,pending:unknown.length>0};
  };
  // Ce test cible l'affichage des réponses ; le recalcul des plans périmés
  // est couvert séparément dans manual-plan-status.test.mjs.
  const factory=new Function('currentPlan','globalCompatibilityState','canonical','PEOPLE','isAvailable','getAvail','autoSuggestedGroups',
    'savedPlanNeedsAvailabilityRefresh','updatedProposalFromSaved',
    extract('proposalForDate','normalizedGroupSignature')+';return proposalForDate;');
  const proposal=factory(()=>[group],inspect,arr=>[...new Set(arr)].sort(),people,
    v=>['present','time'].includes(v?.status),(date,p)=>availability[p],
    ()=>({groups:[],singles:[],pending:false,unknown:[],rejected:[]}),
    ()=>false,()=>{throw new Error('Groupe manuel non périmé dans ce test');})('2026-11-06');
  return proposal;
}
const formatter=new Function('label','timeLabel',
  extract('imperativeNoticeHtml','renderQuickProposal')+';return imperativeNoticeHtml;')(id=>names[id],s=>s);
test('Groupe manuel : les refus hors groupe sont visibles, les attentes du groupe bloquent',()=>{
  const p=fixture('no',null);
  assert.equal(p.pending,true);
  assert.deepEqual(p.unknown.map(x=>x.responder),['ludo']);
  assert.deepEqual(p.rejected.map(x=>x.responder),['aurelien']);
  assert.deepEqual(p.groupRejected,[]);
  const html=formatter(p);
  assert.match(html,/Ludo doit répondre à Étienne · 16:30/);
  assert.match(html,/Aurélien · 16:30 refusé/);
  assert.doesNotMatch(html,/hors groupe|recalculée/);
});
test('Oui : réponse effacée du panneau, refus extérieur conservé, groupe validable',()=>{
  const p=fixture('no','yes');
  assert.equal(p.pending,false);
  assert.equal(p.unknown.length,0);
  assert.equal(p.rejected.length,1);
  assert.equal(p.groupRejected.length,0);
  assert.match(formatter(p),/Aurélien · 16:30 refusé/);
});
test('Non dans le groupe : refus affiché et incompatibilité locale détectée',()=>{
  const p=fixture('no','no');
  assert.equal(p.pending,false);
  assert.equal(p.groupRejected[0].responder,'ludo');
  assert.match(formatter(p),/Impératif incompatible/);
  assert.match(formatter(p),/Ludo · 16:30 refusé/);
});
test('Réponse extérieure encore inconnue : elle ne bloque pas le groupe manuel',()=>{
  const p=fixture(null,'yes');
  assert.equal(p.pending,false);
  assert.equal(p.unknown[0].responder,'aurelien');
  assert.match(formatter(p),/Aurélien doit répondre à Étienne · 16:30/);
});
test('Toutes les réponses Oui : aucun encart supplémentaire',()=>{
  const p=fixture('yes','yes');
  assert.equal(p.pending,false);
  assert.equal(formatter(p),'');
});
