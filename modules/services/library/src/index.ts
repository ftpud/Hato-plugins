import type { AppModule, ModuleContext, Handle } from "@hato/sdk/types";
import { exportMcpTools } from "@hato/sdk/mcp";

interface Entry { id: string; projectId: string | null; kind: "skill" | "agent"; name: string; description: string; revision: number; files: Record<string,string> }
let db: Handle;
let writes: Promise<any> = Promise.resolve();
let pendingWrites=0;
let mcp: ReturnType<typeof exportMcpTools>;
const summary = ({files, ...entry}: Entry) => ({ ...entry, paths: Object.keys(files).sort() });
function path(value: unknown): string {
  if(typeof value !== "string" || value.length > 240 || !/^[a-zA-Z0-9_. /-]+\.(md|sh)$/.test(value) || value.startsWith("/") || value.split("/").some(p => !p || p === "." || p === "..")) throw new Error("Use a relative .md or .sh path without traversal");
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
  if(!entry.name || entry.name.length>120 || entry.description.length>1000 || !["skill","agent"].includes(entry.kind))throw new Error("Invalid name, description or kind");
  if(a.path !== undefined) {
    const key=path(a.path);
    if(a.content === null)delete entry.files[key];
    else { if(typeof a.content!=="string" || a.content.length>128*1024)throw new Error("File exceeds 128 KiB");entry.files[key]=a.content; }
  }
  const root=entry.kind==="skill"?"SKILL.md":"AGENT.md";
  if(!old && !entry.files[root])entry.files[root]=(entry.kind==="skill"?`---\nname: ${JSON.stringify(entry.name.toLowerCase().replace(/[^a-z0-9-]+/g,"-").replace(/^-|-$/g,"")||"skill")}\ndescription: ${JSON.stringify(entry.description)}\n---\n\n`:"")+`# ${entry.name}\n\n${entry.description}\n`;
  if(!entry.files[root])throw new Error(`Keep the entry's ${root}`);
  if(Object.keys(entry.files).length>200 || JSON.stringify(entry).length>1024*1024)throw new Error("Entry exceeds 200 files or 1 MiB");
  entry.revision++;
  await ctx.host.db.exec(db,"INSERT INTO entries(id,project_id,data) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",[entry.id,projectId||"",JSON.stringify(entry)]);
  ctx.events.emit("library.changed",{projectId});return summary(entry);
}); }
async function remove(ctx:ModuleContext,a:any) {return serialize(async()=>{
  const entry=(await all(ctx,a)).find(e=>e.id===a.id);
  if(!entry)throw new Error("Library entry not found in this scope");
  if(entry.revision!==a.expectedRevision)throw new Error("Entry changed; reload before removing");
  await ctx.host.db.exec(db,"DELETE FROM entries WHERE id=?",[entry.id]);ctx.events.emit("library.changed",{projectId:entry.projectId});return {removed:true};
});}
const object=(properties:any,required:string[]=[])=>({type:"object",properties,required,additionalProperties:false});
const scope={scope:{type:"string",enum:["global","project"]}};
const mod:AppModule={
  id:"library",moduleApiVersion:1,
  async activate(ctx) {
    db=await ctx.host.db.openNamespace("library");
    await ctx.host.db.exec(db,"CREATE TABLE IF NOT EXISTS entries(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,data TEXT NOT NULL)");
    const scoped=(a:any,s:any)=>({...a,workspaceId:s.workspaceId});
    mcp=exportMcpTools(ctx,"Library",[
      {name:"list",description:"List global or current-project skills and agent templates. Paginated metadata only; read an entry for file paths, then read individual files on demand.",inputSchema:object({...scope,offset:{type:"integer",minimum:0},limit:{type:"integer",minimum:1,maximum:50}},["scope"]),annotations:{readOnlyHint:true},handler:async(a,s)=>{
        const offset=a.offset??0,limit=a.limit??25;
        if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>50)throw new Error("Invalid page");
        const entries=(await all(ctx,scoped(a,s))).sort((a,b)=>a.id.localeCompare(b.id));
        return {entries:entries.slice(offset,offset+limit).map(({files,...entry})=>({...entry,fileCount:Object.keys(files).length})),nextOffset:offset+limit<entries.length?offset+limit:null};
      }},
      {name:"read",description:"Read one Library file (.md or .sh), or list entry paths if path is omitted. Scripts are stored as text; never executed by this tool.",inputSchema:object({...scope,id:{type:"string"},path:{type:"string"}},["scope","id"]),annotations:{readOnlyHint:true},handler:(a,s)=>read(ctx,scoped(a,s))},
      {name:"write",description:"Create an entry or edit one file/metadata. expectedRevision is null to create, otherwise the last read revision. content:null removes a nested file. Project scope is bound to this connection's project.",inputSchema:object({...scope,id:{type:"string"},kind:{type:"string",enum:["skill","agent"]},name:{type:"string"},description:{type:"string"},path:{type:"string"},content:{type:["string","null"]},expectedRevision:{type:["number","null"]}},["scope","expectedRevision"]),handler:(a,s)=>save(ctx,scoped(a,s))},
      {name:"remove",description:"Remove a Library entry and its files. Requires the last read revision.",inputSchema:object({...scope,id:{type:"string"},expectedRevision:{type:"number"}},["scope","id","expectedRevision"]),annotations:{destructiveHint:true},handler:(a,s)=>remove(ctx,scoped(a,s))},
    ]);
  },
  canSwap:()=>({ok:!pendingWrites&&(!mcp||!mcp.pending()),reason:"Library commands are running"}),
  async deactivate(){await writes;},
  methods:{list:async(ctx,a)=>(await all(ctx,a)).map(summary),read,save,remove},
};
export default mod;
