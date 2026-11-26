import { captureEnabled, capturedChanges, capturedTranscript } from "@hato/sdk/change-capture";
import { providerProfiles } from "@hato/sdk/agent-providers";
import { hasWorkingSubagents, subagentList, trackFinishedSubagents, type AcpSubagent, type FinishedSubagents } from "@hato/sdk/acp-subagents";
import type { AppModule, ModuleContext, DaemonTarget } from "@hato/sdk/types";
import { daemonTargetFor, errMsg, workspaceGrant, type WorkspaceDescriptor } from "@hato/sdk/runtime";
import { workspaceSkills } from "../../files/src/skills";
import { agentActivity, agentSettings, autoAgentName, isAutoAgentName, relativeAgentPath, type AgentMcp, type AgentSession, type AgentSpec, type WorkingAgent } from "@hato/sdk/persistent-agents";
import { imageAttachments } from "@hato/sdk/images";
import { epochOf, promptTurns, type PromptEntry } from "@hato/sdk/prompt-history";
import { exportMcpTools } from "@hato/sdk/mcp";
import { acpServer, transportOf, validateMcp } from "@hato/sdk/mcp-servers";
import { LIBRARY_STATE, isLibraryRef, libraryCatalog, libraryInstructions, libraryItemsFor, libraryRef, libraryRefId, textDigest } from "@hato/sdk/library";

const activityCache=new Map<string,{revision:number;status:string;text:string}>();
const daemonInfo=new Map<string,{bin:string;dir:string}>();
const prepared=new Map<string,Promise<DaemonTarget>>();
async function target(ctx:ModuleContext,workspaceId:string):Promise<DaemonTarget> {
  const d:WorkspaceDescriptor=await ctx.modules.call("workspace","resolve",{workspaceId});
  let pending=prepared.get(d.machineId);
  if(!pending) {
    pending=(async()=>{
      const t=await daemonTargetFor(ctx,d);
      const info=await ctx.host.daemon.ensure(t);daemonInfo.set(d.machineId,{bin:info.bin,dir:info.dir});
      const result=await ctx.host.daemon.request(t,"plugins.list");
      const mcp=result.plugins.find((p:any)=>p.id==="internal-remote-mcp");
      if(!mcp?.active)await ctx.host.daemon.request(t,"plugins.push",{id:"internal-remote-mcp"});
      const runtime=result.plugins.find((p:any)=>p.id==="agent-runner");
      // Never push-replace a running runtime: daemon plugin replacement unloads its processes.
      // Updating the runtime is a separate maintenance operation after stopping its sessions.
      if(!runtime?.active) {
        const pushed=await ctx.host.daemon.request(t,"plugins.push",{id:"agent-runner"});
        if(!pushed.active)throw new Error(pushed.error||"Agent runtime did not activate");
      }
      return t;
    })();
    prepared.set(d.machineId,pending);
    // Task requests and agent activity live on daemons this desktop has connected to; poll once there is one.
    if(!daemonPoll){daemonPoll=setInterval(()=>{void pollDaemons(ctx);},2000);(daemonPoll as any).unref?.();}
    void pending.catch(()=>{prepared.delete(d.machineId);});
  }
  return pending;
}
async function invoke(ctx:ModuleContext,workspaceId:string,method:string,args:any={}) {
  const t=await target(ctx,workspaceId);
  try {return await ctx.host.daemon.request(t,"modules.call",{target:"agent-runner",method,args,timeoutMs:180000});}
  catch(e) {
    // An older runtime keeps running until its agents stop; Hato never replaces a busy runtime.
    if((e as any)?.code==="ENOMETHOD"||/has no method/.test(String((e as any)?.message||e)))
      throw new Error("This machine's background agent runtime is older than Hato and lacks this setting. Use “Update runtime” in the chat settings (or Force update in the Remote runtime panel), then try again.");
    const d=await ctx.modules.call("workspace","resolve",{workspaceId});prepared.delete(d.machineId);throw e;
  }
}
async function mcps(ctx:ModuleContext):Promise<AgentMcp[]> {
  return await ctx.modules.call("persistence","settings.get",{key:"persistent-agents.mcps"})||[];
}
const builtInMcps=[
  {id:"internal-remote-mcp",name:"Workspace tools",builtin:true,description:"Daemon-hosted background agent, terminal and selected-skill tools. Works without the desktop."},
  {id:"internal-remote-mcp-local",name:"Local workspace tools",builtin:true,description:"Workspace tools for ordinary local desktop terminals. Available to local workspaces while the desktop is open."},
  {id:"internal-local-mcp",name:"Desktop tools",builtin:true,description:"UI and application module tools. Requires the desktop to remain open."},
];
let mcpWrites:Promise<any>=Promise.resolve();
function editMcps(ctx:ModuleContext,edit:(list:AgentMcp[])=>AgentMcp[]) {
  const next=mcpWrites.catch(()=>{}).then(async()=>{
    const value=edit(await mcps(ctx));
    await ctx.modules.call("persistence","settings.set",{key:"persistent-agents.mcps",value});
    ctx.events.emit("persistent-agents.mcpsChanged",{});
  });mcpWrites=next;return next;
}
/** Fresh `Authorization` values for the OAuth servers in `list` (refreshing tokens when needed). */
async function oauthHeaders(ctx:ModuleContext,list:AgentMcp[]):Promise<Record<string,string>> {
  const out:Record<string,string>={};
  for(const m of list)if(transportOf(m)!=="stdio"&&m.auth?.type==="oauth") {
    try{out[m.id]=await ctx.modules.call("mcp-auth","authorization",{serverId:m.id,url:m.url},{timeoutMs:60000});}
    catch(e){throw new Error(`MCP server “${m.name}” needs you to sign in: open MCP servers and choose Sign in (${e instanceof Error?e.message:String(e)})`);}
  }
  return out;
}
async function catalog(ctx:ModuleContext,workspaceId:string) {
  const d:WorkspaceDescriptor=await ctx.modules.call("workspace","resolve",{workspaceId});
  const profiles=(await providerProfiles(ctx)).filter((p:any)=>p.enabled&&(p.machineId==="*"||p.machineId===d.machineId));
  // Library skills/agents come from the optional Library plugin's published catalog (no call grant needed).
  const library=ctx.state.get(LIBRARY_STATE);
  const libraryText=new Map<string,string>();
  const fromLibrary=(kind:"skill"|"agent")=>libraryItemsFor(library,d,kind).map(i=>{
    libraryText.set(libraryRef(i.id),libraryInstructions(i));
    return {name:i.name,description:i.description,path:libraryRef(i.id),source:i.projectId?"library-project":"library-global"};
  });
  const workspaceEntries=d.location==="cloud"?[]:await workspaceSkills(ctx,d);
  const skills=[...workspaceEntries.map(s=>({...s,source:"workspace"})),...fromLibrary("skill")];
  const agentFiles:{name:string;path:string}[]=[];
  if(d.location!=="cloud") {
    const grant=await workspaceGrant(ctx,d,"fs");
    try {if((await ctx.host.fs.stat(grant.grant,"AGENTS.md")).kind==="file")agentFiles.push({name:"AGENTS.md",path:"AGENTS.md"});}catch{}
    for(const dir of [".agents/agents",".claude/agents"]) {
      let entries;try{entries=(await ctx.host.fs.list(grant.grant,dir)).entries;}catch{continue;}
      for(const e of entries)if(e.kind==="file"&&e.name.endsWith(".md"))agentFiles.push({name:e.name,path:`${dir}/${e.name}`});
    }
  }
  agentFiles.push(...fromLibrary("agent").map(a=>({name:`Library · ${a.name}`,path:a.path})));
  return {workspace:d,profiles,skills,agentFiles,libraryText,mcps:[
    {id:"internal-remote-mcp",name:"Workspace tools (background agents and terminals)"},
    ...(d.location==="local"?[{id:"internal-remote-mcp-local",name:"Workspace tools · local desktop terminals (online only)"}]:[]),
    ...(d.location==="cloud"?[]:[{id:"internal-local-mcp",name:"Desktop tools (requires desktop online)"}]),...(await mcps(ctx)).filter(m=>m.enabled!==false)]};
}
function libraryInline(c:Awaited<ReturnType<typeof catalog>>,paths:(string|null)[]) {
  const inline:Record<string,string>={};
  for(const p of paths)if(isLibraryRef(p)){const text=c.libraryText.get(p);if(text===undefined)throw new Error("A selected Library entry is not available on this machine");inline[p]=text;}
  return inline;
}
/** MCP selection ids of an existing agent, as offered by `catalog`. */
const agentMcpIds=(s:AgentSpec)=>[...(s.workspaceMcp?["internal-remote-mcp"]:[]),...s.mcps.map(m=>m.id)];
/** Validate selections before connecting to their MCP servers or starting a provider. */
function agentSelection(c:Awaited<ReturnType<typeof catalog>>,a:any) {
  const profile=c.profiles.find((p:any)=>p.id===a.profileId);if(!profile)throw new Error("Select an enabled provider for this machine");
  const skills=(Array.isArray(a.skills)?a.skills:[]).map(relativeAgentPath);
  if(skills.some((p:string)=>!c.skills.some(s=>s.path===p)))throw new Error("Selected skill is no longer available");
  const agentFile=a.agentFile?relativeAgentPath(a.agentFile):null;
  if(agentFile&&!c.agentFiles.some(f=>f.path===agentFile))throw new Error("Selected agent file is no longer available");
  const ids:string[]=Array.isArray(a.mcps)?a.mcps:[];
  if(ids.some(id=>!c.mcps.some(m=>m.id===id)))throw new Error("Unknown MCP server");
  return {profile,model:String(a.model||""),agentFile,skills,ids};
}
async function agentConfig(ctx:ModuleContext,c:Awaited<ReturnType<typeof catalog>>,selection:ReturnType<typeof agentSelection>,sessionId:string) {
  const {profile,model,agentFile,skills,ids}=selection;
  // Library entries are not workspace files: the runtime receives their text with the configuration.
  const inline=libraryInline(c,[agentFile,...skills]);
  await target(ctx,c.workspace.id);
  const chosen=(await mcps(ctx)).filter(m=>m.enabled!==false&&ids.includes(m.id));
  const auth=await oauthHeaders(ctx,chosen);
  // Agents receive ACP-shaped entries; OAuth servers carry a short-lived token refreshed on reconnect.
  const servers:any[]=chosen.map(m=>({id:m.id,...acpServer(m,auth[m.id])}));
  servers.push(...await desktopEndpoints(ctx,c.workspace.id,sessionId,ids,[agentFile,...skills],inline));
  return {profile,model,agentFile,skills,mcps:servers,workspaceMcp:ids.includes("internal-remote-mcp"),inline};
}
/** Servers hosted by this desktop. Their loopback port and token live only as long as the desktop
 *  process, so every connect after a desktop restart needs freshly issued entries. */
