import type {ModuleContext} from "@hato/sdk/types";
import {targetFor, type WorkspaceDescriptor} from "@hato/sdk/runtime";
import {get} from "@hato/sdk/scoped-settings";
const SCRIPT = `import os,pathlib,hashlib,json,sys
key=os.path.realpath(sys.argv[1])+'|'+sys.argv[2]+'|'+sys.argv[3]
base=pathlib.Path(os.environ.get('HATO_LANGUAGE_SERVER_DATA_HOME') or str(pathlib.Path.home()/'.local/share/hato/language-tools/workspaces'))
root=base/sys.argv[2]/hashlib.sha256(key.encode()).hexdigest()[:24]
root.mkdir(parents=True,exist_ok=True,mode=0o700)
print(json.dumps(str(root)))`;
export async function serverData(ctx: ModuleContext, d: WorkspaceDescriptor, serverId: string, grant: string) {
  const generation = await get(ctx, `language-server.${serverId}.index`, d);
  const result = await ctx.host.process.run(grant, { target: await targetFor(ctx,d), executable: "python3", args: ["-c", SCRIPT, d.rootAbsolutePath, serverId, String(generation?.value || "1")], cwd: d.rootAbsolutePath, loginShell: d.location === "ssh" }, {timeoutMs:30000});
  if(result.code!==0)throw new Error(`Cannot create language-server data directory on ${d.machineId}: ${result.stderr}`);
  const path=JSON.parse(result.stdout.trim().split(/\r?\n/).pop()!);
  if(typeof path!=="string"||!path.startsWith("/")||/[\r\n\0]/.test(path))throw new Error("Invalid server data directory");
  return path;
}
