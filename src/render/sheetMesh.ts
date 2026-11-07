/**
 * Turns a {@link TearSheet} into triangles. Shared by the wall and the tube. A
 * triangle goes when one of its edges has broken, or when it has been stretched
 * too far to draw: a node freed by a cut can be pulled well away from its
 * neighbours, and the sliver between them would show as a long spike over the hole.
 */

import type { TearSheet } from '../core/tearSheet.ts';

/** A surviving triangle stretched past this, relative to rest, is dropped. */
const MAX_TRIANGLE_STRETCH = 1.55;

export interface SheetMesh {
  /** Rest UVs per node. `flipV` counts v up from the bottom, as a GL source does. */
  uv: Float32Array;
  /** Every triangle as node-index triples. */
  triangles: Int32Array;
  /** The constraint behind each triangle's three edges, -1 for none. */
  triEdges: Int32Array;
  /** 1 for a triangle currently stretched too far. */
  triStretched: Uint8Array;
}

export function buildSheetMesh(sheet: TearSheet, flipV = false): SheetMesh {
  const { cols, rows } = sheet;
  const n = cols * rows;
  const uv = new Float32Array(n * 2);
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const i = r * cols + c;
      uv[i * 2] = c / (cols - 1);
      uv[i * 2 + 1] = flipV ? 1 - r / (rows - 1) : r / (rows - 1);
    }
  }
  // Map each node pair to its constraint, so a triangle can tell whether any of
  // its 3 edges has broken.
  const pairToConstraint = new Map<number, number>();
  const key = (a: number, b: number): number => (a < b ? a * n + b : b * n + a);
  const cc = sheet.restLength.length;
  for (let k = 0; k < cc; k += 1) {
    pairToConstraint.set(key(sheet.constraints[k * 2]!, sheet.constraints[k * 2 + 1]!), k);
  }
  const tris: number[] = [];
  const edges: number[] = [];
  const pushTri = (a: number, b: number, c2: number): void => {
    tris.push(a, b, c2);
    edges.push(
      pairToConstraint.get(key(a, b)) ?? -1,
      pairToConstraint.get(key(b, c2)) ?? -1,
      pairToConstraint.get(key(a, c2)) ?? -1,
    );
  };
  for (let r = 0; r < rows - 1; r += 1) {
    for (let c = 0; c < cols - 1; c += 1) {
      const i = r * cols + c;
      pushTri(i, i + 1, i + cols);
      pushTri(i + 1, i + cols + 1, i + cols);
    }
  }
  return {
    uv,
    triangles: Int32Array.from(tris),
    triEdges: Int32Array.from(edges),
    triStretched: new Uint8Array(tris.length / 3),
  };
}

/** Mark triangles stretched too far to draw, returning how many there are. */
export function markStretched(sheet: TearSheet, mesh: SheetMesh): number {
  const { xs, ys } = sheet;
  const limit2 = MAX_TRIANGLE_STRETCH * MAX_TRIANGLE_STRETCH;
  const tris = mesh.triangles;
  let count = 0;
  for (let t = 0; t < mesh.triStretched.length; t += 1) {
    const a = tris[t * 3]!;
    const b = tris[t * 3 + 1]!;
    const c = tris[t * 3 + 2]!;
    // Each cell splits into triangles with two unit edges and one diagonal,
    // whose rest length squared is 2.
    const ab = (xs[a]! - xs[b]!) ** 2 + (ys[a]! - ys[b]!) ** 2;
    const bc = (xs[b]! - xs[c]!) ** 2 + (ys[b]! - ys[c]!) ** 2;
    const ac = (xs[a]! - xs[c]!) ** 2 + (ys[a]! - ys[c]!) ** 2;
    const stretched = Math.max(ab, bc, ac) > 2 * limit2;
    mesh.triStretched[t] = stretched ? 1 : 0;
    if (stretched) count += 1;
  }
  return count;
}

/** The triangles still worth drawing, as an element array. */
export function liveTriangles(sheet: TearSheet, mesh: SheetMesh): Uint32Array {
  const { triangles, triEdges, triStretched } = mesh;
  const live: number[] = [];
  const triCount = triangles.length / 3;
  for (let t = 0; t < triCount; t += 1) {
    const e0 = triEdges[t * 3]!;
    const e1 = triEdges[t * 3 + 1]!;
    const e2 = triEdges[t * 3 + 2]!;
    const torn =
      (e0 >= 0 && sheet.broken[e0] === 1) ||
      (e1 >= 0 && sheet.broken[e1] === 1) ||
      (e2 >= 0 && sheet.broken[e2] === 1);
    if (torn || triStretched[t] === 1) continue;
    live.push(triangles[t * 3]!, triangles[t * 3 + 1]!, triangles[t * 3 + 2]!);
  }
  return new Uint32Array(live);
}
