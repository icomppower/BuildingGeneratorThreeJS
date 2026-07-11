/**
 * Kowloon Walled City district layer: tiles a grid of micro-plots, each an
 * independent call into the single-building generator, packed at a spacing
 * tighter than the buildings' own footprints so neighbours overlap and fuse —
 * the "illegal density" that defines the Walled City, instead of the generator's
 * normal isolated-lot spacing.
 *
 * Upper floors are stitched together with a walkway graph. Real-world walled-city
 * walkways were dense but not exhaustive, so edges are randomly sampled — then any
 * leftover disconnected pocket is bridged onto the main mass so the whole structure
 * stays pathfindable from any building to any other (the hard verification target).
 */
import { BoxGeometry, Group, Matrix4, Mesh, MeshStandardMaterial } from "three";
import { defaultParams, type BuildingParams } from "./params";
import { generateBuilding, type Placement, type KitCounts } from "./generator";
import { hash01, randInt, randFloat } from "./rng";

export interface CityParams {
  gridSize: number;
  cellSize: number;
  jitter: number;
  floorMin: number;
  floorMax: number;
  walkwayChance: number;
  seed: number;
}

export function defaultCityParams(): CityParams {
  return {
    gridSize: 6,
    cellSize: 2.6,
    jitter: 0.35,
    floorMin: 4,
    floorMax: 16,
    walkwayChance: 0.55,
    seed: 0,
  };
}

export interface Plot {
  gx: number;
  gz: number;
  /** plot centre in the generator's local (Blender) x/y ground plane */
  x: number;
  y: number;
  params: BuildingParams;
}

export interface WalkwayEdge {
  a: number; // plot index
  b: number; // plot index
  /** window-row index the bridge crosses at */
  floor: number;
  /** true if this edge was added solely to guarantee full connectivity */
  forced: boolean;
}

export interface Connectivity {
  plotCount: number;
  edgeCount: number;
  forcedCount: number;
  componentCount: number;
  fullyTraversable: boolean;
}

export interface CityLayout {
  plots: Plot[];
  edges: WalkwayEdge[];
  connectivity: Connectivity;
}

class UnionFind {
  private parent: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }
  find(x: number): number {
    while (this.parent[x] !== x) {
      this.parent[x] = this.parent[this.parent[x]];
      x = this.parent[x];
    }
    return x;
  }
  union(a: number, b: number): boolean {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return false;
    this.parent[ra] = rb;
    return true;
  }
}

const plotId = (gx: number, gz: number, n: number): number => gz * n + gx;

function buildPlots(cp: CityParams): Plot[] {
  const n = cp.gridSize;
  const half = ((n - 1) * cp.cellSize) / 2;
  const center = (n - 1) / 2;
  const maxDist = Math.hypot(center, center) || 1;
  const plots: Plot[] = [];
  for (let gz = 0; gz < n; gz++) {
    for (let gx = 0; gx < n; gx++) {
      const id = plotId(gx, gz, n);
      // peak-density silhouette: taller toward the core, lower toward the edges
      const distT = Math.hypot(gx - center, gz - center) / maxDist;
      const floorSpan = cp.floorMax - cp.floorMin;
      const floorBase = cp.floorMax - floorSpan * Math.min(1, distT * 1.15);
      const floor = Math.max(3, Math.min(40, Math.round(floorBase + randFloat(-2, 2, id, cp.seed))));
      const length = Math.max(2, Math.min(6, randInt(2, 5, id, cp.seed + 101)));
      const width = Math.max(2, Math.min(5, randInt(2, 4, id, cp.seed + 202)));
      const jx = randFloat(-cp.jitter, cp.jitter, id, cp.seed + 303) * cp.cellSize;
      const jy = randFloat(-cp.jitter, cp.jitter, id, cp.seed + 404) * cp.cellSize;
      const params: BuildingParams = {
        ...defaultParams(),
        floor,
        length,
        width,
        randomise: randInt(0, 999, id, cp.seed + 505),
        acUnit: randFloat(0.35, 0.9, id, cp.seed + 606),
        clothlineProbability: randFloat(0.3, 0.9, id, cp.seed + 707),
        closedOpenStore: randFloat(0.2, 0.85, id, cp.seed + 808),
        storeSign: randFloat(0.3, 0.95, id, cp.seed + 909),
      };
      plots.push({
        gx,
        gz,
        x: gx * cp.cellSize - half + jx,
        y: gz * cp.cellSize - half + jy,
        params,
      });
    }
  }
  return plots;
}

