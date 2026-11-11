import type {AppModule,UiNode} from "@hato/sdk/types";
export default {
 id:"language-status",moduleApiVersion:1,
 activate(ctx){ctx.state.watch("language-tools.status",()=>ctx.ui.invalidate());},
 render(ctx):UiNode {
  const status:any=ctx.state.get("language-tools.status");
  return {type:"row",key:"language-status",gap:4,children:[
   {type:"button",key:"languages",text:status?.label || "Languages",tooltip:status?.message || "Workspace language servers and project settings",action:"open",small:true,variant:"ghost"},
   {type:"button",key:"symbols",text:"Symbols…",tooltip:"Search symbols across the project",action:"symbols",small:true,variant:"ghost"},
  ]};
 },
 onEvent(ctx,event){ctx.events.emit("language-status.open",{symbols:event.action==="symbols"});},
} satisfies AppModule;