const DESKTOP_MCP_IDS=["internal-remote-mcp-local","internal-local-mcp"];
async function desktopEndpoints(ctx:ModuleContext,workspaceId:string,sessionId:string,ids:string[],skillPaths:(string|null)[],inline:Record<string,string>) {
  const servers:any[]=[];
  if(ids.includes("internal-remote-mcp-local")) {
    const endpoint=await ctx.modules.call("internal-remote-mcp","endpoint",{workspaceId,sessionId,skills:[...new Set(skillPaths.filter(Boolean))],inline});
    servers.push({...endpoint,id:"internal-remote-mcp-local",name:"internal-remote-mcp-local"});
  }
  if(ids.includes("internal-local-mcp")) {
    const endpoint=await ctx.modules.call("internal-local-mcp","endpoint",{conversationId:sessionId,workspaceId});
    servers.push({id:"internal-local-mcp",...endpoint.server});
  }
  return servers;
}
// Git task requests from background agents' workspace MCP. The project always comes from the
// agent's own workspace. Creating a task or starting an agent in one needs the user's native
// approval unless the requesting agent runs on autopilot.
const clip=(v:any,n:number)=>typeof v==="string"?v.trim().slice(0,n):"";
function agentRequest(a:any) {
  if(a==null)return null;
  const prompt=clip(a.prompt,128*1024);
  if(!prompt)throw new Error("A background agent needs a prompt");
  return {name:clip(a.name,120)||"Task agent",prompt,model:clip(a.model,200)};
}
async function approve(ctx:ModuleContext,session:any,title:string,detail:string,allowLabel:string,operation:string,timeoutMs=9*60*1000) {
  if(session.autopilot)return;
  const decision=await ctx.host.approvals.request({title:`${session.name}: ${title}`,detail,operation,timeoutMs,
    options:[{id:"allow",label:allowLabel,kind:"allow"},{id:"deny",label:"Deny",kind:"deny"}]});
  if(decision.optionId!=="allow")throw new Error(decision.expired?"The request was not approved in time":`The user denied: ${title}`);
}

