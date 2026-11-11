/** Topological Git graph, one SVG per commit row. A lane holds the next commit expected on that
 *  branch; a lane's branch identity and color pass to its first parent, so a branch stays one
 *  traceable, highlightable line while it shifts sideways. */
export interface GraphCommit { id: string; parents: string[]; refs?: string; subject?: string }
export interface CommitGraph {
  svgs: Map<string, string>; width: number; height: number;
  /** Branch line each commit sits on. */
  branchOf: Map<string, number>;
  /** Display name of a branch line: the refs at its tip, when it has any. */
  branchName: Map<number, string>;
  /** Every branch and tag whose history contains the commit. */
  containedIn: Map<string, string[]>;
}

/** Distinct hues that read on both light and dark backgrounds. */
const COLORS = ["#5b6cf0", "#2fa36b", "#e5534b", "#d89620", "#a259d9", "#1e9bd7", "#d9488f", "#7a8b99"];
const PAD = 9, SPACING = 14, MIN_WIDTH = 28, MAX_WIDTH = 220, DIM = 0.22;

/** `%D` decorations → short names: "HEAD -> main, origin/main, tag: v1" → ["main", "origin/main", "v1"]. */
export function refNames(decoration = ""): string[] {
  return decoration.split(",").map((r) => r.trim().replace(/^HEAD -> /, "").replace(/^tag: /, "").replace(/^refs\/(heads|remotes|tags)\//, ""))
    .filter((r) => r && r !== "HEAD");
}

type Lane = { id: string; branch: number };

/** Name of the branch a merge brought in, from Git's and hosting services' default messages. */
export function mergedBranch(subject = ""): string | null {
  const m = /^Merge (?:remote-tracking )?branch '([^']+)'/.exec(subject) || /^Merge pull request #\d+ from (\S+)/.exec(subject) || /^Merged? in (\S+)/.exec(subject);
  return m ? m[1] : null;
}
type Edge = { x1: number; y1: number; x2: number; y2: number; branch: number };

/** Lane layout only; `commitGraph` draws it, optionally highlighting one branch line. */
export function layoutGraph(commits: GraphCommit[], height = 58) {
  const rows: { id: string; lane: number; branch: number; edges: Edge[] }[] = [];
  const branchName = new Map<number, string>();
  const namedByRef = new Set<number>();
  let lanes: Lane[] = [], branches = 0, maxLanes = 1;
  const mid = height / 2;
  for (const commit of commits) {
    let lane = lanes.findIndex((l) => l.id === commit.id);
    const isTip = lane < 0;
    if (isTip) { lane = lanes.length; lanes.push({ id: commit.id, branch: branches++ }); }
    const before = lanes.slice();
    const branch = before[lane].branch;
    const names = refNames(commit.refs);
    // Real refs beat a name guessed from a merge message; the first (newest) refs on a line win.
    if (names.length && !namedByRef.has(branch)) { branchName.set(branch, names.join(", ")); namedByRef.add(branch); }
    const after = before.slice();
    after.splice(lane, 1);
    const parentEdges: { lane: Lane; joins: boolean }[] = [];
    let insert = lane;
    commit.parents.forEach((parent, i) => {
      const existing = after.find((l) => l.id === parent);
      if (existing) { parentEdges.push({ lane: existing, joins: true }); return; }
      const l = { id: parent, branch: i === 0 ? branch : branches++ };
      const merged = i > 0 ? mergedBranch(commit.subject) : null;
      if (merged) branchName.set(l.branch, merged);
      after.splice(insert++, 0, l);
      parentEdges.push({ lane: l, joins: false });
    });
    const edges: Edge[] = [];
    before.forEach((l, i) => {
      if (i === lane) { if (!isTip) edges.push({ x1: i, y1: 0, x2: i, y2: mid, branch }); return; }
      edges.push({ x1: i, y1: 0, x2: after.indexOf(l), y2: height, branch: l.branch });
    });
    // A merged-in parent's line belongs to that parent's branch; a join belongs to this branch.
    for (const p of parentEdges) edges.push({ x1: lane, y1: mid, x2: after.indexOf(p.lane), y2: height, branch: p.joins ? branch : p.lane.branch });
    rows.push({ id: commit.id, lane, branch, edges });
    maxLanes = Math.max(maxLanes, before.length, after.length);
    lanes = after;
  }
  // Commits arrive children-first, so containment flows from each row to its parents.
  const contained = new Map<string, Set<string>>();
  for (const c of commits) {
    const set = contained.get(c.id) || new Set<string>();
    for (const name of refNames(c.refs)) set.add(name);
    contained.set(c.id, set);
    for (const p of c.parents) {
      const parent = contained.get(p) || new Set<string>();
      for (const name of set) parent.add(name);
      contained.set(p, parent);
    }
  }
  // Grow with the number of lanes; compress spacing only past the cap.
  const natural = PAD * 2 + (maxLanes - 1) * SPACING;
  const width = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, natural));
  const spacing = maxLanes > 1 ? Math.min(SPACING, (width - PAD * 2) / (maxLanes - 1)) : SPACING;
  return { rows, width, spacing, branchName, containedIn: new Map([...contained].map(([id, s]) => [id, [...s]])) };
}

export function commitGraph(commits: GraphCommit[], height = 58, highlight: number | null = null): CommitGraph {
  const g = layoutGraph(commits, height);
  const x = (lane: number) => +(PAD + lane * g.spacing).toFixed(2);
  const color = (branch: number) => COLORS[branch % COLORS.length];
  const look = (branch: number) => highlight === null ? "" : branch === highlight ? ' stroke-width="3"' : ` opacity="${DIM}"`;
  const path = (e: Edge) => {
    const [x1, x2] = [x(e.x1), x(e.x2)];
    if (x1 === x2) return `M${x1} ${e.y1}V${e.y2}`;
    const bend = (e.y2 - e.y1) / 2;
    return `M${x1} ${e.y1}C${x1} ${e.y1 + bend} ${x2} ${e.y2 - bend} ${x2} ${e.y2}`;
  };
  const svgs = new Map<string, string>();
  const branchOf = new Map<string, number>();
  for (const r of g.rows) {
    branchOf.set(r.id, r.branch);
    const lines = r.edges.map((e) => `<path stroke="${color(e.branch)}"${look(e.branch)} d="${path(e)}"/>`).join("");
    const dot = `<circle cx="${x(r.lane)}" cy="${height / 2}" r="${highlight === r.branch ? 5.5 : 4.5}" fill="${color(r.branch)}"${highlight !== null && highlight !== r.branch ? ` opacity="${DIM}"` : ""}/>`;
    svgs.set(r.id, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${g.width} ${height}" width="${g.width}" height="${height}" fill="none" stroke-width="2" stroke-linecap="round">${lines}${dot}</svg>`);
  }
  return { svgs, width: g.width, height, branchOf, branchName: g.branchName, containedIn: g.containedIn };
}
