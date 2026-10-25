import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { furnitureKind, updateGazeScale } from '../public/js/furniture-gaze.js';
import { EFFECT_STRENGTH } from '../public/js/profiles.js';

test('chairs grow more than tables, only the looked-at object grows, and looking away restores its rest scale', () => {
  const make = kind => ({ kind, group: new THREE.Group(), target: { value: 1 } });
  const chair = make('chair'), table = make('table'), idle = make('chair'); chair.group.scale.set(2, 2, 2);
  for (let frame = 0; frame < 300; frame++) {
    updateGazeScale(chair, { hitObject: chair }, 1, EFFECT_STRENGTH, 1/60);
    updateGazeScale(table, { hitObject: table }, 1, EFFECT_STRENGTH, 1/60);
    updateGazeScale(idle, { hitObject: chair }, 1, EFFECT_STRENGTH, 1/60);
  }
  assert(Math.abs(chair.group.scale.x - 2.6) < .001); assert(Math.abs(table.group.scale.x - 1.08) < .001);
  assert.equal(idle.group.scale.x, 1);
  for (let frame = 0; frame < 300; frame++) updateGazeScale(chair, { hitObject: null }, 1, EFFECT_STRENGTH, 1/60);
  assert(Math.abs(chair.group.scale.x - 2) < .001);
});

test('calm gaze cannot grow furniture and the occupied cushion retains its seated hip height', () => {
  const chair = { kind: 'chair', occupied: true, group: new THREE.Group(), target: { value: 1 } };
  for (let i=0; i<100; i++) updateGazeScale(chair, { hitObject: chair }, 0, EFFECT_STRENGTH, .1);
  assert.equal(chair.group.scale.x, 1);
  for (let i=0; i<100; i++) updateGazeScale(chair, { hitObject: chair }, 1, EFFECT_STRENGTH, .1);
  assert(chair.group.scale.x > 1.29); assert.equal(chair.group.scale.y, 1);
  assert.equal(furnitureKind(['Plane'], { Plane: 'table' }), 'table');
});

test('a sculpture excluded from gaze growth keeps its authored scale even with maximum growth settings', () => {
  const statue = { group: new THREE.Group(), gazeGrowth: false, target: { value: 1 } };
  statue.group.scale.set(2, 3, 2);
  for (let i = 0; i < 300; i++) updateGazeScale(statue, { hitObject: statue }, 1,
    { ...EFFECT_STRENGTH, objectGrowth: .6 }, 1 / 60);
  assert.deepEqual(statue.group.scale.toArray(), [2, 3, 2]);
  assert.equal(statue.gazeScale, 1);
});
