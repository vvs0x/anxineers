import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WallCollisionSystem } from '../public/js/wall-collisions.js';

function setup(walls, center = new THREE.Vector2()) {
  const root = new THREE.Group();
  for (const wall of walls) { wall.userData.environmentRole = 'wall'; root.add(wall); }
  root.updateMatrixWorld(true);
  const fx = { uLeanK: { value: 0 }, uCenter: { value: center } };
  const env = { root, roomMeshes: walls, roomMotion: walls.map(mesh => ({ mesh })) };
  return { root, fx, solver: new WallCollisionSystem(env, fx) };
}
function box(x, z, width = 1, depth = 1, height = 1) {
  const object = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), new THREE.MeshBasicMaterial());
  object.position.set(x, height / 2, z); return object;
}
function body(setup, x, z, options = {}) {
  const object = box(x, z, options.width || 1, options.depth || 1);
  setup.root.add(object); setup.root.updateMatrixWorld(true);
  setup.solver.add(object, options); return object;
}
const near = (a, b, message, epsilon = 1e-5) => assert(Math.abs(a - b) < epsilon, `${message}: ${a} vs ${b}`);

// A wall does not tow every object in the room. A prop starts moving precisely
// when the real inner wall surface reaches its conservative rigid footprint.
{
  const test = setup([box(-5, 0, .2, 10, 4)]);
  const furniture = body(test, -3.8, 0), free = body(test, 1, 2);
  const baseY = furniture.position.y;
  test.fx.uLeanK.value = .1; test.solver.update(1 / 60);
  near(furniture.position.x, -3.8, 'no premature transport');
  test.fx.uLeanK.value = .2; test.solver.update(1 / 60);
  near(furniture.position.x, -4.9 * .8 + .5 + .025, 'inner wall pushes rigid footprint');
  near(furniture.position.y, baseY, 'floor anchor unchanged');
  near(free.position.x, 1, 'uncontacted object x unchanged'); near(free.position.z, 2, 'uncontacted object z unchanged');
  const displaced = furniture.position.x;
  test.fx.uLeanK.value = 0; test.solver.update(1 / 60);
  assert(furniture.position.x < displaced && furniture.position.x > -3.8, 'outward return is gradual');
  for (let i = 0; i < 180; i++) test.solver.update(1 / 60);
  near(furniture.position.x, -3.8, 'released prop returns to authored location');
}

// A short internal wall in an L-shaped room only blocks its finite span. An
// infinite room bounding box or infinite wall plane would move the free prop.
{
  const test = setup([box(0, -3, .2, 4, 4)], new THREE.Vector2(-3, 0));
  const behindWall = body(test, -.8, -2, { width: .6, depth: .6 });
  const inOpening = body(test, -.8, 2, { width: .6, depth: .6 });
  test.fx.uLeanK.value = .3; test.solver.update(1 / 60);
  const wallX = -3 + (-.1 + 3) * .7;
  near(behindWall.position.x, wallX - .3 - .025, 'internal wall contact');
  near(inOpening.position.x, -.8, 'open end of L wall remains open');
  near(inOpening.position.z, 2, 'open end has no fake z wall');
}

// Uniform gaze growth participates in collision without shrinking a prop or
// raising its floor anchor. Declining scale releases the collision smoothly.
{
  const test = setup([box(-5, 0, .2, 10, 4)]);
  const furniture = body(test, -4.35, 0);
  furniture.scale.setScalar(1.2); test.solver.update(1 / 60);
  near(furniture.position.x, -4.9 + .6 + .025, '20% growth wall clearance');
  near(furniture.scale.x, 1.2, 'solver preserves requested scale');
  furniture.updateMatrixWorld(true);
  near(new THREE.Box3().setFromObject(furniture).min.y, 0, 'scaled underside stays on the floor');
}

// A wall pushes a chain of furniture. Every prop remains rigid and separates
// from its neighbour; empty space beyond the chain stays untouched.
{
  const test = setup([box(-5, 0, .2, 10, 4)]);
  const objects = [-3.8, -2.7, -1.6].map(x => body(test, x, 0));
  const occupied = body(test, 0, 3, { fixed: true });
  const versions = test.root.children.map(mesh => mesh.geometry.attributes.position.version);
  test.fx.uLeanK.value = .25; test.solver.update(1 / 60);
  assert(objects[2].position.x > -1.6, 'push reaches last prop in chain');
  for (let i = 1; i < objects.length; i++) assert(objects[i].position.x - objects[i - 1].position.x >= 1 - 1e-4);
  near(objects[0].position.x, -4.9 * .75 + .525, 'first prop cannot be pushed back through wall');
  near(occupied.position.x, 0, 'occupied seat remains anchored'); near(occupied.position.z, 3, 'occupied seat remains anchored z');
  assert.deepEqual(test.root.children.map(mesh => mesh.geometry.attributes.position.version), versions, 'no vertex uploads');
}

// An asymmetrical sculpture grows around its authored pivot, without the
// collision system adding a sideways slide in otherwise empty space.
{
  const test = setup([]), sculpture = new THREE.Group();
  sculpture.position.set(2, 0, 0); sculpture.add(box(1, 0, .5, .5));
  test.root.add(sculpture); test.root.updateMatrixWorld(true); test.solver.add(sculpture);
  sculpture.scale.setScalar(1.2); test.solver.update(1 / 60);
  near(sculpture.position.x, 2, 'off-centre gaze growth keeps authored pivot');
  near(sculpture.position.y, 0, 'off-centre gaze growth keeps floor anchor');
}

// Preserve authored initial intersections of conservative boxes in calm. They
// are explicitly masked rather than causing a start-up rearrangement.
{
  const test = setup([box(-5, 0, .2, 10, 4)]);
  const touchingWall = body(test, -4.6, 2);
  const a = body(test, 0, 0), b = body(test, .4, 0);
  test.solver.update(1 / 60);
  near(touchingWall.position.x, -4.6, 'authored wall overlap preserved at rest');
  near(a.position.x, 0, 'authored pair first placement'); near(b.position.x, .4, 'authored pair second placement');
}

// Non-axis-aligned vertical walls use their actual normal, not an x/z room box.
{
  const wall = box(0, 0, .2, 6, 4); wall.rotation.y = Math.PI / 4;
  const test = setup([wall], new THREE.Vector2(-2, 0));
  const furniture = body(test, -.8, 0, { width: .5, depth: .5 });
  test.fx.uLeanK.value = .3; test.solver.update(1 / 60);
  assert(furniture.position.x < -.8 && furniture.position.z > 0, 'diagonal wall pushes along its normal');
  const b = test.solver.get(furniture);
  for (const c of b.contacts) {
    const cn = c.nx * -2;
    const plane = cn + (c.d - cn) * .7;
    const tangent = -c.nz * b.x + c.nx * b.z, ct = c.nz * 2;
    const minT = ct + (c.minT - ct) * .7, maxT = ct + (c.maxT - ct) * .7;
    if (tangent > minT && tangent < maxT) assert(c.nx * b.x + c.nz * b.z - plane >= Math.abs(c.nx) * b.hx + Math.abs(c.nz) * b.hz + .025 - c.allowance - 1e-4);
  }
}

console.log('PASS: actual finite walls, contact-only motion, L-shaped opening, 20% growth, floor anchor, prop push chain, fixed occupied seat, smooth return, authored overlap preservation and zero vertex uploads.');
