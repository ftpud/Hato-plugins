import type {ModuleContext} from "@hato/sdk/types";
import {targetFor, type WorkspaceDescriptor} from "@hato/sdk/runtime";
import {get} from "@hato/sdk/scoped-settings";
import {isAbsolutePath, workspaceOs} from "@hato/sdk/platform";
import {pythonCandidates} from "./dependencies";
const SCRIPT = `import os,pathlib,hashlib,json,sys
key=os.path.realpath(sys.argv[1])+'|'+sys.argv[2]+'|'+sys.argv[3]
base=pathlib.Path(os.environ.get('HATO_LANGUAGE_SERVER_DATA_HOME') or (os.path.join(os.environ['LOCALAPPDATA'],'Hato','language-tools','workspaces') if os.name=='nt' and os.environ.get('LOCALAPPDATA') else str(pathlib.Path.home()/'.local/share/hato/language-tools/workspaces')))
root=base/sys.argv[2]/hashlib.sha256(key.encode()).hexdigest()[:24]
root.mkdir(parents=True,exist_ok=True,mode=0o700)
print(json.dumps(str(root)))`;
export async function serverData(ctx: ModuleContext, d: WorkspaceDescriptor, serverId: string, grant: string) {
  const generation = await get(ctx, `language-server.${serverId}.index`, d);
  let result: any = null;
  for (const python of pythonCandidates(workspaceOs(ctx, d) === "windows")) {
    result = await ctx.host.process.run(grant, { target: await targetFor(ctx,d), executable: python.executable, args: [...python.args, "-c", SCRIPT, d.rootAbsolutePath, serverId, String(generation?.value || "1")], cwd: d.rootAbsolutePath, loginShell: d.location !== "local" }, {timeoutMs:30000}).catch((e: any) => ({ code: -1, stdout: "", stderr: String(e?.message || e) }));
    if (result.code === 0) break;
  }
  if(result.code!==0)throw new Error(`Cannot create language-server data directory on ${d.machineId}: ${result.stderr}`);
  const path=JSON.parse(result.stdout.trim().split(/\r?\n/).pop()!);
  if(typeof path!=="string"||!isAbsolutePath(path)||/[\r\n\0]/.test(path))throw new Error("Invalid server data directory");
  return path;
}
