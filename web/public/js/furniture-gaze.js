import * as THREE from 'three';

export function furnitureKind(names, overrides = {}) {
  for (const name of names) if (overrides[name]) return overrides[name];
  if (names.some(name => /table|bench/i.test(name))) return 'table';
  if (names.some(name => /chair|stool|pouf/i.test(name))) return 'chair';
  return 'object';
}

/** Growth is driven by the nearest visible hit, and always uses the rest scale. */
export function updateGazeScale(object, gaze, active, settings, dt) {
  object.baseScale ||= object.group.scale.clone();
  if (object.gazeGrowth === false) {
    object.gazeScale = 1;
    object.group.scale.copy(object.baseScale);
    return;
  }
  const growth = object.kind === 'chair' ? settings.chairGrowth : object.kind === 'table' ? settings.tableGrowth : settings.objectGrowth;
  const wanted = gaze.hitObject === object ? 1 + growth * active * object.target.value : 1;
  object.gazeScale = THREE.MathUtils.damp(object.gazeScale ?? 1, wanted, settings.scaleResponse, dt);
  object.group.scale.copy(object.baseScale).multiplyScalar(object.gazeScale);
  // The occupied cushion stays at hip height; its footprint can still grow.
  if (object.occupied) object.group.scale.y = object.baseScale.y;
}
