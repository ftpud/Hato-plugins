/** Only send referenced values when they changed in this provider session. */
export function referenceUpdates(prompt: string, outputs: Map<string,string>, previous: Record<string,string> = {}) {
  const values: Record<string,string> = {};
  const changed: string[] = [];
  let budget=16000;
  const refs=[...new Set([...prompt.matchAll(/\{\{\s*blocks\.([A-Za-z0-9_-]+)\.output\s*\}\}/g)].map(m=>m[1]))];
  for(const ref of refs) {
    if(budget<=0)break;
    const raw=outputs.get(ref)??"";
    const value=raw.slice(0,Math.min(4000,budget));budget-=value.length+ref.length+4;
    values[ref]=value;
    if(previous[ref]!==value)changed.push(`${ref}: ${value}`);
  }
  return {values,text:changed.length?`\n\nWorkflow context updates:\n${changed.join("\n")}`:""};
}