async function createAgent(ctx:ModuleContext,c:Awaited<ReturnType<typeof catalog>>,a:any,selection:ReturnType<typeof agentSelection>,id:string,fromChat=false) {
  const config=await agentConfig(ctx,c,selection,id);
  const subscription=await ctx.modules.call("persistence","settings.get",{key:"acp.claude.useSubscription"});
  const policy=a.approvalPolicy==="autopilot"?"autopilot":a.approvalPolicy==="auto-low"?"auto-low":"ask";
  const settings=agentSettings(a.settings);
  const spec:AgentSpec={id,name:String(a.name||"Agent").trim().slice(0,120),customName:a.autoName!==true&&!!String(a.name||"").trim(),workspaceId:c.workspace.id,workspaceName:c.workspace.name,root:c.workspace.rootAbsolutePath,machineId:c.workspace.machineId,
    ...config,claudeSubscription:subscription!==false,daemon:daemonInfo.get(c.workspace.machineId),
    ...(fromChat&&policy!=="ask"?{autopilot:policy==="autopilot",approvalPolicy:policy==="auto-low"?"auto-low" as const:undefined}:{}),
    ...(Object.keys(settings).length?{settings}:{})};
  return invoke(ctx,c.workspace.id,"create",{spec});
}

async function readyWorkspace(ctx:ModuleContext,workspaceId:unknown) {
  if(typeof workspaceId!=="string"||!workspaceId)throw new Error("workspace_id is required");
  const d=await ctx.modules.call<WorkspaceDescriptor>("workspace","resolve",{workspaceId});
  if(d.taskId&&d.status!=="ready")throw new Error(`Task worktree is ${d.status}; reconcile it first`);
  return d;
}

function desktopAgentTools(ctx:ModuleContext) {
  const object=(properties:Record<string,unknown>,required:string[])=>({type:"object",properties,required,additionalProperties:false});
  const workspaceId={type:"string",description:"Target workspace ID: task:<taskId> from persistent-agents__list_tasks or project:<projectId>:root from a project ID."};
  const selectionList={type:"array",items:{type:"string"},maxItems:32};
  return exportMcpTools(ctx,"Background agents",[
    {name:"list_tasks",title:"List tasks in any project",description:"Find the task workspace IDs for a registered project.",
      inputSchema:object({project_id:{type:"string",description:"Project ID from projects__list."}},["project_id"]),annotations:{readOnlyHint:true},
      async handler(a,scope) {
        await ctx.modules.call("workspace","resolve",{workspaceId:scope.workspaceId});
        if(typeof a.project_id!=="string"||!a.project_id)throw new Error("project_id is required");
        const d=await readyWorkspace(ctx,`project:${a.project_id}:root`);
        const tasks=await ctx.modules.call<any[]>("git-tasks","list",{projectId:d.projectId});
        return tasks.map(t=>({id:t.id,workspaceId:`task:${t.id}`,name:t.name,branch:t.branch,status:t.status}));
      }},
    {name:"options",title:"View background agent configuration options",description:"List provider profiles, instruction files, skills and MCP server IDs available in the target workspace.",
      inputSchema:object({workspace_id:workspaceId},["workspace_id"]),annotations:{readOnlyHint:true},timeoutMs:120000,
      async handler(a,scope) {
        await ctx.modules.call("workspace","resolve",{workspaceId:scope.workspaceId});
        const d=await readyWorkspace(ctx,a.workspace_id);
        const c=await catalog(ctx,d.id);
        return {workspaceId:d.id,projectId:d.projectId,name:d.name,machineId:d.machineId,agentFiles:c.agentFiles,skills:c.skills,
          profiles:c.profiles.map((p:any)=>({id:p.id,name:p.name,provider:p.provider})),mcps:c.mcps.map(m=>({id:m.id,name:m.name}))};
      }},
    {name:"start",title:"Start a background agent in a workspace",description:"Create a background agent in an explicit project or task workspace and send its first prompt after the user's approval. Use persistent-agents__options to discover IDs for its provider, instructions, skills and MCP servers.",
      inputSchema:object({workspace_id:workspaceId,prompt:{type:"string",minLength:1,maxLength:128*1024},
        name:{type:"string",maxLength:120},profile_id:{type:"string"},model:{type:"string",maxLength:200},
        agent_file:{type:"string",description:"Instruction path from the target options."},skills:selectionList,
        mcp_ids:{...selectionList,description:"MCP server IDs from the target options. Defaults to Workspace tools; pass [] to omit MCP servers."},
        settings:{type:"object",description:"Provider configuration option IDs and values.",additionalProperties:{type:["string","boolean"]},maxProperties:32},
      },["workspace_id","prompt","profile_id"]),timeoutMs:180000,
      async handler(a,scope) {
        if(typeof a.prompt!=="string"||!a.prompt.trim()||a.prompt.length>128*1024)throw new Error("A prompt of up to 128 Ki characters is required");
        if(typeof a.profile_id!=="string"||!a.profile_id)throw new Error("profile_id is required");
        for(const value of [a.skills,a.mcp_ids]) {
          if(value!==undefined&&(!Array.isArray(value)||value.length>32||value.some(id=>typeof id!=="string"||!id)))throw new Error("Select up to 32 skill or MCP IDs");
        }
        const origin=await ctx.modules.call<WorkspaceDescriptor>("workspace","resolve",{workspaceId:scope.workspaceId});
        const d=await readyWorkspace(ctx,a.workspace_id);
        const c=await catalog(ctx,d.id);
        const config={name:clip(a.name,120)||"Background agent",profileId:a.profile_id,model:clip(a.model,200),agentFile:a.agent_file,
          skills:a.skills,mcps:a.mcp_ids??["internal-remote-mcp"],settings:agentSettings(a.settings)};
        const selection=agentSelection(c,config);
        const details=[`Source: ${origin.name} (${origin.machineId})`,`Target: ${d.name} (${d.machineId})`,
          `Agent: ${config.name}`,`Provider: ${selection.profile.name}${selection.model?` · ${selection.model}`:""}`,
          `Instructions: ${selection.agentFile||"None"}`,`Skills: ${selection.skills.join(", ")||"None"}`,
          `MCP servers: ${selection.ids.map(id=>c.mcps.find(m=>m.id===id)?.name||id).join(", ")||"None"}`,
          ...(Object.keys(config.settings).length?[`Provider settings: ${JSON.stringify(config.settings)}`]:[]),
          `Prompt: ${a.prompt.length>1500?a.prompt.slice(0,1500)+"…":a.prompt}`];
        await approve(ctx,{name:origin.name},"Start a background agent",details.join("\n"),"Start agent","persistent-agents.create",60000);
        await readyWorkspace(ctx,d.id);
        const id=crypto.randomUUID();
        const result={id,name:config.name,workspaceId:d.id,projectId:d.projectId};
        try { await createAgent(ctx,c,config,selection,id); }
        catch(e) { throw new Error(`Agent ${id} could not start in ${d.name}: ${e instanceof Error?e.message:String(e)}`); }
        ctx.events.emit("persistent-agents.changed",{workspaceId:d.id});
        try { await invoke(ctx,d.id,"send",{id,text:a.prompt}); }
        catch(e) { return {...result,promptAccepted:false,error:e instanceof Error?e.message:String(e)}; }
        return {...result,promptAccepted:true};
      }},
  ]);
}
const agentLines=(agent:{name:string;prompt:string;model:string}|null)=>agent?[`Background agent: ${agent.name}${agent.model?` (${agent.model})`:""}`,`Prompt: ${agent.prompt.length>1500?agent.prompt.slice(0,1500)+"…":agent.prompt}`]:[];
/** Start a background agent in a task workspace, configured like its parent (provider, model,
 *  instructions, skills and MCP servers that exist there), and send it the prompt. */
