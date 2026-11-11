// Bottom-bar language button: a compact "lng-srv" menu listing every installed language server.
// Checking one marks the selected workspace as that kind of project (opt-in, off by default);
// status is shown only for languages the workspace uses.
import type {AppModule,UiNode} from "@hato/sdk/types";
let open=false;
export default {
 id:"language-status",moduleApiVersion:1,
 activate(ctx){ctx.state.watch("language-tools.status",()=>ctx.ui.invalidate());},
 render(ctx):UiNode {
  const status:any=ctx.state.get("language-tools.status");
  const servers:any[]=Array.isArray(status?.servers)?status.servers:[];
  const items:UiNode[]=servers.length?servers.map((s:any):UiNode=>({type:"row",key:`server:${s.id}`,gap:4,align:"center",children:[
   {type:"button",key:"toggle",text:`${s.enabled?"✓":"  "}  ${s.title}`,action:"toggle",value:s.id,variant:"ghost",small:true,grow:true,disabled:!status?.workspace,
    tooltip:s.enabled?`Stop treating this workspace as a ${s.title} project`:`Treat this workspace as a ${s.title} project`},
   ...(s.enabled?[{type:"label",key:"phase",text:s.phase,size:"xs",color:"muted"} as UiNode]:[]),
   {type:"button",key:"settings",text:"Settings…",action:"settings",value:s.id,variant:"ghost",small:true,disabled:!status?.workspace},
  ]})):[{type:"label",key:"none",text:"No language plugins are installed.",size:"sm",color:"muted"}];
  return {type:"row",key:"language-status",gap:4,align:"center",children:[
   {type:"dropdown",key:"languages",text:status?.label?`lng-srv · ${status.label}`:"lng-srv",tooltip:status?.message||"Language servers for this workspace",open,action:"menu",variant:"ghost",menuWidth:320,maxHeight:360,children:[
    {type:"label",key:"title",text:"Languages for this workspace",size:"xs",color:"muted"},
    ...items,
    {type:"divider",key:"div"},
    {type:"button",key:"symbols",text:"Search symbols…",action:"symbols",variant:"ghost",small:true,disabled:!servers.some((s:any)=>s.enabled)},
   ]},
  ]};
 },
 onEvent(ctx,event){
  if(event.action==="menu"){open=event.value===true;ctx.ui.invalidate();return;}
  open=false;ctx.ui.invalidate();
  if(event.action==="toggle")ctx.events.emit("language-status.toggle",{serverId:event.value});
  else if(event.action==="settings")ctx.events.emit("language-status.settings",{serverId:event.value});
  else if(event.action==="symbols")ctx.events.emit("language-status.open",{symbols:true});
 },
} satisfies AppModule;
