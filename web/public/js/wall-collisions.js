import * as THREE from 'three';

const EPS = 1e-5;
const clamp = THREE.MathUtils.clamp;

/**
 * Rigid, floor-anchored contacts for the gallery's horizontally moving walls.
 * Geometry is inspected once. Per-frame work uses cached finite wall segments
 * and a small set of furniture AABBs; it never raycasts or uploads vertices.
 * Construct at rest, add the gallery props and seats, then call setDesired for
 * animated props and update after their gaze scales have been set each frame.
 */
export class WallCollisionSystem {
  constructor(env, fx, { padding = .025, returnRate = 5, iterations = 12,
    maxContraction = .4, driftAllowance = 1 } = {}) {
    Object.assign(this, { env, fx, padding, returnRate, iterations, maxContraction, driftAllowance });
    this.bodies = []; this.byObject = new Map(); this.pairs = [];
    this._position = new THREE.Vector3(); this._local = new THREE.Vector3();
    this.stats = { wallTriangles: 0, cachedContacts: 0, wallPushes: 0, pairPushes: 0 };
    this.triangles = this._readWalls();
  }

  _readWalls() {
    this.env.root?.updateMatrixWorld(true);
    const triangles = [], a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    const ab = new THREE.Vector3(), ac = new THREE.Vector3(), normal = new THREE.Vector3();
    const k = this.fx.uLeanK.value, center = this.fx.uCenter.value;
    const moving = new Set((this.env.roomMotion || []).map(entry => entry.mesh));
    for (const mesh of this.env.roomMeshes || []) {
      if (!['wall', 'window', 'room'].includes(mesh.userData.environmentRole)) continue;
      mesh.updateWorldMatrix(true, false);
      const position = mesh.geometry.attributes.position, index = mesh.geometry.index;
      const count = index ? index.count : position.count;
      const point = (vertex, out) => {
        out.fromBufferAttribute(position, vertex).applyMatrix4(mesh.matrixWorld);
        // Room vertices remain in rest coordinates; undo an already applied
        // room transform if a caller creates the solver during a reaction.
        if (moving.has(mesh) && k) {
          out.x = center.x + (out.x - center.x) / Math.max(.1, 1 - k);
          out.z = center.y + (out.z - center.y) / Math.max(.1, 1 - k);
        }
      };
      for (let i = 0; i + 2 < count; i += 3) {
        point(index ? index.getX(i) : i, a);
        point(index ? index.getX(i + 1) : i + 1, b);
        point(index ? index.getX(i + 2) : i + 2, c);
        normal.crossVectors(ab.subVectors(b, a), ac.subVectors(c, a));
        const area2 = normal.length();
        if (area2 < 1e-5) continue;
        normal.multiplyScalar(1 / area2);
        // Ignore floors, ceiling, bevel tops and horizontal trim. The actual
        // vertical faces define contact, including internal L-shaped walls.
        if (Math.abs(normal.y) > .02) continue;
        const length = Math.hypot(normal.x, normal.z);
        const nx = normal.x / length, nz = normal.z / length;
        const d = (nx * (a.x + b.x + c.x) + nz * (a.z + b.z + c.z)) / 3;
        // Each face is a triangle in its vertical (tangent,height) plane.
        triangles.push(nx, nz, d, -nz * a.x + nx * a.z, a.y,
          -nz * b.x + nx * b.z, b.y, -nz * c.x + nx * c.z, c.y);
      }
    }
    this.stats.wallTriangles = triangles.length / 9;
    return new Float32Array(triangles);
  }

  /** base and desired positions are world-space pivot coordinates. */
  add(object, { base, fixed = false, occupant = false } = {}) {
    if (this.byObject.has(object)) return this.byObject.get(object);
    object.updateWorldMatrix(true, true);
    const pivot = object.getWorldPosition(new THREE.Vector3());
    const bounds = new THREE.Box3().setFromObject(object);
    if (bounds.isEmpty()) throw new Error(`Cannot register empty collision body: ${object.name}`);
    if(occupant){bounds.min.x-=.18;bounds.max.x+=.18;bounds.min.z-=.18;bounds.max.z+=.18;bounds.max.y=Math.max(bounds.max.y,pivot.y+1.8);}
    const size = bounds.getSize(new THREE.Vector3()), middle = bounds.getCenter(new THREE.Vector3());
    const body = {
      object, fixed, base: (base || pivot).clone(), desired: (base || pivot).clone(),
      startScale: object.scale.clone(), offsetX: middle.x - pivot.x, offsetZ: middle.z - pivot.z,
      halfX: size.x / 2, halfZ: size.z / 2,
      bottom: bounds.min.y - pivot.y, top: bounds.max.y - pivot.y,
      x: middle.x, z: middle.z, hx: size.x / 2, hz: size.z / 2,
      minY: bounds.min.y, maxY: bounds.max.y, scale: 1,
      pushX: 0, pushZ: 0, contacts: [],
    };
    body.contacts = this._contacts(body);
    for (const other of this.bodies) {
      const ox = body.hx + other.hx - Math.abs(body.x - other.x);
      const oz = body.hz + other.hz - Math.abs(body.z - other.z);
      const vertical = Math.min(body.maxY, other.maxY) - Math.max(body.minY, other.minY);
      // Some authored sculptures have overlapping conservative AABBs. Keep
      // that intentional starting arrangement rather than teleporting it calm.
      this.pairs.push({ a: other, b: body, authoredOverlap: ox > EPS && oz > EPS && vertical > EPS });
    }
    this.bodies.push(body); this.byObject.set(object, body);
    this.stats.cachedContacts += body.contacts.length;
    return body;
  }