async function startTaskAgent(ctx:ModuleContext,parent:any,taskWorkspaceId:string,agent:{name:string;prompt:string;model:string}) {
  const c=await catalog(ctx,taskWorkspaceId);
  const mcpIds=[...(parent.workspaceMcp?["internal-remote-mcp"]:[]),...(parent.mcps||[]).map((m:any)=>m.id)].filter((id:string)=>c.mcps.some(m=>m.id===id));
  const created=await mod.methods!.create(ctx,{workspaceId:taskWorkspaceId,name:agent.name,profileId:parent.profile.id,model:agent.model||parent.model,
    agentFile:c.agentFiles.some(f=>f.path===parent.agentFile)?parent.agentFile:null,skills:(parent.skills||[]).filter((p:string)=>c.skills.some(s=>s.path===p)),mcps:mcpIds},{caller:"persistent-agents"});
  if(parent.autopilot)await invoke(ctx,taskWorkspaceId,"setAutopilot",{id:created.id,enabled:true});
  await invoke(ctx,taskWorkspaceId,"send",{id:created.id,text:agent.prompt});
  ctx.events.emit("persistent-agents.changed",{workspaceId:taskWorkspaceId});
  return {id:created.id,name:created.name,workspaceId:taskWorkspaceId,autopilot:!!parent.autopilot};
}
async function performTask(ctx:ModuleContext,r:{sessionId:string;workspaceId:string;op:string;args:any}) {
  const v=await owned(ctx,{workspaceId:String(r.workspaceId),id:String(r.sessionId)});
  const d:WorkspaceDescriptor=await ctx.modules.call("workspace","resolve",{workspaceId:r.workspaceId});
  const tasks=async()=>ctx.modules.call("git-tasks","list",{projectId:d.projectId});
  if(r.op==="list")return (await tasks()).map((t:any)=>({id:t.id,workspaceId:`task:${t.id}`,name:t.name,branch:t.branch,worktreePath:t.worktreePath,status:t.status,current:t.id===d.taskId}));
  if(r.op==="reconcile")return ctx.modules.call("git-tasks","reconcile",{projectId:d.projectId},{timeoutMs:120000});
  const project=`${d.name.split(" / ")[0]} (${d.machineId})`;
  if(r.op==="startAgent") {
    const agent=agentRequest(r.args?.agent)!;
    const task=(await tasks()).find((t:any)=>t.id===r.args?.taskId);
    if(!task)throw new Error("Task is not part of this project");
    if(task.status!=="ready")throw new Error(`Task worktree is ${task.status}; reconcile it first`);
    await approve(ctx,v.session,`start agent in task ${task.name}`,[`Agent: ${v.session.name}`,`Project: ${project}`,`Task: ${task.name} (${task.branch})`,...agentLines(agent)].join("\n"),"Start agent","persistent-agents.create");
    return startTaskAgent(ctx,v.session,`task:${task.id}`,agent);
  }
  if(r.op!=="create")throw new Error("Unknown task operation");
  const name=clip(r.args?.name,100),branch=clip(r.args?.branch,200),agent=agentRequest(r.args?.agent);
  if(!name&&!branch)throw new Error("Provide a task name or a branch");
  await approve(ctx,v.session,agent?"create Git task and start an agent":"create Git task",[`Agent: ${v.session.name}`,`Project: ${project}`,`Task name: ${name||branch}`,
    `Branch: ${branch||"generated task/<name>-<id>"}`,"Creates a linked Git worktree outside the project checkout. Existing branches are checked out, otherwise a new branch starts from HEAD.",...agentLines(agent)].join("\n"),
    agent?"Create and start":"Create task","git-tasks.create");
  const task=await ctx.modules.call("git-tasks","create",{projectId:d.projectId,name:name||branch,branch,select:false},{timeoutMs:300000});
  if(!agent)return task;
  try {return {...task,agent:await startTaskAgent(ctx,v.session,`task:${task.id}`,agent)};}
  catch(e) {return {...task,agentError:`The task was created but the agent did not start: ${e instanceof Error?e.message:String(e)}`};}
}
// Poll daemons the desktop already talks to for task requests and working sessions.
let daemonPoll:ReturnType<typeof setInterval>|null=null,polling=false,busySignature="";
let workingSignature = "";
const historySignatures = new Map<string, Map<string, string>>();
const WORKING_LIMIT = 50;
const WORKING: ReadonlySet<AgentSession["status"]> = new Set(["starting", "busy", "waiting"]);

