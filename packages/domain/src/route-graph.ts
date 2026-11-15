/**
 * Our own sea-route search over a network of sea lanes: graph building, nearest-node snapping,
 * Dijkstra and a penalty search for distinct alternative routes. Pure and deterministic: ties are
 * broken by node index and every loop runs in input order.
 */
import type { HazardZone, LatLon, RouteCandidate, RouteGraph } from "@pharos/shared";
import { HAZARD_EDGE_PENALTY } from "./constants.js";
import { greatCircleNm, polylineNm } from "./geo.js";
import { zonesContaining } from "./hazards.js";

export type RouteErrorCode = "off_network" | "no_path" | "same_point";

export class RouteError extends Error {
  readonly code: RouteErrorCode;
  constructor(code: RouteErrorCode, message: string) {
    super(message);
    this.name = "RouteError";
    this.code = code;
  }
}

/** Nodes closer than this to each other are one node (degrees, by rounding to 4 decimals). */
const NODE_KEY_SCALE = 1e4;
/** Start and end closer than this (nm) are the same point; there is nothing to route. */
const SAME_POINT_NM = 1;
/** Further penalty attempts after the first (shortest) path. */
const MAX_EXTRA_ATTEMPTS = 6;

const nodeKey = (p: LatLon): string =>
  `${Math.round(p.lat * NODE_KEY_SCALE)},${Math.round(p.lon * NODE_KEY_SCALE)}`;

/**
 * Undirected graph from polylines. Nodes are deduplicated on coordinates rounded to 4 decimals,
 * in first-seen order (a node keeps its first-seen coordinates). One edge per consecutive pair,
 * stored as `a < b` with its great-circle length; duplicate edges and self-loops are dropped.
 */
export function buildRouteGraph(segments: LatLon[][]): RouteGraph {
  const nodes: LatLon[] = [];
  const edges: RouteGraph["edges"] = [];
  const nodeIndex = new Map<string, number>();
  const edgeSeen = new Set<string>();
  const indexOf = (p: LatLon): number => {
    const key = nodeKey(p);
    const found = nodeIndex.get(key);
    if (found !== undefined) return found;
    nodes.push({ lat: p.lat, lon: p.lon });
    nodeIndex.set(key, nodes.length - 1);
    return nodes.length - 1;
  };
  for (const segment of segments) {
    let prev: number | null = null;
    for (const point of segment) {
      const i = indexOf(point);
      if (prev !== null && prev !== i) {
        const a = Math.min(prev, i);
        const b = Math.max(prev, i);
        const key = `${a}-${b}`;
        if (!edgeSeen.has(key)) {
          edgeSeen.add(key);
          edges.push({ a, b, nm: greatCircleNm(nodes[a] as LatLon, nodes[b] as LatLon) });
        }
      }
      prev = i;
    }
  }
  return { nodes, edges };
}

/** Closest node by great-circle distance; a tie goes to the lower index. */
export function nearestNode(graph: RouteGraph, p: LatLon): { node: number; nm: number } {
  let node = -1;
  let nm = Number.POSITIVE_INFINITY;
  graph.nodes.forEach((n, i) => {
    const d = greatCircleNm(p, n);
    if (d < nm) {
      nm = d;
      node = i;
    }
  });
  if (node < 0) throw new RouteError("off_network", "the sea network has no nodes");
  return { node, nm };
}

/** Binary min-heap of [distance, node], ordered by distance, then by node index. */
class NodeHeap {
  private readonly items: [number, number][] = [];

  get size(): number {
    return this.items.length;
  }

  private less(i: number, j: number): boolean {
    const a = this.items[i] as [number, number];
    const b = this.items[j] as [number, number];
    return a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
  }

  private swap(i: number, j: number): void {
    const t = this.items[i] as [number, number];
    this.items[i] = this.items[j] as [number, number];
    this.items[j] = t;
  }

