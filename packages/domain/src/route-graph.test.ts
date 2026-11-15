import type { LatLon } from "@pharos/shared";
import { describe, expect, it } from "vitest";
import { greatCircleNm, polylineNm } from "./geo.js";
import {
  buildRouteGraph,
  candidateRoutes,
  nearestNode,
  RouteError,
  shortestPath,
} from "./route-graph.js";

const p = (lat: number, lon: number): LatLon => ({ lat, lon });

/*
 * Hand-built 6-node graph (1° of longitude on the equator = 3440.065 × π/180 = 60.0405 nm):
 *   n0 (0, 0)    n1 (0, 4.5)   n2 (0, 5)   n3 (0.1, 4.75)   n4 (1, 1.5)   n5 (1, 3.5)
 * Route "A": n0-n1-n2 = 270.182 + 30.020 = 300.202 nm.
 * Near-copy "X": n0-n1-n3-n2 = 270.182 + 16.166 + 16.166 = 302.515 nm; shares 270.182 / 302.515 = 89.3 % with A.
 * Disjoint "B": n0-n4-n5-n2 = 108.236 + 120.063 + 108.236 = 336.534 nm (1.12 × A, within the 1.35 detour).
 * Node indices follow first-seen order: A's segment, then X's, then B's.
 */
const N0 = p(0, 0);
const N1 = p(0, 4.5);
const N2 = p(0, 5);
const N3 = p(0.1, 4.75);
const N4 = p(1, 1.5);
const N5 = p(1, 3.5);
const SEG_A = [N0, N1, N2];
const SEG_X = [N1, N3, N2];
const SEG_B = [N0, N4, N5, N2];
const graph6 = () => buildRouteGraph([SEG_A, SEG_X, SEG_B]);

describe("buildRouteGraph", () => {
  it("dedupes nodes in first-seen order and adds one edge per consecutive pair", () => {
    const g = graph6();
    expect(g.nodes).toEqual([N0, N1, N2, N3, N4, N5]);
    expect(g.edges.map((e) => [e.a, e.b])).toEqual([
      [0, 1],
      [1, 2],
      [1, 3],
      [2, 3],
      [0, 4],
      [4, 5],
      [2, 5],
    ]);
    // n0-n1: 4.5° of longitude on the equator = 4.5 × 60.0405 = 270.182 nm.
    expect(g.edges[0]?.nm).toBeCloseTo(270.182073, 5);
  });

  it("drops duplicate edges (either direction) and points equal to 4 decimals", () => {
    const g = buildRouteGraph([
      [p(0, 0), p(0, 1)],
      [p(0, 1), p(0, 0)],
      [p(0.00001, 0), p(0, 1), p(0, 2)],
    ]);
    expect(g.nodes).toEqual([p(0, 0), p(0, 1), p(0, 2)]);
    expect(g.edges.map((e) => [e.a, e.b])).toEqual([
      [0, 1],
      [1, 2],
    ]);
  });

  it("drops a self-loop from consecutive points that round to one node", () => {
    const g = buildRouteGraph([[p(0, 0), p(0.00002, 0), p(0, 1)]]);
    expect(g.nodes).toHaveLength(2);
    expect(g.edges).toHaveLength(1);
  });

  it("is empty for no segments", () => {
    expect(buildRouteGraph([])).toEqual({ nodes: [], edges: [] });
  });
});

describe("nearestNode", () => {
  it("returns the closest node and its distance", () => {
    const g = graph6();
    const r = nearestNode(g, p(0.5, 1.5));
    // n4 (1, 1.5) is 0.5° of latitude away = 30.020 nm.
    expect(r.node).toBe(4);
    expect(r.nm).toBeCloseTo(30.02023, 5);
  });

  it("breaks a tie by the lower node index", () => {
    const g = buildRouteGraph([[p(0, 1), p(0, -1)]]);
    expect(nearestNode(g, p(0, 0)).node).toBe(0);
  });

  it("throws off_network on an empty graph", () => {
    expect(() => nearestNode(buildRouteGraph([]), p(0, 0))).toThrow(RouteError);
  });
});

describe("shortestPath", () => {
  it("finds n0-n1-n2 on the 6-node graph, 300.202 nm", () => {
    const g = graph6();
    const r = shortestPath(g, 0, 2);
    expect(r?.nodes).toEqual([0, 1, 2]);
    expect(r?.edges).toEqual([0, 1]);
    // 270.182073 + 30.020230 = 300.202304
    expect(r?.nm).toBeCloseTo(300.202304, 5);
  });

  it("reports the true length under a custom weight", () => {
    const g = graph6();
    // Make n1-n2 (edge 1) prohibitive: the path goes n0-n1-n3-n2 = 302.515 nm.
    const r = shortestPath(g, 0, 2, (e) => (e === 1 ? 1e9 : (g.edges[e]?.nm ?? 0)));
    expect(r?.nodes).toEqual([0, 1, 3, 2]);
    expect(r?.nm).toBeCloseTo(270.182073 + 2 * 16.166382, 5);
  });

  it("resolves equal distances to the lower node index", () => {
    // Two mirror-image paths (0,0)-(±1,1)-(0,2) of identical length.
    const g = buildRouteGraph([
      [p(0, 0), p(1, 1), p(0, 2)],
      [p(0, 0), p(-1, 1), p(0, 2)],
    ]);
    expect(shortestPath(g, 0, 2)?.nodes).toEqual([0, 1, 2]);
    expect(shortestPath(g, 2, 0)?.nodes).toEqual([2, 1, 0]);
  });

  it("is a single node for from = to and null when unreachable", () => {
    const g = buildRouteGraph([
      [p(0, 0), p(0, 1)],
      [p(10, 10), p(10, 11)],
    ]);
    expect(shortestPath(g, 1, 1)).toEqual({ nodes: [1], edges: [], nm: 0 });
    expect(shortestPath(g, 0, 3)).toBeNull();
  });

  it("rejects an out-of-range node", () => {
    expect(() => shortestPath(graph6(), 0, 6)).toThrow(RangeError);
  });

  it("rejects a negative weight", () => {
    expect(() => shortestPath(graph6(), 0, 2, () => -1)).toThrow(RangeError);
  });
});