let workingIds: ReadonlySet<string> = new Set();
const finishedChildren = new Map<string, FinishedSubagents>();
function publishWorking(ctx: ModuleContext, working: WorkingAgent[], childrenOf: (id: string) => AcpSubagent[] | undefined = () => undefined) {
  // Final child states first: polling can miss subagents finishing just before their parent.
  const now = new Set(working.map(w => w.id));
  if (trackFinishedSubagents(finishedChildren, workingIds, now, childrenOf)) ctx.state.set("persistent-agents.finished", [...finishedChildren.values()]);
  workingIds = now;
  const entries = working.sort((a, b) => a.id.localeCompare(b.id)).slice(0, WORKING_LIMIT);
  const sig = JSON.stringify(entries);
  if (sig === workingSignature) return;
  workingSignature = sig;
  ctx.state.set("persistent-agents.working", entries);
}
async function pollDaemons(ctx:ModuleContext) {
  if(polling)return;polling=true;
  try {
    const busy:Record<string,number>={};
    const working: WorkingAgent[] = [];
    const allChildren = new Map<string, AcpSubagent[]>();
    for(const [machineId,pending] of [...prepared]) {
      let t:DaemonTarget;try{t=await pending;}catch{continue;}
      try {
        const sessions: AgentSession[] = await ctx.host.daemon.request(t,"modules.call",{target:"agent-runner",method:"list",args:{},timeoutMs:10000});
        const byWorkspace = new Map<string, string[]>();
        for (const s of sessions || []) {
          if (s.machineId !== machineId) continue;
          const revisions = byWorkspace.get(s.workspaceId) ?? [];
          revisions.push(JSON.stringify([s.id, s.revision]));
          byWorkspace.set(s.workspaceId, revisions);
        }
        const previous = historySignatures.get(machineId);
        const current = new Map([...byWorkspace].map(([id, revisions]) => [id, JSON.stringify(revisions.sort())]));
        historySignatures.set(machineId, current);
        for (const workspaceId of new Set([...(previous?.keys() ?? []), ...current.keys()])) {
          if (previous?.get(workspaceId) !== current.get(workspaceId)) {
            ctx.events.emit("persistent-agents.changed", { workspaceId });
          }
        }
        for (const s of sessions || []) {
          if (s.machineId === machineId && !WORKING.has(s.status)) ctx.events.emit("persistent-agents.captureEnded", { workspaceId: s.workspaceId, sessionId: s.id });
          if (s.machineId === machineId && s.childSessions) allChildren.set(s.id, subagentList(s.childSessions));
          if (s.machineId !== machineId || (!WORKING.has(s.status) && !hasWorkingSubagents(s.childSessions))) continue;
          busy[s.workspaceId] = (busy[s.workspaceId] || 0) + 1;
          const { workflowId, runId, blockId } = s.workflow ?? {};
          const workflow = s.workflow ? {
            ...(typeof workflowId === "string" ? { workflowId } : {}),
            ...(typeof runId === "string" ? { runId } : {}),
            ...(typeof blockId === "string" ? { blockId } : {}),
          } : null;
          const progress = s.progress && Number.isFinite(s.progress.percent) ? { percent: s.progress.percent, ...(Number.isFinite(s.progress.at) ? { at: s.progress.at } : {}), ...(s.progress.note ? { note: s.progress.note } : {}) } : null;
          const children = subagentList(s.childSessions);
          working.push({ id: s.id, name: s.name, workspaceId: s.workspaceId, status: WORKING.has(s.status) ? s.status as WorkingAgent["status"] : "busy", workflow, progress, ...(children.length ? { children } : {}) });
        }
      }catch{ /* daemon unreachable: report nothing for it */ }
      let requests:any[];
      try{requests=await ctx.host.daemon.request(t,"modules.call",{target:"internal-remote-mcp",method:"claimTaskRequests",args:{},timeoutMs:10000});}catch{continue;}
      for(const r of requests||[]) void (async()=>{
        let outcome:{value?:any;error?:string};
        try {
          const d:WorkspaceDescriptor=await ctx.modules.call("workspace","resolve",{workspaceId:String(r.workspaceId)});
          if(d.machineId!==machineId)throw new Error("Workspace does not belong to this machine");
          outcome={value:await performTask(ctx,r)};
        }catch(e){outcome={error:e instanceof Error?e.message:String(e)};}
        await ctx.host.daemon.request(t,"modules.call",{target:"internal-remote-mcp",method:"resolveTaskRequest",args:{id:r.id,...outcome},timeoutMs:10000}).catch(e=>ctx.log.warn("task request reply",String(e)));
      })();
    }
    const sig=JSON.stringify(Object.entries(busy).sort());
    if(sig!==busySignature){busySignature=sig;ctx.state.set("persistent-agents.busy",busy);}
    publishWorking(ctx, working, id => allChildren.get(id));
  } finally {polling=false;}
}
/** After a Library edit, give running agents on connected machines the new text of the entries they
 *  use. They are not restarted; the next prompt carries the changed text under a new fingerprint. */