function buildWalkwayEdges(plots: Plot[], cp: CityParams): WalkwayEdge[] {
  const n = cp.gridSize;
  const candidates: { a: number; b: number }[] = [];
  for (let gz = 0; gz < n; gz++) {
    for (let gx = 0; gx < n; gx++) {
      const id = plotId(gx, gz, n);
      if (gx + 1 < n) candidates.push({ a: id, b: plotId(gx + 1, gz, n) });
      if (gz + 1 < n) candidates.push({ a: id, b: plotId(gx, gz + 1, n) });
    }
  }

  const pickFloor = (a: Plot, b: Plot, eid: number): number => {
    const maxFloor = Math.max(2, Math.min(a.params.floor, b.params.floor) - 1);
    return randInt(2, maxFloor, eid, cp.seed + 9001);
  };

  const uf = new UnionFind(plots.length);
  const edges: WalkwayEdge[] = [];
  candidates.forEach((c, i) => {
    if (hash01(i, cp.seed + 1301) < cp.walkwayChance) {
      edges.push({ a: c.a, b: c.b, floor: pickFloor(plots[c.a], plots[c.b], i), forced: false });
      uf.union(c.a, c.b);
    }
  });

  // guarantee full connectivity: any candidate edge still spanning two separate
  // components gets forced in — the grid graph of candidates is itself fully
  // connected, so this always converges to a single component
  candidates.forEach((c, i) => {
    if (uf.find(c.a) !== uf.find(c.b)) {
      edges.push({ a: c.a, b: c.b, floor: pickFloor(plots[c.a], plots[c.b], i + 50000), forced: true });
      uf.union(c.a, c.b);
    }
  });

  return edges;
}

function analyzeConnectivity(plots: Plot[], edges: WalkwayEdge[]): Connectivity {
  const uf = new UnionFind(plots.length);
  for (const e of edges) uf.union(e.a, e.b);
  const roots = new Set<number>();
  for (let i = 0; i < plots.length; i++) roots.add(uf.find(i));
  return {
    plotCount: plots.length,
    edgeCount: edges.length,
    forcedCount: edges.filter(e => e.forced).length,
    componentCount: roots.size,
    fullyTraversable: roots.size <= 1,
  };
}

export function generateCityLayout(cp: CityParams): CityLayout {
  const plots = buildPlots(cp);
  const edges = buildWalkwayEdges(plots, cp);
  const connectivity = analyzeConnectivity(plots, edges);
  return { plots, edges, connectivity };
}

/** all buildings in the layout, merged into one placement list (world-plane offsets
 *  baked into each instance matrix) so the kit batches them into shared InstancedMeshes
 *  instead of one draw-call set per building. */
export function generateCityPlacements(layout: CityLayout, counts: KitCounts): Placement[] {
  const out: Placement[] = [];
  const t = new Matrix4();
  for (const plot of layout.plots) {
    t.makeTranslation(plot.x, plot.y, 0);
    for (const pl of generateBuilding(plot.params, counts)) {
      out.push({ key: pl.key, matrix: t.clone().multiply(pl.matrix) });
    }
  }
  return out;
}

// plank spans the X axis pre-scale; rotated flat about local Z (Blender's up axis)
// so it lies in the ground plane between the two plots it connects
const PLANK_GEOM = new BoxGeometry(1, 0.9, 0.1);
const RAIL_GEOM = new BoxGeometry(1, 0.06, 0.55);
const PLANK_MAT = new MeshStandardMaterial({ color: 0x2c2a28, roughness: 0.95, metalness: 0.05 });
const RAIL_MAT = new MeshStandardMaterial({ color: 0x6b4a35, roughness: 0.7, metalness: 0.35 });

/** procedural plank-and-rail bridges for every edge in the layout, one per floor
 *  crossing — built as plain (non-instanced) meshes since edge counts stay modest. */
export function buildWalkways(layout: CityLayout): Group {
  const group = new Group();
  group.name = "walkways";
  for (const e of layout.edges) {
    const a = layout.plots[e.a];
    const b = layout.plots[e.b];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.05) continue;
    const angle = Math.atan2(dy, dx);
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;
    const z = e.floor + 0.55; // mid-height of that window row

    const plank = new Mesh(PLANK_GEOM, PLANK_MAT);
    plank.scale.set(dist, 1, 1);
    plank.position.set(midX, midY, z);
    plank.rotation.z = angle;
    plank.castShadow = plank.receiveShadow = true;
    group.add(plank);

    const perpX = -Math.sin(angle) * 0.45;
    const perpY = Math.cos(angle) * 0.45;
    for (const side of [-1, 1]) {
      const rail = new Mesh(RAIL_GEOM, RAIL_MAT);
      rail.scale.set(dist, 1, 1);
      rail.position.set(midX + perpX * side, midY + perpY * side, z + 0.32);
      rail.rotation.z = angle;
      rail.castShadow = true;
      group.add(rail);
    }
  }
  return group;
}
