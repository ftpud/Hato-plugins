import type { AppModule, ModuleContext, UiNode, TreeRow } from "@hato/sdk/types";
import { uiIcons } from "@hato/sdk/ui-icons";
import { errMsg } from "@hato/sdk/runtime";
import { filterInput } from "@hato/sdk/filter-style";

let scope="global", workspaceId:string|null=null, entries:any[]=[], selected:any=null;
let file="", content="", saved="", query="", error="", busy=false, preview=true;
let editingMetadata=false;
let creating=false, name="", description="", kind="skill", newPath="", confirmRemove=false;
let expanded=new Set<string>(), collapsedDirs=new Set<string>(), generation=0;
const dirty=()=>content!==saved;
const args=()=>({scope,workspaceId});
const btn=(key:string,text:string,action:string,disabled=false):UiNode=>({type:"button",key,text,action,small:true,disabled:busy||disabled,variant:"ghost"});
const label=(key:string,text:string,muted=false):UiNode=>({type:"label",key,text,size:"sm",color:muted?"muted":undefined,wrap:true});
async function refresh(ctx:ModuleContext) {
  const version=++generation;
  if(scope==="project"&&!workspaceId){entries=[];selected=null;ctx.ui.invalidate();return;}
  try {const next=await ctx.modules.call("library","list",args());if(version!==generation)return;entries=next;error="";}
  catch(e){if(version===generation)error=errMsg(e);}
  ctx.ui.invalidate();
}
async function open(ctx:ModuleContext,id:string,path?:string) {
  if(dirty())throw new Error("Save or discard your changes before navigating");
  const version=++generation;
  const next=await ctx.modules.call("library","read",{...args(),id});
  const key=path||next.paths.find((p:string)=>p==="SKILL.md"||p==="AGENT.md")||next.paths[0];
  const result=await ctx.modules.call("library","read",{...args(),id,path:key});
  if(version!==generation)return;
  selected=next;file=key;content=saved=result.content;preview=true;creating=false;confirmRemove=false;
  expanded.add(id);ctx.ui.invalidate();
}
function rows():TreeRow[] {
  const result:TreeRow[]=[];
  for(const entry of entries.filter(e=>`${e.name} ${e.description}`.toLowerCase().includes(query.toLowerCase()))) {
    result.push({key:entry.id,label:entry.name,description:entry.description,badge:entry.kind,depth:0,expandable:true,expanded:expanded.has(entry.id),selected:selected?.id===entry.id&&!file,iconSvg:"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M12 5v16M3 3h5a4 4 0 0 1 4 2 4 4 0 0 1 4-2h5v16h-5a4 4 0 0 0-4 2 4 4 0 0 0-4-2H3Z\"/></svg>"});
    if(!expanded.has(entry.id))continue;
    const dirs=new Set<string>();
    for(const p of entry.paths) {
      const segments=p.split("/");
      let hidden=false;
      for(let i=1;i<segments.length;i++) {
        const dir=segments.slice(0,i).join("/");
        if(!dirs.has(dir)){dirs.add(dir);result.push({key:`dir:${entry.id}:${dir}`,label:segments[i-1],depth:i,expandable:true,expanded:!collapsedDirs.has(`dir:${entry.id}:${dir}`),selected:false,iconSvg:uiIcons.folder});}
        if(collapsedDirs.has(`dir:${entry.id}:${dir}`)){hidden=true;break;}
      }
      if(hidden)continue;
      result.push({key:`file:${entry.id}:${p}`,label:segments[segments.length-1],depth:segments.length,expandable:false,expanded:false,selected:selected?.id===entry.id&&file===p,iconSvg:uiIcons[p.endsWith(".sh")?"terminal":"files"]});
    }
  }
  return result;
}
const mod:AppModule={
 id:"library-panel",moduleApiVersion:1,
 async activate(ctx,prev){scope=prev?.scope||"global";expanded=new Set(prev?.expanded||[]);collapsedDirs=new Set(prev?.collapsedDirs||[]);const w=ctx.state.get("workspace.selected") as any;workspaceId=w?.id||null;
   ctx.state.watch("workspace.selected",()=>{const w=ctx.state.get("workspace.selected") as any;if(scope==="project"&&dirty()){error="Project changed. Save or discard Library edits before selecting the new project scope.";ctx.ui.invalidate();return;}workspaceId=w?.id||null;if(scope==="project"){generation++;selected=null;file="";content=saved="";void refresh(ctx);}});
   ctx.events.on("library.changed",()=>{void refresh(ctx);});await refresh(ctx);
 },
 snapshot:()=>({scope,expanded:[...expanded],collapsedDirs:[...collapsedDirs]}),
 canSwap:()=>({ok:!dirty()&&!busy,reason:"Save Library edits before reloading"}),
 render(){
   const children:UiNode[]=[
     {type:"row",key:"heading",gap:8,align:"center",children:[{type:"label",key:"title",text:"Library",size:"lg",weight:"semibold",grow:true},btn("refresh","Refresh","refresh",dirty()),btn("add","+ New","new",dirty())]},
     label("intro","Reusable skills and agents, stored outside your workspace.",true),
     {type:"select",key:"scope",value:scope,action:"scope",disabled:busy||dirty(),options:[{value:"global",label:"Global · all projects"},{value:"project",label:"Project · shared with its tasks"}]},
     {type:"textInput",key:"filter",...filterInput,value:query,placeholder:"Find skills or agents…",changeAction:"filter"},
   ];
   if(error)children.push({type:"label",key:"error",text:error,color:"danger",wrap:true});
   if(creating)children.push({type:"column",key:"create",gap:8,padding:12,border:true,children:[label("ct",editingMetadata?"Edit Library entry":"New Library entry"),{type:"select",key:"kind",value:kind,action:"kind",disabled:editingMetadata,options:[{value:"skill",label:"Skill"},{value:"agent",label:"Agent instructions"}]},{type:"textInput",key:"name",value:name,placeholder:"Name",changeAction:"name"},{type:"textInput",key:"description",value:description,placeholder:"When should this be used?",changeAction:"description"},{type:"row",key:"create-actions",gap:8,children:[btn("create",editingMetadata?"Save details":"Create","create",!name.trim()),btn("cancel","Cancel","cancelCreate")]}]});
   children.push(entries.length?{type:"tree",key:"entries",rows:rows(),selectAction:"select",expandAction:"expand",height:selected?190:360,grow:!selected,rowHeight:28}: {type:"column",key:"empty",padding:20,gap:10,children:[label("empty-title",scope==="project"&&!workspaceId?"Select a project to open its Library":"Your Library is ready"),label("empty-hint","Add a skill with SKILL.md, or an agent with AGENT.md. Keep references in nested Markdown pages and scripts in .sh files.",true)]});
   if(selected){
     children.push({type:"row",key:"entry",gap:8,children:[{type:"label",key:"name",text:selected.name,grow:true,weight:"semibold"},btn("details","Details","details",dirty()),btn("remove","Remove","askRemove",dirty())]});
     if(confirmRemove)children.push({type:"row",key:"remove-confirm",gap:6,children:[label("warn","Delete this entry and all its files?"),btn("yes","Delete","remove"),btn("no","Cancel","cancelRemove")]});
     children.push({type:"row",key:"file-bar",gap:6,children:[{type:"label",key:"path",text:file+(dirty()?" · Unsaved":""),grow:true,size:"xs",color:"muted"},btn("preview",preview?"Edit":"Preview","preview",!file.endsWith(".md")),btn("save","Save","save",!dirty()),btn("discard","Discard","discard",!dirty())]});
     children.push(preview&&file.endsWith(".md")?{type:"column",key:"preview-scroll",grow:true,scroll:true,padding:10,children:[{type:"markdown",key:"preview",text:content,linkAction:"link"}]}:{type:"textInput",key:"editor",value:content,changeAction:"content",multiline:true,fillHeight:true,grow:true,style:{font:"mono",minHeight:140}});
     children.push({type:"column",key:"new-file",gap:6,children:[{type:"textInput",key:"newPath",value:newPath,changeAction:"newPath",placeholder:"references/guide.md or scripts/check.sh",grow:true},{type:"row",key:"file-actions",gap:6,children:[btn("add-file","Add file","addFile",!newPath||dirty()),btn("delete-file","Delete file","deleteFile",dirty()||file==="SKILL.md"||file==="AGENT.md")]}]});
   }
   children.push(label("footer","AI reads files on demand through Library MCP tools. Scripts are stored, never auto-run.",true));
   return {type:"column",key:"library",grow:true,padding:14,gap:10,children};
 },
 async onEvent(ctx,ev){
  if(busy)return;
  error="";
  try{
   const action=ev.action,value=String(ev.value??"");
   if(ev.inputs?.editor!==undefined)content=ev.inputs.editor;
   if(ev.inputs?.name!==undefined)name=ev.inputs.name;
   if(ev.inputs?.description!==undefined)description=ev.inputs.description;
   if(ev.inputs?.newPath!==undefined)newPath=ev.inputs.newPath;
   if(action==="filter")query=value;
   else if(action==="content")content=value;
   else if(action==="name")name=value;
   else if(action==="description")description=value;
   else if(action==="kind")kind=value;
   else if(action==="newPath")newPath=value;
   else if(action==="preview")preview=!preview;
   else if(action==="discard"){content=saved;const w=ctx.state.get("workspace.selected") as any;if(scope==="project"&&workspaceId!==(w?.id||null)){workspaceId=w?.id||null;selected=null;void refresh(ctx);}}
   else if(action==="details"){editingMetadata=true;creating=true;name=selected.name;description=selected.description;kind=selected.kind;}
   else if(action==="new"){editingMetadata=false;creating=true;name=description="";}
   else if(action==="cancelCreate")creating=false;
   else if(action==="askRemove")confirmRemove=true;
   else if(action==="cancelRemove")confirmRemove=false;
   else if(action==="expand"){const id=ev.rowKey||value;if(id.startsWith("dir:")){if(collapsedDirs.has(id))collapsedDirs.delete(id);else collapsedDirs.add(id);}
     else if(expanded.has(id))expanded.delete(id);else expanded.add(id);}
   else {
    busy=true;
    if(action==="scope"){if(dirty())throw new Error("Save or discard edits first");scope=value;selected=null;content=saved="";workspaceId=(ctx.state.get("workspace.selected") as any)?.id||null;await refresh(ctx);}
    else if(action==="refresh"){await refresh(ctx);if(selected&&!dirty())await open(ctx,selected.id,file);}
    else if(action==="select"){
      const key=ev.rowKey||value;
      if(key.startsWith("file:")){const [_,id,...rest]=key.split(":");await open(ctx,id,rest.join(":"));}
      else if(key.startsWith("dir:")){if(collapsedDirs.has(key))collapsedDirs.delete(key);else collapsedDirs.add(key);}
      else await open(ctx,key);
    }
    else if(action==="create") {const entry=await ctx.modules.call("library","save",{...args(),name,description,kind,...(editingMetadata?{id:selected.id,expectedRevision:selected.revision}:{expectedRevision:null})});creating=false;await refresh(ctx);await open(ctx,entry.id);}
    else if(action==="save"||action==="addFile"||action==="deleteFile"){
      const path=action==="addFile"?newPath:file;
      if(action==="addFile"&&selected.paths.includes(path))throw new Error("That file already exists");
      await ctx.modules.call("library","save",{...args(),id:selected.id,path,content:action==="deleteFile"?null:action==="addFile"?"":content,expectedRevision:selected.revision});
      saved=content;await refresh(ctx);await open(ctx,selected.id,action==="deleteFile"?undefined:path);newPath="";
    }
    else if(action==="remove"){await ctx.modules.call("library","remove",{...args(),id:selected.id,expectedRevision:selected.revision});selected=null;file="";content=saved="";await refresh(ctx);}
    else if(action==="link"){
      const base=file.split("/").slice(0,-1),parts=[...base,...value.split("#")[0].split("/")],resolved:string[]=[];
      for(const part of parts){if(part==="..")resolved.pop();else if(part&&part!==".")resolved.push(part);}
      await open(ctx,selected.id,resolved.join("/"));
    }
   }
  }catch(e){error=errMsg(e);}finally{busy=false;ctx.ui.invalidate();}
 },
};
export default mod;