let libraryTimer:ReturnType<typeof setTimeout>|null=null;
async function pushLibrary(ctx:ModuleContext) {
  const items=libraryCatalog(ctx.state.get(LIBRARY_STATE)).items;
  for(const pending of [...prepared.values()]) {
    let t:DaemonTarget;try{t=await pending;}catch{continue;}
    let rows:any[];try{rows=await ctx.host.daemon.request(t,"modules.call",{target:"agent-runner",method:"list",args:{},timeoutMs:60000});}catch{continue;}
    for(const s of rows) {
      const inline:Record<string,string>={};
      for(const ref of [s.agentFile,...(s.skills||[])].filter(isLibraryRef)) {
        const item=items.find(i=>i.id===libraryRefId(ref));if(!item)continue;
        const text=libraryInstructions(item);
        if(s.inlineDigest?.[ref]!==textDigest(text))inline[ref]=text;
      }
      if(!Object.keys(inline).length)continue;
      try {
        await ctx.host.daemon.request(t,"modules.call",{target:"agent-runner",method:"refreshInline",args:{id:s.id,inline},timeoutMs:60000});
        await ctx.modules.call("internal-remote-mcp","updateInline",{sessionId:s.id,inline}).catch(()=>{});
      } catch(e){ctx.log.warn(`Library refresh for agent ${s.name}: ${e instanceof Error?e.message:String(e)}`);}
    }
  }
}
let desktopMcp:ReturnType<typeof exportMcpTools>;
const mod:AppModule={id:"persistent-agents",moduleApiVersion:1,
  canSwap:()=>({ok:(desktopMcp?.pending()??0)===0,reason:"A background agent MCP command is running"}),
  deactivate() {if(daemonPoll)clearInterval(daemonPoll);daemonPoll=null;if(libraryTimer)clearTimeout(libraryTimer);libraryTimer=null;},
  activate(ctx) {
    desktopMcp=desktopAgentTools(ctx);
    publishWorking(ctx, []);
    ctx.state.watch(LIBRARY_STATE,()=>{if(libraryTimer)clearTimeout(libraryTimer);libraryTimer=setTimeout(()=>{libraryTimer=null;void pushLibrary(ctx).catch(e=>ctx.log.warn(String(e)));},1500);});
    // If the local daemon is already running, connect to it so background activity and task
    // requests are seen without opening the Agents panel first. Never starts a daemon.
    setTimeout(async()=>{
      try {
        if(!await ctx.host.daemon.status({kind:"local"}))return;
        const local=(await ctx.modules.call("persistence","projects.list")).find((p:any)=>p.kind==="local");
        if(local)await target(ctx,`project:${local.id}:root`);
      }catch(e){ctx.log?.warn("local daemon warm-up",e instanceof Error?e.message:String(e));}
    },1500);
    // The AI module owns this request namespace; native event enforcement prevents spoofing it.
    // Keep this UI adapter allowlist narrow instead of exposing arbitrary module calls.
    const allowed=new Set(["create","catalog","list","view","send","cancel","stop","reconnect","setModel","setConfig","setAutopilot","setPolicy","update","updateRuntime","reviewPermission","clear","listMcpTools"]);
    ctx.events.on("mcp-panel.request",async(request:any)=>{
      if(typeof request?.requestId!=="string"||!["listMcps","saveMcp","removeMcp","probeMcp","signInMcp","signOutMcp","cancelSignInMcp","listMcpTools"].includes(request.method))return;
      try{const value=await mod.methods![request.method](ctx,request.args||{},{caller:"mcp-panel"});ctx.events.emit("persistent-agents.mcpResponse",{requestId:request.requestId,value});}
      catch(e){ctx.events.emit("persistent-agents.mcpResponse",{requestId:request.requestId,error:e instanceof Error?e.message:String(e)});}
    });
    ctx.events.on("ai.persistentRequest",async(request:any)=>{
      if(typeof request?.requestId!=="string"||!allowed.has(request.method))return;
      try {
        const value=await mod.methods![request.method](ctx,request.args,{caller:"ai"});
        ctx.events.emit("persistent-agents.chatResponse",{requestId:request.requestId,value});
      }catch(e){ctx.events.emit("persistent-agents.chatResponse",{requestId:request.requestId,error:e instanceof Error?e.message:String(e)});}
    });
  },
  methods:{
  async taskRequest(ctx,a,meta) {
    if(meta.caller!=="internal-remote-mcp")throw new Error("Task requests come from the workspace MCP server");
    return performTask(ctx,{sessionId:String(a.sessionId),workspaceId:String(a.workspaceId),op:String(a.op),args:a.args||{}});
  },
  workspaceEndpoint:async(ctx,a)=>ctx.modules.call("internal-remote-mcp","endpoint",{workspaceId:String(a.workspaceId),sessionId:String(a.sessionId||crypto.randomUUID()),skills:Array.isArray(a.skills)?a.skills:[]}),
  catalog:async(ctx,a)=>{const {libraryText:_text,...c}=await catalog(ctx,String(a.workspaceId));return c;},
  async listMcps(ctx) {
    const list=await mcps(ctx);
    const remote=list.filter(m=>transportOf(m)!=="stdio"&&m.auth?.type==="oauth").map(m=>({id:m.id,url:m.url}));
    const status=remote.length?await ctx.modules.call("mcp-auth","status",{servers:remote}).catch(()=>({})):{};
    return [...builtInMcps,...list.map(m=>status[m.id]?{...m,authStatus:status[m.id]}:m)];
  },
  /** Tools a server exposes: built-ins from their modules, remote servers over HTTP. */
  async listMcpTools(ctx,a) {
    const id=String(a.id||"");
    if(id==="internal-local-mcp")return {tools:await ctx.modules.call("internal-local-mcp","tools",{})};
    if(id==="internal-remote-mcp"||id==="internal-remote-mcp-local")return {tools:await ctx.modules.call("internal-remote-mcp","tools",{})};
    const server=(await mcps(ctx)).find(m=>m.id===id);
    if(!server)throw new Error("Unknown MCP server");
    if(transportOf(server)==="stdio")throw new Error("Local (command) servers start on the agent's machine when an agent connects; their tools cannot be listed from here yet.");
    return ctx.modules.call("mcp-auth","listTools",{serverId:server.id,url:server.url,transport:server.transport,headers:server.headers,auth:server.auth},{timeoutMs:90000});
  },
  async probeMcp(ctx,a) {return ctx.modules.call("mcp-auth","probe",{url:a.url,transport:a.transport,headers:a.headers},{timeoutMs:60000});},
  async signInMcp(ctx,a) {
    const server=(await mcps(ctx)).find(m=>m.id===a.id);
    if(!server||transportOf(server)==="stdio"||server.auth?.type!=="oauth")throw new Error("Save the server with OAuth authentication first");
    return ctx.modules.call("mcp-auth","signIn",{serverId:server.id,url:server.url,transport:server.transport,headers:server.headers,auth:server.auth});
  },
  async signOutMcp(ctx,a) {return ctx.modules.call("mcp-auth","signOut",{serverId:String(a.id)});},
  async cancelSignInMcp(ctx,a) {return ctx.modules.call("mcp-auth","cancel",{serverId:String(a.id)});},
  async saveMcp(ctx,a) {
    const server=validateMcp(a.server);
    await editMcps(ctx,list=>[...list.filter(p=>p.id!==server.id),server]);return null;
  },
  async removeMcp(ctx,a) {
    if(typeof a.id!=="string"||a.id.startsWith("internal-"))throw new Error("Built-in MCP servers cannot be removed");
    await editMcps(ctx,list=>list.filter(m=>m.id!==a.id));
    await ctx.modules.call("mcp-auth","signOut",{serverId:a.id}).catch(()=>{});return null;
  },
  async create(ctx,a,meta) {
    const c=await catalog(ctx,String(a.workspaceId));
    // Chats started from the AI panel carry the current chat's approval policy and provider options.
    return createAgent(ctx,c,a,agentSelection(c,a),crypto.randomUUID(),meta?.caller==="ai");
  },
  /** Edit name, provider, instructions, skills and MCP servers. Only a rename leaves a connected agent running. */
  async update(ctx,a) {
    const v=await owned(ctx,a),s=v.session;
    const name=String(a.name||"").trim().slice(0,120);if(!name)throw new Error("Agent name is required");
    // The edit form sends the current name back; an untouched automatic name follows the new provider.
    const followsProvider=name===s.name&&isAutoAgentName(s)&&s.profile.id!==a.profileId;
    // Typing a different name makes it custom; keeping the automatic one leaves naming automatic.
    const customName=!(name===s.name&&isAutoAgentName(s))&&name!==autoAgentName(s);
    const ids=[...new Set<string>(Array.isArray(a.mcps)?a.mcps:[])].sort();
    const skills=[...(Array.isArray(a.skills)?a.skills:[])].map(relativeAgentPath).sort();
    const agentFile=a.agentFile?relativeAgentPath(a.agentFile):null;
    const c=await catalog(ctx,String(a.workspaceId));
    // A Library entry edited since it was selected counts as an instruction change.
    const digests=(s as any).inlineDigest||{};
    const libraryChanged=[agentFile,...skills].some(p=>isLibraryRef(p)&&c.libraryText.has(p)&&digests[p]!==textDigest(c.libraryText.get(p)!));
    const same=!libraryChanged&&s.profile.id===a.profileId&&(s.agentFile||null)===agentFile&&JSON.stringify([...s.skills].sort())===JSON.stringify(skills)&&JSON.stringify(agentMcpIds(s).sort())===JSON.stringify(ids);
    if(same)return invoke(ctx,a.workspaceId,"update",{id:s.id,patch:{name,customName}});
    // Desktop-hosted endpoints are re-issued for the new selection.
    await ctx.modules.call("internal-local-mcp","revoke",{conversationId:s.id}).catch(()=>{});
    await ctx.modules.call("internal-remote-mcp","revoke",{sessionId:s.id}).catch(()=>{});
    const selection=agentSelection(c,{...a,mcps:ids,skills,agentFile,model:s.profile.id===a.profileId?s.model:""});
    const config=await agentConfig(ctx,c,selection,s.id);
    const result=await invoke(ctx,a.workspaceId,"update",{id:s.id,patch:{name,customName,...config}});
    await followName(ctx,a.workspaceId,s.id,followsProvider);
    return result;
  },
  async clear(ctx,a) {await owned(ctx,a);return invoke(ctx,a.workspaceId,"clear",{id:a.id});},
  async remove(ctx,a) {
    await owned(ctx,a);const result=await invoke(ctx,a.workspaceId,"remove",{id:a.id});
    await ctx.modules.call("internal-local-mcp","revoke",{conversationId:a.id}).catch(()=>{});
    await ctx.modules.call("internal-remote-mcp","revoke",{sessionId:a.id}).catch(()=>{});
    activityCache.delete(a.id);
    return result;
  },
  /** Prompts sent to this workspace's background agents with the files each turn edited (prompt-history panel).
   *  Uses the runner's ordinary `view`, so older runtimes still list prompts (without diffs). */
  async promptHistory(ctx,a) {
    const workspaceId=String(a.workspaceId),limit=Math.max(50,Math.min(Number(a.messageLimit)||200,200));
    const rows=(await invoke(ctx,workspaceId,"list")).filter((s:any)=>s.workspaceId===workspaceId)
      .sort((x:any,y:any)=>String(y.updatedAt).localeCompare(String(x.updatedAt))).slice(0,20);
    const entries:PromptEntry[]=[];
    for(const s of rows) {
      try {
        const v=await invoke(ctx,workspaceId,"view",{id:s.id,limit});
        entries.push(...promptTurns((v.messages||[]).map((m:any)=>({key:m.key,role:m.role,text:m.role==="user"?m.text:undefined,diffs:m.diffs,at:epochOf(m.at)})),
          {source:"agent",sessionId:s.id,sessionTitle:s.name||"Agent",agent:s.profile?.name||s.profile?.id||"Agent"}));
      } catch(e) { ctx.log.warn("prompt history",errMsg(e)); }
    }
    return {entries};
  },
  async list(ctx,a) {
    const rows=await invoke(ctx,String(a.workspaceId),"list");
    const scoped=rows.filter((s:any)=>s.workspaceId===a.workspaceId);
    // Fetch only revised sessions. This works with already-running daemon runtimes and never
    // replaces their plugins/processes. Limit concurrent SSH control requests on large lists.
    const result:any[]=new Array(scoped.length);
    let cursor=0;
    await Promise.all(Array.from({length:Math.min(4,scoped.length)},async()=>{
      while(cursor<scoped.length) {
        const index=cursor++,s=scoped[index],cached=activityCache.get(s.id);
        let text=cached&&cached.status===s.status?cached.text:undefined;
        if(!cached||cached.revision!==s.revision||cached.status!==s.status) {
          try {
            const detail=await invoke(ctx,String(a.workspaceId),"view",{id:s.id,limit:8});
            if(detail.session.workspaceId!==a.workspaceId)throw new Error("Agent belongs to another workspace");
            text=agentActivity(detail);
            activityCache.set(s.id,{revision:s.revision,status:s.status,text});
          }catch{ /* Keep the previous activity and retry on the next list refresh. */ }
        }
        result[index]={...s,activity:text};
      }
    }));
    return result;
  },
  async fork(ctx,a) {await owned(ctx,{...a,id:a.parentId});return invoke(ctx,a.workspaceId,"fork",{parentId:a.parentId,name:a.name,text:a.text,model:a.model});},
  async mcpConfigs(ctx,a,meta) {
    await ctx.modules.call("workspace","resolve",{workspaceId:String(a.workspaceId)});
    if(!Array.isArray(a.ids)||!a.ids.every((id:any)=>typeof id==="string"))throw new Error("MCP server ids are required");
    const ids=new Set<string>(a.ids),desktop:any[]=[];
    // Desktop tools for workflow agents: the workflows gateway names the token's owner (one per workflow).
    if(ids.delete("internal-local-mcp")) {
      if(meta?.caller!=="workflows"||typeof a.conversationId!=="string"||!a.conversationId.startsWith("workflow:"))throw new Error("Desktop tools are issued to workflows only");
      const endpoint=await ctx.modules.call<any>("internal-local-mcp","endpoint",{conversationId:a.conversationId,workspaceId:String(a.workspaceId)});
      desktop.push({id:"internal-local-mcp",...endpoint.server});
    }
    if(!ids.size)return desktop;
    const list=(await mcps(ctx)).filter(m=>m.enabled!==false&&ids.has(m.id));
    if(list.length!==ids.size)throw new Error("A connected MCP server is missing or disabled");
    const auth=await oauthHeaders(ctx,list);
    return [...desktop,...list.map(m=>({id:m.id,...acpServer(m,auth[m.id])}))];
  },
  async view(ctx,a) {
    const v=await invoke(ctx,String(a.workspaceId),"view",{id:a.id,before:a.before,limit:a.limit});
    if(v.session.workspaceId!==a.workspaceId)throw new Error("Agent belongs to another workspace");
    // A new agent learns its model only after connecting; complete its automatic name then.
    if(isAutoAgentName(v.session)){const name=autoAgentName(v.session);if(name!==v.session.name){await invoke(ctx,String(a.workspaceId),"update",{id:v.session.id,patch:{name,customName:false}}).catch(()=>{});v.session={...v.session,name};}}
    v.messages = captureEnabled(ctx) ? capturedTranscript(v.messages, capturedChanges(ctx, a.workspaceId), "agent", a.id)
      : v.messages.map((m: any) => ({ ...m, diffs: undefined }));
    return v;
  },
  async send(ctx,a) {
    const {session}=await owned(ctx,a),images=imageAttachments(a.images);
    if(session.workflow) {
      const t=await target(ctx,a.workspaceId);
      return ctx.host.daemon.request(t,"modules.call",{target:"workflow-runner",method:"promptSession",
        args:{...session.workflow,workspaceId:a.workspaceId,id:a.id,text:a.text,images},timeoutMs:180000});
    }
    const result = await invoke(ctx,a.workspaceId,"send",{id:a.id,text:a.text,steer:!!a.steer,...(images.length?{images}:{})});
    const page = await invoke(ctx,a.workspaceId,"view",{id:a.id,limit:20});
    const message = [...(page.messages || [])].reverse().find((m: any) => m.role === "user");
    if (message) ctx.events.emit("persistent-agents.capturePrompt", { workspaceId: a.workspaceId, sessionId: a.id, source: "agent", prompt: a.text, key: message.key });
    return result;
  },
  /** Replace this machine's agent runtime with the desktop's current build, even while agents run.
   *  Agents that were connected are reconnected afterwards (their provider sessions resume). */
  async updateRuntime(ctx,a) {
    const workspaceId=String(a.workspaceId);
    const d:WorkspaceDescriptor=await ctx.modules.call("workspace","resolve",{workspaceId});
    const t=await target(ctx,workspaceId);
    let rows:any[]=[];
    try{rows=await ctx.host.daemon.request(t,"modules.call",{target:"agent-runner",method:"list",args:{},timeoutMs:15000});}catch{}
    const wasLive=(rows||[]).filter((s:any)=>s.machineId===d.machineId&&["starting","ready","busy","waiting"].includes(s.status));
    const pushed:any[]=[];
    for(const id of ["internal-remote-mcp","agent-runner"]) {
      const r=await ctx.host.daemon.request(t,"plugins.push",{id});
      if(!r?.active)throw new Error(`${id} did not activate after the update: ${r?.error||"unknown error"}`);
      pushed.push({id,reloaded:!!r.reloaded});
    }
    const reconnected:string[]=[],failed:{id:string;name:string;error:string}[]=[];
    for(const s of wasLive) {
      try{await mod.methods!.reconnect(ctx,{workspaceId:s.workspaceId,id:s.id},{caller:"persistent-agents"});reconnected.push(s.id);}
      catch(e){failed.push({id:s.id,name:s.name,error:e instanceof Error?e.message:String(e)});}
    }
    activityCache.clear();
    ctx.events.emit("persistent-agents.changed",{workspaceId});
    ctx.events.emit("remote-runtime.changed",{machineId:d.machineId});
    return {machineId:d.machineId,pushed,reconnected,failed};
  },
  async setConfig(ctx,a) {
    const v=await owned(ctx,a);
    const result=await invoke(ctx,a.workspaceId,"setConfig",{id:a.id,configId:String(a.configId||""),value:typeof a.value==="boolean"?a.value:String(a.value??"")});
    if(v.session.configOptions?.find((o:any)=>o.id===a.configId)?.category==="model")await followName(ctx,a.workspaceId,a.id,isAutoAgentName(v.session));
    return result;
  },
  async setPolicy(ctx,a) {await owned(ctx,a);return invoke(ctx,a.workspaceId,"setPolicy",{id:a.id,policy:String(a.policy||"ask")});},
  async cancel(ctx,a) {await owned(ctx,a);return invoke(ctx,a.workspaceId,"cancel",{id:a.id});},
  async stop(ctx,a) {await owned(ctx,a);const result=await invoke(ctx,a.workspaceId,"stop",{id:a.id});
    await ctx.modules.call("internal-local-mcp","revoke",{conversationId:a.id}).catch(()=>{});
    await ctx.modules.call("internal-remote-mcp","revoke",{sessionId:a.id}).catch(()=>{});
    return result;},
  async setAutopilot(ctx,a) {await owned(ctx,a);return invoke(ctx,a.workspaceId,"setAutopilot",{id:a.id,enabled:a.enabled===true});},
  async reconnect(ctx,a) {
    const v=await owned(ctx,a);
    const used=new Set((v.session.mcps||[]).map((m:any)=>m.id));
    const authorization=await oauthHeaders(ctx,(await mcps(ctx)).filter(m=>used.has(m.id)));
    const subscription=await ctx.modules.call("persistence","settings.get",{key:"acp.claude.useSubscription"});
    // Desktop-hosted tool servers get new credentials: the ones the agent holds die with each desktop restart.
    const desktopIds=DESKTOP_MCP_IDS.filter(id=>used.has(id));
    let endpoints:any[]=[];
    if(desktopIds.length) {
      const paths=[v.session.agentFile,...(v.session.skills||[])];
      const inline=desktopIds.includes("internal-remote-mcp-local")&&paths.some(isLibraryRef)?libraryInline(await catalog(ctx,a.workspaceId),paths):{};
      endpoints=await desktopEndpoints(ctx,a.workspaceId,v.session.id,desktopIds,paths,inline);
    }
    return invoke(ctx,a.workspaceId,"reconnect",{id:a.id,authorization,endpoints,claudeSubscription:subscription!==false});
  },
  async setModel(ctx,a) {
    const v=await owned(ctx,a);
    const result=await invoke(ctx,a.workspaceId,"setModel",{id:a.id,model:a.model});
    await followName(ctx,a.workspaceId,a.id,isAutoAgentName(v.session));
    return result;
  },
  async reviewPermission(ctx,a) {
    const v=await owned(ctx,a),permission=v.permissions.find((p:any)=>p.id===a.permissionId);
    if(!permission)throw new Error("Permission request is no longer active");
    const options=(permission.request.options||[]).map((o:any)=>({id:o.optionId,label:o.name||o.optionId,kind:String(o.kind).startsWith("allow")?"allow":"deny"}));
    const deny=options.find((o:any)=>o.kind==="deny");if(!deny)throw new Error("Provider supplied no deny option");
    const decision=await ctx.host.approvals.request({title:`${v.session.name}: agent permission`,detail:JSON.stringify(permission.request.toolCall||permission.request,null,2),options});
    return invoke(ctx,a.workspaceId,"permission",{id:a.id,permissionId:a.permissionId,optionId:decision.optionId||deny.id});
  },
}};
/** Keep an automatically named agent ("Provider/Model") in step with its provider and model.
 *  `wasAuto` is decided before the change; names the user typed are never touched. */
async function followName(ctx:ModuleContext,workspaceId:string,id:string,wasAuto:boolean) {
  if(!wasAuto)return;
  try {
    const v=await invoke(ctx,workspaceId,"view",{id,limit:1});
    const name=autoAgentName(v.session);
    if(name&&name!==v.session.name)await invoke(ctx,workspaceId,"update",{id,patch:{name,customName:false}});
  }catch(e){ctx.log.warn(`agent rename: ${e instanceof Error?e.message:String(e)}`);}
}
async function owned(ctx:ModuleContext,a:any) {
  const v=await invoke(ctx,String(a.workspaceId),"view",{id:a.id,limit:1});
  if(v.session.workspaceId!==a.workspaceId)throw new Error("Agent belongs to another workspace");return v;
}
export default mod;
