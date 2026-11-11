import type { ModuleContext, UiNode, UiEvent } from "@hato/sdk/types";
import { errMsg } from "@hato/sdk/runtime";
export class LanguagePanel {
  status: any = null;
  project: any = null;
  symbols: any[] = [];
  open = false;
  picking = false;
  scope: "project" | "file" = "project";
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private searchVersion = 0;
  private filter = "";
  private fullLog: string | null = null;
  busy = false;
  error: string | null = null;
  private browsing: { field: string; path: string; entries: any[] } | null = null;
  private epoch = 0;
  private target = "";
  private workspaceId = "";
  private serverId = "";
  reset() { if (this.searchTimer) clearTimeout(this.searchTimer); this.searchVersion++; this.epoch++; this.status = this.project = null; this.symbols = []; this.open = this.picking = false; this.busy = false; this.error = null; this.target = ""; this.browsing = null; this.filter = ""; this.fullLog = null; }
  matches(workspaceId: string, serverId: string) { return this.workspaceId === workspaceId && this.serverId === serverId; }
  update(ctx: ModuleContext, status: any) {
    if (!this.matches(status.workspaceId, status.serverId)) return;
    this.status = status; ctx.ui.invalidate();
  }
  async attach(ctx: ModuleContext, workspaceId: string, serverId: string, path: string) {
    const target = `${workspaceId}|${serverId}`;
    if (target === this.target) return;
    this.reset(); this.target = target; this.workspaceId = workspaceId; this.serverId = serverId;
    const epoch = this.epoch;
    try {
      const result = await ctx.modules.call("language-service", "project.get", { workspaceId, serverId });
      if (epoch !== this.epoch) return;
      this.project = result; this.status ||= result.status;
    } catch (e) { if (epoch === this.epoch) this.error = errMsg(e); }
    ctx.ui.invalidate();
  }
  controls(): UiNode[] {
    if (!this.target) return [];
    return [
      { type: "button", key: "language-server", text: `${this.serverId} · ${this.status?.phase || "idle"}`, tooltip: this.error || this.status?.message || "Language server and project settings", action: "languagePanel", small: true, variant: "ghost" },
      { type: "button", key: "method-picker", text: "Symbols…", action: "languageSymbols", small: true, variant: "ghost", tooltip: "Jump to a class, method or field in this file" },
    ];
  }
  overlay(): UiNode | null {
    if (!this.open && !this.picking) return null;
    const children: UiNode[] = [
      { type: "row", key: "header", gap: 8, children: [
        { type: "label", key: "title", text: this.picking ? this.scope === "project" ? "Project symbols" : "File symbols" : this.project?.schema?.title || "Language server", grow: true },
        { type: "button", key: "close", text: "Close", action: "languageClose", small: true, variant: "ghost" },
      ] },
    ];
    if (this.error) children.push({ type: "status", key: "error", text: this.error, level: "error" });
    if (this.picking) {
      children.push({type:"row",key:"symbol-scope",gap:6,children:[
        {type:"button",key:"project",text:"Project",action:"languageSymbolScope",value:"project",variant:this.scope==="project"?"primary":"ghost"},
        {type:"button",key:"file",text:"Current file",action:"languageSymbolScope",value:"file",variant:this.scope==="file"?"primary":"ghost"},
      ]});
      children.push({ type: "textInput", key: "symbol-filter", value: this.filter, changeAction: "languageFilter", placeholder: "Find a class, method or field…" });
      children.push({ type: "button", key: "refresh", text: this.busy ? "Loading…" : this.scope === "project" ? "Search project" : "Refresh file symbols", action: "languageSymbols", disabled: this.busy });
      if (!this.symbols.length && !this.busy) children.push({ type: "label", key: "empty", text: this.scope === "project" && !this.filter.trim() ? "Type a name to search the project index, including unopened files." : "No symbols returned. Check server status and project import errors.", wrap: true });
      children.push(...this.symbols.map((symbol, index) => ({ symbol, index })).filter(({symbol}) => `${symbol.name} ${symbol.container} ${symbol.detail}`.toLowerCase().includes(this.filter.toLowerCase())).slice(0,300).map(({symbol, index}): UiNode => ({ type: "button", key: `symbol-${index}`, text: `${symbol.container ? symbol.container + " · " : ""}${symbol.name}${symbol.detail ? "  " + symbol.detail : ""}${symbol.path ? "  — " + symbol.path : ""}`, tooltip: `Line ${symbol.range.start.line + 1}`, action: "languageSymbol", value: index, variant: "ghost" })));
    } else {
      children.push({ type: "label", key: "status", text: `${this.serverId} on ${this.status?.machineId || this.workspaceId}: ${this.status?.message || "Idle"}`, wrap: true });
      const cap = this.status?.capabilities;
      if (cap) children.push({ type: "label", key: "capabilities", text: `Server features: ${[["definitionProvider","navigation"],["hoverProvider","hover"],["completionProvider","completion"],["documentSymbolProvider","symbols"]].filter(([key]) => cap[key]).map(([,label]) => label).join(", ") || "none advertised"} · ${this.status?.diagnostics || 0} diagnostics`, wrap: true, size: "xs" });
      if (this.project) {
        const config = this.project.config;
        children.push({ type: "toggle", key: "project-enabled", label: this.project.schema?.enabledLabel || "Enable language server for this workspace", checked: config.enabled, action: "languageEnabled" });
        for (const field of this.project.schema?.fields || []) {
          if (field.type === "toggle") children.push({ type: "toggle", key: field.key, label: field.label, checked: config.values[field.key] !== false, action: "languageField" });
          else children.push({ type: "column", key: field.key + "-field", gap: 3, children: [
            { type: "label", key: "label", text: field.label },
            { type: "textInput", key: `project-${field.key}`, value: Array.isArray(config.values[field.key]) ? config.values[field.key].join("\n") : config.values[field.key] || "", multiline: field.type === "paths", rows: 2, changeAction: "languageText", placeholder: "Automatic / default" },
            ...(field.directory ? [{ type: "button", key: `browse-${field.key}`, text: "Browse folders…", action: `languageBrowse:${field.key}`, value: field.key, small: true, variant: "ghost" } as UiNode] : []),
            ...(field.description ? [{ type: "label", key: "help", text: field.description, wrap: true, size: "xs", color: "muted" } as UiNode] : []),
          ] });
        }
        children.push({ type: "label", key: "advanced-label", text: "Additional server settings (JSON)", size: "xs" },
          { type: "textInput", key: "project-settings", value: this.project.settingsText ?? JSON.stringify(config.settings, null, 2), multiline: true, rows: 3, changeAction: "languageAdvanced" },
          { type: "label", key: "scope", text: "Saved for this workspace, including its SSH machine. Maven/Gradle own their source folders and dependencies. The JDTLS tooling JVM is separate from your project JDK.", wrap: true, size: "xs", color: "muted" });
      }
      if (this.browsing) children.push({ type: "column", key: "folders", gap: 3, children: [
        { type: "label", key: "path", text: `Workspace folder: ${this.browsing.path}`, wrap: true },
        { type: "row", key: "folder-actions", gap: 6, children: [
          { type: "button", key: "up", text: "Up", action: "languageBrowseDir", value: this.browsing.path.split("/").slice(0,-1).join("/") || ".", disabled: this.browsing.path === ".", small: true },
          { type: "button", key: "choose", text: "Use this folder", action: "languageChooseDir", small: true },
          { type: "button", key: "cancel", text: "Cancel", action: "languageCancelBrowse", small: true, variant: "ghost" },
        ] },
        ...this.browsing.entries.map((entry: any): UiNode => ({ type: "button", key: entry.relativePath, text: entry.name + "/", action: "languageBrowseDir", value: entry.relativePath, variant: "ghost", small: true })),
      ] });
      children.push({ type: "row", key: "actions", gap: 6, children: [
        { type: "button", key: "save", text: "Apply and restart", action: "languageApply", disabled: this.busy || !this.project },
        { type: "button", key: "restart", text: "Restart server", action: "languageRestart", disabled: this.busy || this.project?.config.enabled === false },
      ] });
      children.push({type:"button",key:"reindex",text:"Rebuild server index",action:"languageReindex",disabled:this.busy||this.project?.config.enabled===false,tooltip:"Start with a fresh server index outside the checkout. Source and build files are preserved."});
      children.push({type:"button",key:"logs",text:"Read server log",action:"languageLogs",small:true});
      if(this.fullLog)children.push({type:"label",key:"full-log",text:this.fullLog,wrap:true,size:"xs",selectable:true});
      for (const [index, line] of (this.status?.log || []).slice(-5).entries()) children.push({ type: "label", key: `log-${index}`, text: line, wrap: true, size: "xs", color: "muted" });
    }
    if (this.browsing) {
      const folders = children.find(n => n.key === "folders");
      children.splice(1, children.length-1, ...(this.error ? [{type:"status",key:"folder-error",text:this.error,level:"error"} as UiNode] : []), ...(folders ? [folders] : []));
    }
    function left(node: UiNode): UiNode {
      const n: any = node;
      return {...n, style:{...n.style, ...(n.type==="button"?{justify:"start",fullWidth:true}:{}), ...(n.type==="toggle"?{justify:"start",fullWidth:true}:{})}, ...(n.type==="select"?{buttonStyle:{...n.buttonStyle,justify:"start",fullWidth:true}}:{}), ...(n.children ? {children:n.children.map(left)} : {})};
    }
    return { type: "modal", key: "language-project", title: this.browsing ? "Choose workspace folder" : "Language services", width: 720, closeAction: "languageClose", style: { background: "panel", borderWidth: 1, borderColor: "border", radius: 8, padding: 12 }, children: [{ type: "scroll", key: "body", height: 580, children: [{ type: "column", key: "content", gap: 8, children: children.map(left) }] }] };
  }
  async event(ctx: ModuleContext, ev: UiEvent, request: () => any, navigate: (symbol: any) => void): Promise<boolean> {
    if (!ev.action.startsWith("language")) return false;
    if (ev.action.startsWith("languageBrowse:")) ev = {...ev,action:"languageBrowse",value:ev.action.slice("languageBrowse:".length)};
    const epoch = this.epoch, args = { workspaceId: this.workspaceId, serverId: this.serverId };
    if (ev.action === "languagePanel") { this.open = !this.open; this.picking = false; }
    else if (ev.action === "languageClose") this.open = this.picking = false;
    else if (ev.action === "languageSymbolScope") { this.scope = ev.value === "file" ? "file" : "project"; this.symbols=[]; this.filter=""; }
    else if (ev.action === "languageFilter") {
      this.filter = String(ev.value ?? "");
      if(this.scope === "project") {
        if(this.searchTimer)clearTimeout(this.searchTimer);
        this.searchTimer=setTimeout(()=>{this.searchTimer=null;if(epoch===this.epoch)void this.event(ctx,{...ev,action:"languageSymbols"},request,navigate);},300);
      }
    }
    else if (ev.action === "languageEnabled" && this.project) this.project.config.enabled = !!ev.value;
    else if (ev.action === "languageField" && this.project) this.project.config.values[ev.key] = !!ev.value;
    else if (ev.action === "languageText" && this.project) this.project.config.values[ev.key.replace(/^project-/, "")] = String(ev.value ?? "");
    else if (ev.action === "languageAdvanced" && this.project) this.project.settingsText = String(ev.value ?? "");
    else if(ev.action === "languageLogs") {
      try{const result=await ctx.modules.call("language-service","logs",args);if(epoch===this.epoch)this.fullLog=result.log;}catch(e){if(epoch===this.epoch)this.error=errMsg(e);}
    }
    else if (ev.action === "languageCancelBrowse") this.browsing = null;
    else if (ev.action === "languageChooseDir" && this.browsing && this.project) {
      const { field, path } = this.browsing;
      const schema = this.project.schema.fields.find((f: any) => f.key === field);
      const previous = this.project.config.values[field] || [];
      this.project.config.values[field] = schema.type === "paths" ? [...new Set([...(Array.isArray(previous) ? previous : String(previous).split(/\r?\n/).filter(Boolean)), path])] : path;
      this.browsing = null;
    }
    else if (["languageBrowse", "languageBrowseDir"].includes(ev.action) && this.project) {
      if (this.busy) return true;
      const field = ev.action === "languageBrowse" ? String(ev.value) : this.browsing?.field;
      if (!this.project.schema?.fields.some((f: any) => f.key === field && f.directory)) return true;
      const path = ev.action === "languageBrowse" ? "." : String(ev.value);
      this.busy = true; ctx.ui.invalidate();
      try {
        const result = await ctx.modules.call("files", "list", { workspaceId: this.workspaceId, relativeDir: path });
        if (epoch === this.epoch) this.browsing = { field: field!, path, entries: result.entries.filter((entry: any) => entry.kind === "dir").slice(0,500) };
      } catch (e) { if (epoch === this.epoch) this.error = errMsg(e); }
      finally { if (epoch === this.epoch) this.busy = false; }
    }
    else if (ev.action === "languageSymbol") { const symbol = this.symbols[Number(ev.value)]; if (symbol) navigate(symbol); this.picking = false; }
    else if (["languageApply", "languageRestart", "languageReindex", "languageSymbols"].includes(ev.action)) {
      if (this.busy && ev.action !== "languageSymbols") return true;
      const searchVersion=++this.searchVersion;
      this.busy = true; this.error = null;
      if (ev.action === "languageSymbols") { this.picking = true; this.open = false; }
      ctx.ui.invalidate();
      try {
        if (ev.action === "languageApply") {
          const config = { ...this.project.config, values: { ...this.project.config.values } };
          for (const field of this.project.schema?.fields || []) if (field.type !== "toggle" && ev.inputs?.[`project-${field.key}`] !== undefined) config.values[field.key] = ev.inputs[`project-${field.key}`];
          config.settings = JSON.parse(ev.inputs?.["project-settings"] ?? this.project.settingsText ?? JSON.stringify(config.settings));
          await ctx.modules.call("language-service", "project.set", { ...args, config }, { timeoutMs: 175000 });
          if (epoch !== this.epoch) return true;
          this.project.config = config;
          if (config.enabled) await ctx.modules.call("language-service", "restart", args, { timeoutMs: 175000 });
        } else if (["languageRestart","languageReindex"].includes(ev.action)) {
          await ctx.modules.call("language-service", ev.action === "languageReindex" ? "reindex" : "restart", args, { timeoutMs: 175000 });
          if (epoch !== this.epoch) return true;
          const document=request();
          if(typeof document?.text === "string")await ctx.modules.call("language-service", "synchronize", document, { timeoutMs: 175000 });
        } else {
          const symbols = await ctx.modules.call("language-service", this.scope === "project" ? "workspaceSymbols" : "symbols", this.scope === "project" ? {...args,query:this.filter} : request(), { timeoutMs: 175000 });
          if (epoch === this.epoch && searchVersion === this.searchVersion) this.symbols = symbols;
        }
      } catch (e) { if (epoch === this.epoch) this.error = errMsg(e); }
      finally { if (epoch === this.epoch && searchVersion === this.searchVersion) this.busy = false; }
    }
    ctx.ui.invalidate(); return true;
  }
}