describe("candidateRoutes", () => {
  const start = p(0, -0.5); // 30.020 nm west of n0
  const end = p(0, 5.5); // 30.020 nm east of n2

  it("returns the shortest path as A and the disjoint route as B", () => {
    const routes = candidateRoutes(graph6(), start, end);
    expect(routes.map((r) => r.id)).toEqual(["A", "B"]);
    expect(routes[0]?.points).toEqual([start, N0, N1, N2, end]);
    expect(routes[1]?.points).toEqual([start, N0, N4, N5, N2, end]);
    expect(routes[0]?.label).toBe("Shortest sea route");
    expect(routes[1]?.label).toBe("Alternative sea route");
    // A: 30.020 + 300.202 + 30.020 = 360.243 nm; B: 30.020 + 336.534 + 30.020 = 396.575 nm.
    expect(polylineNm(routes[0]?.points ?? [])).toBeCloseTo(360.242765, 5);
    expect(polylineNm(routes[1]?.points ?? [])).toBeCloseTo(396.574441, 5);
  });

  it("rejects a third route that shares 90 % with A", () => {
    // Without B the search finds X (89.3 % shared with A) at every further attempt.
    const g = buildRouteGraph([SEG_A, SEG_X]);
    expect(candidateRoutes(g, start, end).map((r) => r.id)).toEqual(["A"]);
    // The same X is kept once the overlap limit is above 89.3 %.
    const loose = candidateRoutes(g, start, end, { maxOverlap: 0.95 });
    expect(loose.map((r) => r.points)).toEqual([
      [start, N0, N1, N2, end],
      [start, N0, N1, N3, N2, end],
    ]);
  });

  it("rejects a route longer than maxDetour × the shortest", () => {
    // B is 396.575 / 360.243 = 1.10 × A.
    expect(candidateRoutes(graph6(), start, end, { maxDetour: 1.05 }).map((r) => r.id)).toEqual([
      "A",
    ]);
  });

  it("returns at most `max` routes", () => {
    expect(candidateRoutes(graph6(), start, end, { max: 1 })).toHaveLength(1);
  });

  it("names routes in order of true length, not the order found", () => {
    /*
     * s (0,0) - m (0,2) - e (0,4): A = 120.081 + 120.081 = 240.162 nm.
     * P1 = s - r (1.5, 2) - e = 150.090 + 150.090 = 300.180 nm, disjoint from A.
     * P2 = s - m - q (-0.75, 3) - e = 120.081 + 75.049 + 75.049 = 270.179 nm, shares 44 % with A.
     * Attempt 1 (A's edges × 1.6): A 384.26, P2 1.6 × 120.081 + 150.098 = 342.23, P1 300.18 → P1.
     * Attempt 2 (A × 2.56, P1 × 1.6): A 614.81, P2 2.56 × 120.081 + 150.098 = 457.51, P1 480.29 → P2.
     * Found order A, P1, P2; by length A, P2, P1.
     */
    const s = p(0, 0);
    const m = p(0, 2);
    const e = p(0, 4);
    const q = p(-0.75, 3);
    const r = p(1.5, 2);
    const g = buildRouteGraph([
      [s, m, e],
      [s, r, e],
      [m, q, e],
    ]);
    const routes = candidateRoutes(g, s, e);
    expect(routes.map((x) => [x.id, x.label])).toEqual([
      ["A", "Shortest sea route"],
      ["B", "Alternative sea route"],
      ["C", "Alternative sea route 2"],
    ]);
    expect(routes.map((x) => x.points)).toEqual([
      [s, s, m, e, e],
      [s, s, m, q, e, e],
      [s, s, r, e, e],
    ]);
  });

  it("is deterministic", () => {
    const a = candidateRoutes(graph6(), start, end);
    const b = candidateRoutes(structuredClone(graph6()), start, end);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  describe("unroutable inputs throw RouteError", () => {
    const codeOf = (fn: () => unknown): string | null => {
      try {
        fn();
        return null;
      } catch (e) {
        return e instanceof RouteError ? e.code : `not a RouteError: ${String(e)}`;
      }
    };

    it("off_network: a start 400 nm from any node", () => {
      // (0, -6.67): 6.67 × 60.0405 = 400.47 nm from n0, the nearest node.
      const far = p(0, -6.67);
      expect(greatCircleNm(far, N0)).toBeGreaterThan(400);
      expect(codeOf(() => candidateRoutes(graph6(), far, end))).toBe("off_network");
      expect(codeOf(() => candidateRoutes(graph6(), start, p(0, 11.7)))).toBe("off_network");
    });

    it("no_path: two disconnected components", () => {
      const g = buildRouteGraph([
        [p(0, 0), p(0, 1)],
        [p(5, 0), p(5, 1)],
      ]);
      expect(codeOf(() => candidateRoutes(g, p(0, 0.5), p(5, 0.5)))).toBe("no_path");
    });

    it("same_point: start equal to end (or within 1 nm)", () => {
      expect(codeOf(() => candidateRoutes(graph6(), start, start))).toBe("same_point");
      // 0.01° of latitude = 0.6 nm.
      expect(codeOf(() => candidateRoutes(graph6(), start, p(0.01, -0.5)))).toBe("same_point");
    });
  });
});
