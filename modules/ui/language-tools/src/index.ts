import type {AppModule,ModuleContext,UiNode} from "@hato/sdk/types";
import {LanguagePanel} from "./panel";
import {errMsg} from "@hato/sdk/runtime";
const panel=new LanguagePanel();
let workspace:any=null, servers:any[]=[], serverId="", epoch=0;
// Per-server state for the selected workspace: whether the project uses it, and its last phase.
let projects:Record<string,{enabled:boolean;phase:string;message?:string}>={};
async function refresh(ctx:ModuleContext) {
 const version=++epoch;
 try {
  const next=await ctx.modules.call("language-service","servers",{});
  if(version!==epoch)return;
  servers=next;
  const states:typeof projects={};
  if(workspace)await Promise.all(servers.map(async s=>{
   const p=await ctx.modules.call("language-service","project.get",{workspaceId:workspace.id,serverId:s.id}).catch(()=>null);
   states[s.id]={enabled:p?.config?.enabled===true,phase:p?.status?.phase||"idle",message:p?.status?.message};
  }));
  if(version!==epoch)return;
  projects=states;
  // Prefer a server this project uses; otherwise keep the panel pointed at the first one.
  const enabled=servers.filter(s=>projects[s.id]?.enabled);
  if(!servers.some(s=>s.id===serverId)||!projects[serverId]?.enabled&&enabled.length)serverId=(enabled[0]||servers[0])?.id || "";
  if(workspace&&serverId)await panel.attach(ctx,workspace.id,serverId,"");
  else panel.reset();
  publish(ctx);
 }catch(e){panel.error=errMsg(e);ctx.ui.invalidate();}
}
function publish(ctx:ModuleContext){
 if(serverId&&panel.status&&projects[serverId])projects[serverId]={...projects[serverId],phase:panel.status.phase||projects[serverId].phase,message:panel.status.message};
 const active=servers.filter(s=>projects[s.id]?.enabled);
 ctx.state.set("language-tools.status",{
  // Only languages this workspace opted into show a status.
  label:active.length?active.map(s=>`${s.id} · ${projects[s.id].phase}`).join("  "):"",
  message:active.length?active.map(s=>`${s.title}: ${projects[s.id].message||projects[s.id].phase}`).join("\n"):"No language server is enabled for this workspace",
  servers:servers.map(s=>({id:s.id,title:s.title,enabled:!!projects[s.id]?.enabled,phase:projects[s.id]?.phase||"idle"})),
  workspace:!!workspace,
 });ctx.ui.invalidate();
}
async function document(ctx:ModuleContext) {return ctx.modules.call("viewer","language.document",{workspaceId:workspace?.id});}
export default {
 id:"language-tools",moduleApiVersion:1,
 async activate(ctx){
  workspace=ctx.state.get("workspace.selected");
  ctx.state.watch("workspace.selected",(next:any)=>{if(next?.id===workspace?.id)return;workspace=next;panel.reset();void refresh(ctx);});
  ctx.events.on("kernel.modules.changed",()=>{void refresh(ctx);});
  ctx.events.on("language-service.status",(status:any)=>{panel.update(ctx,status);publish(ctx);});
  ctx.events.on("language-status.open",async(event:any)=>{
   await refresh(ctx);panel.open=!event.symbols;panel.picking=!!event.symbols;publish(ctx);
   if(event.symbols)await panel.event(ctx,{action:"languageSymbols",key:"",inputs:{}},()=>({}),()=>{});
  });
  // Changes made from the open panel are already reflected there; others (bar menu, agents) refresh.
  ctx.events.on("language-service.configurationChanged",(event:any)=>{if(event.workspaceId===workspace?.id){if(!panel.open)panel.reset();void refresh(ctx);}});
  ctx.events.on("language-status.toggle",async(event:any)=>{
   const id=String(event?.serverId||"");
   if(!workspace||!servers.some(s=>s.id===id))return;
   try{
    const p=await ctx.modules.call("language-service","project.get",{workspaceId:workspace.id,serverId:id});
    await ctx.modules.call("language-service","project.set",{workspaceId:workspace.id,serverId:id,config:{...p.config,enabled:!p.config.enabled}});
   }catch(e){panel.error=errMsg(e);}
   await refresh(ctx);
  });
  ctx.events.on("language-status.settings",async(event:any)=>{
   if(typeof event?.serverId==="string"&&servers.some(s=>s.id===event.serverId))serverId=event.serverId;
   panel.reset();await refresh(ctx);panel.open=true;publish(ctx);
  });
  await refresh(ctx);
 },
 canSwap:()=>({ok:!panel.busy,reason:"A language operation is running"}),
 deactivate(){epoch++;panel.reset();},
 render():UiNode {
  const overlay=panel.overlay();
  if(!overlay)return {type:"column",key:"empty",children:[]};
  if(!workspace||!serverId)return {type:"modal",key:"language-project",title:"Language services",closeAction:"languageClose",children:[{type:"label",key:"empty",text:"Select a workspace and enable a language provider."}]};
  const content:any=(overlay as any).children?.[0];
  content?.children?.[0]?.children?.unshift({type:"select",key:"server",value:serverId,options:servers.map(s=>({value:s.id,label:s.title})),action:"selectServer",buttonStyle:{fullWidth:true,justify:"start"}});
  return overlay;
 },
 async onEvent(ctx,event){
  if(event.action==="selectServer"){serverId=String(event.value);panel.reset();await refresh(ctx);panel.open=true;publish(ctx);return;}
  const selectedWorkspace=workspace?.id;
  const needsDocument = event.action === "languageSymbols" && panel.scope === "file" || ["languageApply","languageRestart","languageReindex"].includes(event.action);
  const source=needsDocument?await document(ctx).catch(()=>null):null;
  await panel.event(ctx,event,()=>source||{},symbol=>{
   if(workspace?.id!==selectedWorkspace)return;
   void ctx.modules.call("viewer","editor.openLocation",{workspaceId:workspace.id,uri:symbol.uri,path:symbol.path,position:symbol.range.start}).catch(e=>{panel.error=errMsg(e);ctx.ui.invalidate();});
  });publish(ctx);
 },
} satisfies AppModule;