  get(object) { return this.byObject.get(object); }

  setDesired(object, x, z) {
    const body = this.byObject.get(object);
    if (!body) return false;
    if (typeof x === 'object') { body.desired.x = x.x; body.desired.z = x.z; }
    else { body.desired.x = x; body.desired.z = z; }
    return true;
  }

  _contacts(body) {
    const groups = new Map(), data = this.triangles, center = this.fx.uCenter.value;
    const height = body.top - body.bottom;
    // Horizontal cross-sections retain openings and wall ends. Using the
    // triangle's whole bounding rectangle would incorrectly fill doorways.
    const heights = [.06, .45, .85].map(t => body.base.y + body.bottom + height * t);
    const reachX = body.halfX * 1.2, reachZ = body.halfZ * 1.2;
    for (let i = 0; i < data.length; i += 9) {
      let nx = data[i], nz = data[i + 1], d = data[i + 2];
      const side = nx * body.x + nz * body.z >= d ? 1 : -1;
      nx *= side; nz *= side; d *= side;
      const support = Math.abs(nx) * reachX + Math.abs(nz) * reachZ;
      const distance = nx * body.x + nz * body.z - d;
      const centerN = nx * center.x + nz * center.y;
      const travel = Math.abs(d - centerN) * this.maxContraction;
      if (distance > support + travel + this.driftAllowance) continue;
      for (const y of heights) {
        const ts = [];
        for (let edge = 0; edge < 3; edge++) {
          const next = (edge + 1) % 3;
          const t0 = data[i + 3 + edge * 2], y0 = data[i + 4 + edge * 2];
          const t1 = data[i + 3 + next * 2], y1 = data[i + 4 + next * 2];
          if (Math.abs(y1 - y0) < EPS) {
            if (Math.abs(y - y0) < EPS) ts.push(t0, t1);
          } else if (y >= Math.min(y0, y1) - EPS && y <= Math.max(y0, y1) + EPS) {
            ts.push(t0 + (t1 - t0) * clamp((y - y0) / (y1 - y0), 0, 1));
          }
        }
        if (ts.length < 2) continue;
        let minT = Math.min(...ts), maxT = Math.max(...ts);
        if (maxT - minT < .025) continue;
        if (side < 0) [minT, maxT] = [-maxT, -minT];
        const ct = -nz * center.x + nx * center.y;
        const minEnd = ct + (minT - ct) * (1 - this.maxContraction);
        const maxEnd = ct + (maxT - ct) * (1 - this.maxContraction);
        const bt = -nz * body.x + nx * body.z;
        const ht = Math.abs(nz) * reachX + Math.abs(nx) * reachZ;
        if (bt + ht + this.driftAllowance < Math.min(minT, minEnd) ||
            bt - ht - this.driftAllowance > Math.max(maxT, maxEnd)) continue;
        const key = `${Math.round(nx * 1000)},${Math.round(nz * 1000)},${Math.round(d * 1000)}`;
        if (!groups.has(key)) groups.set(key, { nx, nz, d, intervals: [] });
        groups.get(key).intervals.push([minT, maxT]);
      }
    }
    const result = [];
    for (const plane of groups.values()) {
      plane.intervals.sort((a, b) => a[0] - b[0]);
      const merged = [];
      for (const interval of plane.intervals) {
        const last = merged[merged.length - 1];
        if (last && interval[0] <= last[1] + .006) last[1] = Math.max(last[1], interval[1]);
        else merged.push(interval.slice());
      }
      const { nx, nz, d } = plane;
      for (const [minT, maxT] of merged) {
        const bt = -nz * body.x + nx * body.z;
        const ht = Math.abs(nz) * body.halfX + Math.abs(nx) * body.halfZ;
        const support = Math.abs(nx) * body.halfX + Math.abs(nz) * body.halfZ;
        const distance = nx * body.x + nz * body.z - d;
        const overlaps = bt + ht > minT && bt - ht < maxT;
        const allowance = overlaps ? Math.max(0, support + this.padding - distance) : 0;
        result.push({ nx, nz, d, minT, maxT, allowance });
      }
    }
    return result;
  }

