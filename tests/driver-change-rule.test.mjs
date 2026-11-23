import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const i=source.indexOf('function driverChangeRule('),j=source.indexOf('function canChangeDriver(',i);
assert.ok(i>=0&&j>i,'Règle du conducteur accessible');
const driverChangeRule=new Function(source.slice(i,j)+';return driverChangeRule;')();

const group={id:'g1',members:['aurelien','etienne','stephane'],driver:'aurelien'};

test('Avant 7h : Étienne ne peut pas désigner Stéphane à la place d’Aurélien',()=>{
  assert.equal(driverChangeRule(group,'stephane','etienne',false),false);
});
test('Avant 7h : Étienne peut se désigner lui-même conducteur',()=>{
  assert.equal(driverChangeRule(group,'etienne','etienne',false),true);
});
test('Avant 7h : personne ne peut remettre Aurélien à la place d’Étienne, sauf Aurélien',()=>{
  const g={...group,driver:'etienne'};
  assert.equal(driverChangeRule(g,'aurelien','stephane',false),false);
  assert.equal(driverChangeRule(g,'aurelien','aurelien',false),true);
});
test('Avant 7h : un membre hors du groupe ne peut rien changer',()=>{
  assert.equal(driverChangeRule(group,'stephane','igor',false),false);
  assert.equal(driverChangeRule(group,'igor','igor',false),false);
});
test('Le conducteur actuel reste toujours sélectionnable',()=>{
  assert.equal(driverChangeRule(group,'aurelien','etienne',false),true);
});
test('À partir de 7h (ou date passée) : changement libre parmi les membres',()=>{
  assert.equal(driverChangeRule(group,'stephane','etienne',true),true);
  assert.equal(driverChangeRule(group,'igor','etienne',true),false);
});
