/** Topological Git graph. A lane holds the next ancestor expected on that branch. */
export function commitGraph(commits: { id: string; parents: string[] }[]): Map<string, string> {
  let lanes: string[] = [];
  let maxWidth = 40;
  const result = new Map<string, string>();
  const x = (lane: number) => 8 + lane * 12;
  for (const commit of commits) {
    let lane = lanes.indexOf(commit.id);
    if (lane < 0) { lane = lanes.length; lanes.push(commit.id); }
    const before = [...lanes];
    lanes.splice(lane, 1);
    let at = lane;
    for (const parent of commit.parents) if (!lanes.includes(parent)) lanes.splice(at++, 0, parent);
    const lines: string[] = [];
    for (let i = 0; i < before.length; i++) {
      if (i === lane) {
        lines.push(`<path d="M${x(i)} 0V24"/>`);
        for (const parent of commit.parents) lines.push(`<path d="M${x(i)} 24C${x(i)} 40 ${x(lanes.indexOf(parent))} 40 ${x(lanes.indexOf(parent))} 58"/>`);
      } else {
        const next = lanes.indexOf(before[i]);
        lines.push(`<path opacity=".55" d="M${x(i)} 0C${x(i)} 30 ${x(next)} 30 ${x(next)} 58"/>`);
      }
    }
    const width = Math.max(40, x(Math.max(before.length, lanes.length)));
    maxWidth = Math.max(maxWidth, width);
    result.set(commit.id, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 58" fill="none" stroke="currentColor" stroke-width="2">${lines.join("")}<circle cx="${x(lane)}" cy="24" r="4" fill="currentColor" stroke="none"/></svg>`);
  }
  for (const [id, svg] of result) result.set(id, svg.replace(/viewBox="0 0 \d+ 58"/, `viewBox="0 0 ${maxWidth} 58" preserveAspectRatio="none"`));
  return result;
}