  push(dist: number, node: number): void {
    this.items.push([dist, node]);
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.less(i, parent)) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  pop(): [number, number] {
    const top = this.items[0] as [number, number];
    const last = this.items.pop() as [number, number];
    if (this.items.length > 0) {
      this.items[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < this.items.length && this.less(l, m)) m = l;
        if (r < this.items.length && this.less(r, m)) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
}

/** Neighbour lists in edge order: adjacency[node] = [neighbour, edge][]. */
function adjacency(graph: RouteGraph): [number, number][][] {
  const adj: [number, number][][] = graph.nodes.map(() => []);
  graph.edges.forEach((e, i) => {
    adj[e.a]?.push([e.b, i]);
    adj[e.b]?.push([e.a, i]);
  });
  return adj;
}

function assertNode(graph: RouteGraph, node: number, what: string): void {
  if (!Number.isInteger(node) || node < 0 || node >= graph.nodes.length) {
    throw new RangeError(`${what} node ${node} is not in the graph`);
  }
}

/**
 * Dijkstra from `from` to `to` under `weight` (default: the edge's nm). Equal distances resolve to
 * the lower node index, both in visiting order and in the choice of predecessor. `nm` is always
 * the true length of the path found. Null when `to` cannot be reached.
 */
export function shortestPath(
  graph: RouteGraph,
  from: number,
  to: number,
  weight?: (edge: number) => number,
): { nodes: number[]; edges: number[]; nm: number } | null {
  assertNode(graph, from, "from");
  assertNode(graph, to, "to");
  const w = weight ?? ((e: number) => (graph.edges[e] as RouteGraph["edges"][number]).nm);
  const adj = adjacency(graph);
  const n = graph.nodes.length;
  const dist = new Array<number>(n).fill(Number.POSITIVE_INFINITY);
  const prevNode = new Array<number>(n).fill(-1);
  const prevEdge = new Array<number>(n).fill(-1);
  const done = new Array<boolean>(n).fill(false);
  dist[from] = 0;
  const heap = new NodeHeap();
  heap.push(0, from);
  while (heap.size > 0) {
    const [d, u] = heap.pop();
    if (done[u] || d > (dist[u] as number)) continue;
    done[u] = true;
    if (u === to) break;
    for (const [v, e] of adj[u] as [number, number][]) {
      if (done[v]) continue;
      const we = w(e);
      if (!(we >= 0)) throw new RangeError(`edge ${e} weight must be >= 0, got ${we}`);
      const nd = d + we;
      const dv = dist[v] as number;
      if (nd < dv) {
        dist[v] = nd;
        prevNode[v] = u;
        prevEdge[v] = e;
        heap.push(nd, v);
      } else if (nd === dv && u < (prevNode[v] as number)) {
        prevNode[v] = u;
        prevEdge[v] = e;
      }
    }
  }
  if (!done[to]) return null;
  const nodes: number[] = [to];
  const edges: number[] = [];
  let nm = 0;
  for (let v = to; v !== from; v = prevNode[v] as number) {
    const e = prevEdge[v] as number;
    edges.push(e);
    nm += (graph.edges[e] as RouteGraph["edges"][number]).nm;
    nodes.push(prevNode[v] as number);
  }
  nodes.reverse();
  edges.reverse();
  return { nodes, edges, nm };
}

export interface CandidateRouteOptions {
  /** Most routes to return (default 3). */
  max?: number;
  /** Weight multiplier per attempt for every edge used so far (default 1.6). */
  penalty?: number;
  /** A route is kept only if it shares less than this share of its length with each kept route (default 0.85). */
  maxOverlap?: number;
  /** A route is kept only if it is no longer than this × the shortest (default 1.35). */
  maxDetour?: number;
  /** Farthest (nm) start or end may be from the network (default 150). */
  maxSnapNm?: number;
  /**
   * Hazard zones to route round: an edge whose endpoint or midpoint lies inside one weighs
   * `HAZARD_EDGE_PENALTY` × its length in every search, so the path goes round whenever the
   * network allows (and through only when it does not).
   */
  avoid?: HazardZone[];
}

const routeLabel = (i: number): string =>
  i === 0 ? "Shortest sea route" : i === 1 ? "Alternative sea route" : `Alternative sea route ${i}`;

/**
 * Up to `max` distinct sea routes from `start` to `end`. The first is the shortest path between the
 * nodes nearest the two points. Each further attempt (at most 6) multiplies the weight of every
 * edge used by any path found so far by `penalty`, and keeps its path when it shares less than
 * `maxOverlap` of its graph length with each kept route and its true length is no more than
 * `maxDetour` × the shortest. Points are `[start, …node coordinates, end]`; ids are "A", "B", … in
 * order of true length (ties keep the order found).
 */
export function candidateRoutes(
  graph: RouteGraph,
  start: LatLon,
  end: LatLon,
  opts: CandidateRouteOptions = {},
): RouteCandidate[] {
  const max = opts.max ?? 3;
  const penalty = opts.penalty ?? 1.6;
  const maxOverlap = opts.maxOverlap ?? 0.85;
  const maxDetour = opts.maxDetour ?? 1.35;
  const maxSnapNm = opts.maxSnapNm ?? 150;
  if (!Number.isInteger(max) || max < 1) throw new RangeError("max must be an integer >= 1");

  const directNm = greatCircleNm(start, end);
  if (directNm <= SAME_POINT_NM) {
    throw new RouteError(
      "same_point",
      `start and end are ${directNm.toFixed(2)} nm apart; there is nothing to route`,
    );
  }
  const from = nearestNode(graph, start);
  const to = nearestNode(graph, end);
  for (const [what, snap] of [
    ["start", from],
    ["end", to],
  ] as const) {
    if (snap.nm > maxSnapNm) {
      throw new RouteError(
        "off_network",
        `the ${what} is ${snap.nm.toFixed(1)} nm from the sea network (limit ${maxSnapNm} nm)`,
      );
    }
  }
  const avoid = opts.avoid ?? [];
  const base = graph.edges.map((e) => {
    if (avoid.length === 0) return e.nm;
    const a = graph.nodes[e.a] as LatLon;
    const b = graph.nodes[e.b] as LatLon;
    const mid = { lat: (a.lat + b.lat) / 2, lon: (a.lon + b.lon) / 2 };
    const hit =
      zonesContaining(a, avoid).length > 0 ||
      zonesContaining(b, avoid).length > 0 ||
      zonesContaining(mid, avoid).length > 0;
    return hit ? e.nm * HAZARD_EDGE_PENALTY : e.nm;
  });
  const first = shortestPath(graph, from.node, to.node, (e) => base[e] as number);
  if (!first) throw new RouteError("no_path", "no sea route joins the start and the end");

  const toPoints = (nodes: number[]): LatLon[] => [
    { lat: start.lat, lon: start.lon },
    ...nodes.map((i) => {
      const n = graph.nodes[i] as LatLon;
      return { lat: n.lat, lon: n.lon };
    }),
    { lat: end.lat, lon: end.lon },
  ];
  type Kept = { points: LatLon[]; edges: Set<number>; trueNm: number };
  const shortestNm = polylineNm(toPoints(first.nodes));
  const kept: Kept[] = [
    { points: toPoints(first.nodes), edges: new Set(first.edges), trueNm: shortestNm },
  ];

  const weights = [...base];
  const used = new Array<boolean>(graph.edges.length).fill(false);
  for (const e of first.edges) used[e] = true;
  for (let attempt = 0; attempt < MAX_EXTRA_ATTEMPTS && kept.length < max; attempt++) {
    used.forEach((u, e) => {
      if (u) weights[e] = (weights[e] as number) * penalty;
    });
    const path = shortestPath(graph, from.node, to.node, (e) => weights[e] as number);
    if (!path) break;
    for (const e of path.edges) used[e] = true;
    const points = toPoints(path.nodes);
    const trueNm = polylineNm(points);
    if (trueNm > maxDetour * shortestNm) continue;
    const distinct = kept.every((k) => {
      if (!(path.nm > 0)) return false;
      let shared = 0;
      for (const e of path.edges) {
        if (k.edges.has(e)) shared += (graph.edges[e] as RouteGraph["edges"][number]).nm;
      }
      return shared / path.nm < maxOverlap;
    });
    if (distinct) kept.push({ points, edges: new Set(path.edges), trueNm });
  }

  return kept
    .map((k, found) => ({ k, found }))
    .sort((x, y) => x.k.trueNm - y.k.trueNm || x.found - y.found)
    .map(({ k }, i) => ({
      id: String.fromCharCode(65 + i),
      label: routeLabel(i),
      points: k.points,
    }));
}