  _walls(body, k, center) {
    if (body.fixed) return;
    for (const contact of body.contacts) {
      const { nx, nz } = contact;
      const ct = -nz * center.x + nx * center.y;
      const bt = -nz * body.x + nx * body.z;
      const ht = Math.abs(nz) * body.hx + Math.abs(nx) * body.hz;
      const minT = ct + (contact.minT - ct) * (1 - k);
      const maxT = ct + (contact.maxT - ct) * (1 - k);
      if (bt + ht <= minT + EPS || bt - ht >= maxT - EPS) continue;
      const cn = nx * center.x + nz * center.y;
      const plane = cn + (contact.d - cn) * (1 - k);
      const support = Math.abs(nx) * body.hx + Math.abs(nz) * body.hz;
      const penetration = support + this.padding - contact.allowance - (nx * body.x + nz * body.z - plane);
      if (penetration > EPS) {
        body.x += nx * penetration; body.z += nz * penetration;
        body.pushX += nx * penetration; body.pushZ += nz * penetration;
        this.stats.wallPushes++;
      }
    }
  }

  _pair(pair) {
    if (pair.authoredOverlap) return;
    const { a, b } = pair;
    if (a.fixed && b.fixed || a.maxY <= b.minY + EPS || b.maxY <= a.minY + EPS) return;
    const dx = b.x - a.x, dz = b.z - a.z;
    const overlapX = a.hx + b.hx - Math.abs(dx), overlapZ = a.hz + b.hz - Math.abs(dz);
    if (overlapX <= EPS || overlapZ <= EPS) return;
    const axis = overlapX < overlapZ ? 'x' : 'z';
    const delta = axis === 'x' ? dx : dz;
    const direction = delta >= 0 ? 1 : -1;
    const depth = (axis === 'x' ? overlapX : overlapZ) + EPS;
    const push = axis === 'x' ? 'pushX' : 'pushZ';
    // A wall-loaded prop passes its push on to the next prop. It does not
    // repeatedly get pushed back into the wall by a symmetric pair solve.
    let weightA = a.fixed || a[push] * direction > EPS ? 0 : 1;
    let weightB = b.fixed || b[push] * direction < -EPS ? 0 : 1;
    if (!weightA && !weightB) {
      if (a.fixed || b.fixed) return;
      weightA = weightB = 1; // crowded but movable: solve, then enforce walls
    }
    const total = weightA + weightB;
    const moveA = -direction * depth * weightA / total, moveB = direction * depth * weightB / total;
    a[axis] += moveA; b[axis] += moveB;
    a[push] += moveA; b[push] += moveB;
    this.stats.pairPushes++;
  }

  update(dt) {
    dt = clamp(Number.isFinite(dt) ? dt : 0, 0, .1);
    const k = clamp(this.fx.uLeanK.value, 0, this.maxContraction), center = this.fx.uCenter.value;
    const blend = 1 - Math.exp(-this.returnRate * dt);
    this.stats.wallPushes = this.stats.pairPushes = 0;
    for (const body of this.bodies) {
      const scale = Math.max(Math.abs(body.object.scale.x / body.startScale.x), Math.abs(body.object.scale.z / body.startScale.z));
      const scaleY = Math.abs(body.object.scale.y / body.startScale.y);
      // Growth about an off-centre pivot changes its AABB centre immediately;
      // it must not create an artificial translation of the object's pivot.
      body.x += body.offsetX * (scale - body.scale);
      body.z += body.offsetZ * (scale - body.scale);
      body.scale = scale; body.hx = body.halfX * scale; body.hz = body.halfZ * scale;
      body.pivotY = body.base.y + body.bottom * (1 - scaleY);
      body.minY = body.base.y + body.bottom; body.maxY = body.pivotY + body.top * scaleY;
      const targetX = body.desired.x + body.offsetX * scale, targetZ = body.desired.z + body.offsetZ * scale;
      body.x = body.fixed ? body.base.x + body.offsetX * scale : THREE.MathUtils.lerp(body.x, targetX, blend);
      body.z = body.fixed ? body.base.z + body.offsetZ * scale : THREE.MathUtils.lerp(body.z, targetZ, blend);
      body.pushX = body.pushZ = 0;
    }
    for (let iteration = 0; iteration < this.iterations; iteration++) {
      for (const body of this.bodies) this._walls(body, k, center);
      for (const pair of this.pairs) this._pair(pair);
    }
    // If a room is overfilled, protecting its solid boundary takes precedence.
    for (const body of this.bodies) {
      this._walls(body, k, center);
      this._position.set(body.x - body.offsetX * body.scale, body.pivotY, body.z - body.offsetZ * body.scale);
      this._local.copy(this._position);
      if (body.object.parent) body.object.parent.worldToLocal(this._local);
      body.object.position.copy(this._local);
      body.object.updateMatrixWorld(true);
    }
  }
}
