import type { AppModule, ModuleContext, Handle } from "@hato/sdk/types";
import { exportMcpTools } from "@hato/sdk/mcp";
import { LIBRARY_STATE, type LibraryItem, type LibraryMachine } from "@hato/sdk/library";

interface Entry { id: string; projectId: string | null; kind: "skill" | "agent" | "workflow"; name: string; description: string; revision: number; files: Record<string,string>;
  /** Global skills/agents: machines they are offered on (empty = all). */
  machines?: string[] }
let db: Handle;
let writes: Promise<any> = Promise.resolve();
let pendingWrites=0;
let mcp: ReturnType<typeof exportMcpTools>;
const summary = ({files, ...entry}: Entry) => ({ ...entry, paths: Object.keys(files).sort() });
function path(value: unknown): string {
  if(typeof value !== "string" || value.length > 240 || !/^[a-zA-Z0-9_. /-]+\.(md|sh|json)$/.test(value) || value.startsWith("/") || value.split("/").some(p => !p || p === "." || p === "..")) throw new Error("Use a relative .md, .sh or .json path without traversal");
  return value;
}
async function project(ctx: ModuleContext, a: any) {
  if(a.scope === "global") return null;
  if(a.scope !== "project") throw new Error("scope must be global or project");
  return (await ctx.modules.call("workspace", "resolve", {workspaceId:a.workspaceId})).projectId;
}
async function all(ctx: ModuleContext, a: any): Promise<Entry[]> {
  const projectId = await project(ctx,a);
  return (await ctx.host.db.query<any>(db,"SELECT data FROM entries WHERE project_id=?",[projectId || ""])).map(r=>JSON.parse(r.data));
}
async function read(ctx: ModuleContext, a: any) {
  const entry=(await all(ctx,a)).find(e=>e.id===a.id);
  if(!entry)throw new Error("Library entry not found in this scope");
  if(a.path !== undefined) {
    const key=path(a.path); if(!(key in entry.files))throw new Error("File not found");
    return { ...summary(entry), path:key, content:entry.files[key] };
  }
  return summary(entry);
}
function serialize<T>(f:()=>Promise<T>) { pendingWrites++;const next=writes.catch(()=>{}).then(f).finally(()=>{pendingWrites--;});writes=next;return next; }
async function save(ctx: ModuleContext,a:any) { return serialize(async()=>{
  const projectId=await project(ctx,a);
  const entries=await all(ctx,a), old=entries.find(e=>e.id===a.id);
  if(a.id && !old)throw new Error("Library entry not found in this scope");
  if((old?.revision ?? null)!==a.expectedRevision)throw new Error("Entry changed; reload before saving (expectedRevision required)");
  const entry:Entry=old?{...old,files:{...old.files}}:{id:crypto.randomUUID(),projectId,kind:a.kind,name:a.name,description:a.description||"",revision:0,files:{}};
  if(a.name !== undefined)entry.name=String(a.name).trim();
  if(a.description !== undefined)entry.description=String(a.description);
  if(a.machines !== undefined) {
    if(a.machines!==null&&(!Array.isArray(a.machines)||a.machines.length>100||a.machines.some((m:unknown)=>typeof m!=="string"||!m||m.length>200)))throw new Error("machines must be a list of machine ids, or null for all machines");
    if(projectId&&a.machines?.length)throw new Error("Machine availability applies to global entries only");
    entry.machines=a.machines?.length?[...new Set<string>(a.machines)].sort():[];
  }
  if(!entry.name || entry.name.length>120 || entry.description.length>1000 || !["skill","agent","workflow"].includes(entry.kind))throw new Error("Invalid name, description or kind");
  if(a.path !== undefined) {
    const key=path(a.path);
    if(a.content === null)delete entry.files[key];
    else { if(typeof a.content!=="string" || a.content.length>128*1024)throw new Error("File exceeds 128 KiB");entry.files[key]=a.content; }
  }
  const root=entry.kind==="skill"?"SKILL.md":entry.kind==="workflow"?"WORKFLOW.json":"AGENT.md";
  if(entry.kind==="workflow"&&entry.files[root]!==undefined){try{const d=JSON.parse(entry.files[root]);if(!d||typeof d!=="object"||!Array.isArray(d.blocks))throw 0;}catch{throw new Error("WORKFLOW.json must be a workflow definition");}}
  if(!old && !entry.files[root] && entry.kind==="workflow")throw new Error("A workflow entry needs its WORKFLOW.json definition");
  if(!old && !entry.files[root])entry.files[root]=(entry.kind==="skill"?`---\nname: ${JSON.stringify(entry.name.toLowerCase().replace(/[^a-z0-9-]+/g,"-").replace(/^-|-$/g,"")||"skill")}\ndescription: ${JSON.stringify(entry.description)}\n---\n\n`:"")+`# ${entry.name}\n\n${entry.description}\n`;
  if(!entry.files[root])throw new Error(`Keep the entry's ${root}`);
  if(Object.keys(entry.files).length>200 || JSON.stringify(entry).length>1024*1024)throw new Error("Entry exceeds 200 files or 1 MiB");
  entry.revision++;
  await ctx.host.db.exec(db,"INSERT INTO entries(id,project_id,data) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",[entry.id,projectId||"",JSON.stringify(entry)]);
  ctx.events.emit("library.changed",{projectId});void publish(ctx);return summary(entry);
}); }
async function remove(ctx:ModuleContext,a:any) {return serialize(async()=>{
  const entry=(await all(ctx,a)).find(e=>e.id===a.id);
  if(!entry)throw new Error("Library entry not found in this scope");
  if(entry.revision!==a.expectedRevision)throw new Error("Entry changed; reload before removing");
  await ctx.host.db.exec(db,"DELETE FROM entries WHERE id=?",[entry.id]);ctx.events.emit("library.changed",{projectId:entry.projectId});void publish(ctx);return {removed:true};
});}
// ---- Catalog published for chats and agents (state, so consumers need no call grant) ----------
const machines=new Map<string,string[]>();
let publishing=Promise.resolve();
function publish(ctx:ModuleContext) {
  publishing=publishing.catch(()=>{}).then(async()=>{
    const rows=await ctx.host.db.query<any>(db,"SELECT data FROM entries");
    const items:LibraryItem[]=[];
    for(const r of rows) {
      const e:Entry=JSON.parse(r.data);
      if(e.kind!=="skill"&&e.kind!=="agent")continue;
      const root=e.kind==="skill"?"SKILL.md":"AGENT.md";
      items.push({id:e.id,kind:e.kind,name:e.name,description:e.description,projectId:e.projectId||null,machines:e.machines||[],text:e.files[root]||"",paths:Object.keys(e.files).sort(),revision:e.revision});
    }
    ctx.state.set(LIBRARY_STATE,{items,machines:machineList()});
  });
  return publishing;
}
function machineList():LibraryMachine[] {
  const out=[...machines].map(([id,names])=>({id,label:id==="local"?"This computer":`${names.slice(0,3).join(", ")||"SSH"} (${id.replace(/^ssh:/,"")})`}));
  if(!machines.has("local"))out.unshift({id:"local",label:"This computer"});
  return out.sort((a,b)=>Number(b.id==="local")-Number(a.id==="local")||a.label.localeCompare(b.label));
}
/** Remember machines the user opens workspaces on so global entries can be limited to some of them. */
async function noteMachine(ctx:ModuleContext,ws:any) {
  const id=typeof ws?.machineId==="string"?ws.machineId:"";if(!id)return;
  const project=String(ws.name||"").split(" / ")[0].slice(0,80);
  const names=machines.get(id)||[];
  if(machines.has(id)&&(!project||names.includes(project)))return;
  const next=project?[...names.filter(n=>n!==project),project].slice(-5):names;
  machines.set(id,next);
  await ctx.host.db.exec(db,"INSERT INTO machines(id,names) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET names=excluded.names",[id,JSON.stringify(next)]);
  void publish(ctx);
}
const object=(properties:any,required:string[]=[])=>({type:"object",properties,required,additionalProperties:false});
const scope={scope:{type:"string",enum:["global","project"]}};
const mod:AppModule={
  id:"library",moduleApiVersion:1,
  async activate(ctx) {
    db=await ctx.host.db.openNamespace("library");
    await ctx.host.db.exec(db,"CREATE TABLE IF NOT EXISTS entries(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,data TEXT NOT NULL)");
    await ctx.host.db.exec(db,"CREATE TABLE IF NOT EXISTS machines(id TEXT PRIMARY KEY,names TEXT NOT NULL)");
    for(const r of await ctx.host.db.query<any>(db,"SELECT id,names FROM machines")){try{machines.set(r.id,JSON.parse(r.names));}catch{machines.set(r.id,[]);}}
    await publish(ctx);
    void noteMachine(ctx,ctx.state.get("workspace.selected"));
    ctx.state.watch("workspace.selected",(ws:any)=>{void noteMachine(ctx,ws);});
    const scoped=(a:any,s:any)=>({...a,workspaceId:s.workspaceId});
    mcp=exportMcpTools(ctx,"Library",[
      {name:"list",description:"List global or current-project skills and agent templates. Paginated metadata only; read an entry for file paths, then read individual files on demand.",inputSchema:object({...scope,offset:{type:"integer",minimum:0},limit:{type:"integer",minimum:1,maximum:50}},["scope"]),annotations:{readOnlyHint:true},handler:async(a,s)=>{
        const offset=a.offset??0,limit=a.limit??25;
        if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>50)throw new Error("Invalid page");
        const entries=(await all(ctx,scoped(a,s))).sort((a,b)=>a.id.localeCompare(b.id));
        return {entries:entries.slice(offset,offset+limit).map(({files,...entry})=>({...entry,fileCount:Object.keys(files).length})),nextOffset:offset+limit<entries.length?offset+limit:null};
      }},
      {name:"read",description:"Read one Library file (.md or .sh), or list entry paths if path is omitted. Scripts are stored as text; never executed by this tool.",inputSchema:object({...scope,id:{type:"string"},path:{type:"string"}},["scope","id"]),annotations:{readOnlyHint:true},handler:(a,s)=>read(ctx,scoped(a,s))},
      {name:"write",description:"Create an entry or edit one file/metadata. expectedRevision is null to create, otherwise the last read revision. content:null removes a nested file. Project scope is bound to this connection's project.",inputSchema:object({...scope,id:{type:"string"},kind:{type:"string",enum:["skill","agent","workflow"]},name:{type:"string"},machines:{type:["array","null"],items:{type:"string"},description:"Global entries only: machine ids it is offered on; [] or null for all"},description:{type:"string"},path:{type:"string"},content:{type:["string","null"]},expectedRevision:{type:["number","null"]}},["scope","expectedRevision"]),handler:(a,s)=>save(ctx,scoped(a,s))},
      {name:"remove",description:"Remove a Library entry and its files. Requires the last read revision.",inputSchema:object({...scope,id:{type:"string"},expectedRevision:{type:"number"}},["scope","id","expectedRevision"]),annotations:{destructiveHint:true},handler:(a,s)=>remove(ctx,scoped(a,s))},
    ]);
  },
  canSwap:()=>({ok:!pendingWrites&&(!mcp||!mcp.pending()),reason:"Library commands are running"}),
  async deactivate(){await writes;await publishing.catch(()=>{});},
  methods:{list:async(ctx,a)=>(await all(ctx,a)).map(summary),read,save,remove,
    /** Machines known to the Library, for availability pickers. */
    machines:()=>machineList()},
};
export default mod;
