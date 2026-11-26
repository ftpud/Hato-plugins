// ../sdk/run.ts
var RUN_EVENTS = {
  /** {workspaceId, sessions: RunSession[]} on any session state change. */
  changed: "run.changed",
  /** {workspaceId, id, seq} when new output is available (coalesced, at most ~10/s per session). */
  output: "run.output"
};
var runActive = (s) => s.state === "starting" || s.state === "running" || s.state === "paused" || s.state === "stopping";

// ../sdk/sha256.ts
var K = new Uint32Array([
  1116352408,
  1899447441,
  3049323471,
  3921009573,
  961987163,
  1508970993,
  2453635748,
  2870763221,
  3624381080,
  310598401,
  607225278,
  1426881987,
  1925078388,
  2162078206,
  2614888103,
  3248222580,
  3835390401,
  4022224774,
  264347078,
  604807628,
  770255983,
  1249150122,
  1555081692,
  1996064986,
  2554220882,
  2821834349,
  2952996808,
  3210313671,
  3336571891,
  3584528711,
  113926993,
  338241895,
  666307205,
  773529912,
  1294757372,
  1396182291,
  1695183700,
  1986661051,
  2177026350,
  2456956037,
  2730485921,
  2820302411,
  3259730800,
  3345764771,
  3516065817,
  3600352804,
  4094571909,
  275423344,
  430227734,
  506948616,
  659060556,
  883997877,
  958139571,
  1322822218,
  1537002063,
  1747873779,
  1955562222,
  2024104815,
  2227730452,
  2361852424,
  2428436474,
  2756734187,
  3204031479,
  3329325298
]);

// ../sdk/runtime.ts
var grantCache = /* @__PURE__ */ new Map();
var sshCache = /* @__PURE__ */ new Map();
function sshProfileSpec(ssh) {
  return { profileId: ssh.profileId, host: ssh.host, port: ssh.port, user: ssh.user, identityFile: ssh.identityFile ?? null, transport: ssh.transport ?? "ssh", ...ssh.auth ? { auth: ssh.auth } : {} };
}
function sshConnect(ctx, desc) {
  if (desc.location !== "ssh" || !desc.ssh) throw new Error("not an SSH workspace");
  const key = desc.machineId;
  let p = sshCache.get(key);
  if (!p) {
    p = ctx.host.ssh.connect(sshProfileSpec(desc.ssh));
    sshCache.set(key, p);
    p.catch(() => sshCache.delete(key));
  }
  return p;
}
function forgetSsh(machineId) {
  sshCache.delete(machineId);
  for (const k of Array.from(grantCache.keys())) if (k.includes("|" + machineId + "|")) grantCache.delete(k);
}
async function daemonTargetFor(ctx, desc) {
  switch (desc.location) {
    case "local":
      return { kind: "local" };
    case "ssh":
      return { kind: "ssh", connection: (await sshConnect(ctx, desc)).connection };
    case "cloud": {
      if (!desc.cloudHostId) throw new Error("Cloud workspace is missing its host.");
      const target = await ctx.modules.call("cloud", "target", {
        hostId: desc.cloudHostId,
        machineId: desc.machineId
      }, { timeoutMs: 62e4 });
      if (target?.kind !== "cloud" || !target.connection) throw new Error("Invalid Cloud daemon route.");
      return target;
    }
    default:
      throw new Error("Unsupported workspace location.");
  }
}
async function targetFor(ctx, desc) {
  if (desc.location === "local") return { kind: "local" };
  if (desc.location === "cloud") return daemonTargetFor(ctx, desc);
  const c = await sshConnect(ctx, desc);
  return { kind: "ssh", connection: c.connection, machineId: c.machineId };
}
async function workspaceGrant(ctx, desc, kind, root) {
  const r = root || desc.rootAbsolutePath;
  const cloud = desc.location === "cloud" ? await targetFor(ctx, desc) : null;
  const key = kind + "|" + desc.machineId + "|" + r + "|" + (cloud?.kind === "cloud" ? cloud.connection : "");
  let p = grantCache.get(key);
  if (!p) {
    p = (async () => {
      const target = cloud ?? await targetFor(ctx, desc);
      return ctx.host.capabilities.request({ kind, root: r, target });
    })();
    grantCache.set(key, p);
    p.catch(() => grantCache.delete(key));
  }
  try {
    return await p;
  } catch (e) {
    if (e && (e.code === "ENOTCONN" || e.code === "EBADF")) forgetSsh(desc.machineId);
    throw e;
  }
}
function errMsg(e) {
  return e && (e.message || String(e)) || "unknown error";
}

// ../sdk/mcp.ts
function exportMcpTools(ctx, title, tools) {
  let pending = 0;
  const publish = () => ctx.state.set(`${ctx.moduleId}.mcp`, {
    title,
    generation: ctx.generation,
    tools: tools.map(({ handler: _handler, ...definition }) => definition)
  });
  ctx.events.on("internal-mcp.call", async (request) => {
    if (request?.module !== ctx.moduleId || request.generation !== ctx.generation || typeof request.id !== "string") return;
    const tool = tools.find((tool2) => tool2.name === request.tool);
    pending++;
    try {
      if (!tool) throw new Error("Unknown module MCP command");
      const scope = request.scope;
      if (!scope || typeof scope.workspaceId !== "string" || typeof scope.conversationId !== "string" || typeof scope.machineId !== "string") throw new Error("Missing authenticated MCP scope");
      const result = await tool.handler(request.args || {}, scope);
      ctx.events.emit(`${ctx.moduleId}.mcp.result`, { id: request.id, generation: ctx.generation, result: result === void 0 ? null : result });
    } catch (e) {
      ctx.events.emit(`${ctx.moduleId}.mcp.result`, { id: request.id, generation: ctx.generation, error: errMsg(e) });
    } finally {
      pending--;
    }
  });
  publish();
  return { publish, pending: () => pending };
}

// modules/services/run/src/launch.ts
var absoluteCwd = (d, relative) => relative === "." ? d.rootAbsolutePath : `${d.rootAbsolutePath.replace(/\/$/, "")}/${relative}`;
var javaTypes = /^(java-|spring-boot$|junit$)/;
function operand(value) {
  if (!value || value.startsWith("-")) throw new Error("The target cannot be a command-line option");
  return value;
}
function launchEnvironment(c) {
  if (javaTypes.test(c.type)) return { ...c.runtime ? { JAVA_HOME: c.runtime } : {}, ...c.env };
  return { ...c.profiles[0] ? { NODE_ENV: c.profiles[0] } : {}, ...c.env };
}
async function buildTools(ctx, d, cwd) {
  const g = await workspaceGrant(ctx, d, "fs");
  const entries2 = (await ctx.host.fs.list(g.grant, cwd)).entries;
  const file = (name) => entries2.some((e) => e.name === name && (e.kind === "file" || e.kind === "symlink"));
  return {
    maven: file("mvnw") ? "./mvnw" : "mvn",
    gradle: file("gradlew") ? "./gradlew" : "gradle",
    hasMaven: file("pom.xml") || file("mvnw"),
    hasGradle: file("build.gradle") || file("build.gradle.kts") || file("gradlew")
  };
}
async function launchCommand(ctx, d, c) {
  const cwd = absoluteCwd(d, c.cwd), env = launchEnvironment(c), target = operand(c.target);
  if (c.type === "node") return { cwd, env, executable: c.runtime || "node", args: [...c.runtimeArgs, "--", target, ...c.args] };
  if (c.type === "npm-script") return { cwd, env, executable: "npm", args: ["run", target, "--", ...c.args] };
  if (c.type === "jest" || c.type === "vitest") {
    const executable = c.runtime || "node";
    const cli = c.type === "jest" ? "node_modules/jest/bin/jest.js" : "node_modules/vitest/vitest.mjs";
    return { cwd, env, executable, args: [...c.runtimeArgs, cli, ...c.type === "vitest" ? ["run"] : [], ...target === "." ? [] : [target], ...c.args] };
  }
  const tools = await buildTools(ctx, d, c.cwd);
  const mavenProfiles = c.profiles.length ? [`-P${c.profiles.join(",")}`] : [];
  const gradleProfiles = c.profiles.length ? [`-Pprofiles=${c.profiles.join(",")}`] : [];
  switch (c.type) {
    case "java-application": {
      const executable = env.JAVA_HOME ? env.JAVA_HOME.replace(/\/$/, "") + "/bin/java" : "java";
      const hasClasspath = c.runtimeArgs.some((a) => ["-cp", "-classpath", "--class-path"].includes(a) || a.startsWith("--class-path="));
      const inferred = tools.hasMaven ? ["-cp", "target/classes:target/dependency/*"] : tools.hasGradle ? ["-cp", "build/classes/java/main:build/resources/main:build/dependencies/*"] : [];
      return { cwd, env, executable, args: [...hasClasspath ? [] : inferred, ...c.runtimeArgs, target, ...c.args] };
    }
    case "java-maven":
      return { cwd, env, executable: tools.maven, args: [...mavenProfiles, ...c.runtimeArgs, target, ...c.args] };
    case "java-gradle":
      return { cwd, env, executable: tools.gradle, args: [...gradleProfiles, ...c.runtimeArgs, target, ...c.args] };
    case "spring-boot":
      if (tools.hasGradle && !tools.hasMaven) return { cwd, env: { SPRING_PROFILES_ACTIVE: c.profiles.join(","), ...env }, executable: tools.gradle, args: ["bootRun", ...c.runtimeArgs, ...c.args] };
      return { cwd, env, executable: tools.maven, args: [
        "spring-boot:run",
        `-Dspring-boot.run.main-class=${target}`,
        ...c.profiles.length ? [`-Dspring-boot.run.profiles=${c.profiles.join(",")}`] : [],
        ...c.runtimeArgs,
        ...c.args
      ] };
    case "junit":
      return tools.hasGradle && !tools.hasMaven ? { cwd, env, executable: tools.gradle, args: ["test", "--tests", target.replace("#", "."), ...gradleProfiles, ...c.runtimeArgs, ...c.args] } : { cwd, env, executable: tools.maven, args: ["test", `-Dtest=${target}`, ...mavenProfiles, ...c.runtimeArgs, ...c.args] };
    default:
      throw new Error(`Unsupported run configuration type: ${c.type}`);
  }
}
var JDWP = "-agentlib:jdwp=transport=dt_socket,server=y,suspend=y,address=127.0.0.1:0";
var JDWP_LISTENING = /Listening for transport dt_socket at address: (\d+)/;
function javaDebugLaunch(c, launch) {
  const gradle = /gradlew?$/.test(launch.executable);
  switch (c.type) {
    case "java-application":
      return { ...launch, args: [JDWP, ...launch.args] };
    case "spring-boot":
      return gradle ? { ...launch, args: [...launch.args, "--debug-jvm"] } : { ...launch, args: [...launch.args.slice(0, 1), `-Dspring-boot.run.jvmArguments=${JDWP}`, ...launch.args.slice(1)] };
    case "junit":
      return gradle ? { ...launch, args: [...launch.args, "--debug-jvm"] } : { ...launch, args: [...launch.args, `-Dmaven.surefire.debug=${JDWP}`, "-DforkCount=1"] };
    default:
      throw new Error(`Debugging isn't supported for ${c.type}`);
  }
}

// ../sdk/debug.ts
var DEBUG_TYPES = { js: ["node", "npm-script", "jest", "vitest"], java: ["java-application", "spring-boot", "junit"] };
var debugKind = (type) => DEBUG_TYPES.js.includes(type) ? "js" : DEBUG_TYPES.java.includes(type) ? "java" : null;

// modules/services/run/src/index.ts
var entries = /* @__PURE__ */ new Map();
var mcp;
var maximumBytes = 512 * 1024;
var maximumChunks = 2400;
var byWorkspace = (id) => [...entries.values()].filter((e) => e.session.workspaceId === id);
var list = (id) => byWorkspace(id).map((e) => ({ ...e.session }));
var changed = (ctx, id) => ctx.events.emit(RUN_EVENTS.changed, { workspaceId: id, sessions: list(id) });
var pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function entry(id, workspaceId) {
  const found = entries.get(id);
  if (!found || found.session.workspaceId !== workspaceId) throw new Error("Run session was not found in this workspace");
  return found;
}
function append(ctx, e, stream, text) {
  if (!text) return;
  const chunk = text.slice(-maximumBytes);
  if (chunk.length !== text.length) e.dropped = true;
  e.chunks.push({ seq: ++e.seq, stream, text: chunk });
  e.size += chunk.length;
  while (e.chunks.length > maximumChunks || e.size > maximumBytes) {
    e.size -= e.chunks.shift().text.length;
    e.dropped = true;
  }
  if (!e.outputTimer) e.outputTimer = setTimeout(() => {
    e.outputTimer = void 0;
    ctx.events.emit(RUN_EVENTS.output, { workspaceId: e.session.workspaceId, id: e.session.id, seq: e.seq });
  }, 100);
}
async function workspace(ctx, workspaceId) {
  if (typeof workspaceId !== "string" || !workspaceId) throw new Error("Select a workspace");
  return ctx.modules.call("workspace", "resolve", { workspaceId });
}
async function command(ctx, d, e, launch, main = false, watch) {
  const grant = await workspaceGrant(ctx, d, "process");
  const target = await targetFor(ctx, d);
  if (e.cancelled) return null;
  const { handle } = await ctx.host.process.spawn(grant.grant, { ...launch, target, loginShell: d.location !== "local" });
  e.handle = handle;
  if (main && !e.cancelled) {
    e.session.state = "running";
    delete e.session.phase;
    changed(ctx, d.id);
  }
  const subs = [], drained = [];
  try {
    for (const channel of ["stdout", "stderr"]) {
      let finish;
      const eof = new Promise((resolve) => {
        finish = resolve;
      });
      drained.push(eof);
      subs.push(await ctx.host.streams.listen(handle, { channel }, (text) => {
        append(ctx, e, channel, text);
        watch?.(text);
      }, () => finish()));
    }
    if (e.cancelled) await ctx.host.process.terminate(handle, e.killing ? "SIGKILL" : "SIGTERM");
    await ctx.host.process.closeStdin(handle).catch(() => {
    });
    const exit = await ctx.host.process.wait(handle);
    await Promise.race([Promise.all(drained), pause(1e3)]);
    return exit;
  } catch (error) {
    await ctx.host.process.terminate(handle, "SIGKILL").catch(() => {
    });
    throw error;
  } finally {
    e.handle = null;
    await Promise.allSettled(subs.map((sub) => sub.close()));
    await ctx.host.resources.release(handle).catch(() => {
    });
  }
}
async function configuration(ctx, d, source) {
  return ctx.modules.call("run-configurations", "resolveLaunch", { workspaceId: d.id, ...source });
}
async function execute(ctx, d, e, c, chain, main) {
  for (const step of c.beforeLaunch) {
    if (e.cancelled) return null;
    const relative = step.cwd || c.cwd, cwd = absoluteCwd(d, relative), env = launchEnvironment(c);
    e.session.phase = `Before launch · ${step.kind === "configuration" ? "Run config" : step.executable}`;
    changed(ctx, d.id);
    if (step.kind === "configuration") {
      if (chain.has(step.executable) || chain.size > 12) throw new Error("Before-launch configurations refer to each other");
      const next = await configuration(ctx, d, { configId: step.executable });
      const exit2 = await execute(ctx, d, e, next, /* @__PURE__ */ new Set([...chain, step.executable]), false);
      if (!e.cancelled && exit2?.code !== 0) throw new Error("A before-launch configuration failed");
      continue;
    }
    let launch2 = { executable: step.executable, args: step.args, cwd, env };
    if (step.kind === "npm") launch2 = { ...launch2, executable: "npm", args: ["run", step.executable, "--", ...step.args] };
    if (step.kind === "build") {
      const tools = await buildTools(ctx, d, relative);
      launch2 = { ...launch2, executable: tools.hasGradle && !tools.hasMaven ? tools.gradle : tools.maven, args: [step.executable, ...step.args] };
    }
    const exit = await command(ctx, d, e, launch2);
    if (!e.cancelled && exit?.code !== 0) throw new Error(`Before-launch step failed${exit?.code == null ? "" : ` (exit ${exit.code})`}`);
  }
  if (e.cancelled) return null;
  const launch = await launchCommand(ctx, d, c);
  if (e.cancelled) return null;
  if (main && e.session.mode === "debug") return debugMain(ctx, d, e, c, launch);
  append(ctx, e, "system", `Starting ${c.name}
`);
  return command(ctx, d, e, launch, main);
}
async function debugMain(ctx, d, e, c, launch) {
  const kind = debugKind(c.type);
  if (!kind) throw new Error(`Debugging isn't supported for ${c.type}`);
  append(ctx, e, "system", `Debugging ${c.name}
`);
  if (kind === "js") {
    const ended = new Promise((resolve) => {
      e.debug = { kind, attached: true, scan: "", done: (code) => resolve({ code, signal: null }) };
    });
    e.session.phase = "Starting the debugger…";
    changed(ctx, d.id);
    await ctx.modules.call("debug", "launchJs", { workspaceId: d.id, id: e.session.id, name: c.name, type: c.type, launch }, { timeoutMs: 15 * 60 * 1e3 });
    if (!e.cancelled && e.session.state === "starting") {
      e.session.state = "running";
      delete e.session.phase;
      changed(ctx, d.id);
    }
    return ended;
  }
  e.debug = { kind, attached: false, scan: "" };
  const debugged = javaDebugLaunch(c, launch);
  try {
    return await command(ctx, d, e, debugged, true, (text) => {
      const dbg = e.debug;
      if (dbg.attached) return;
      dbg.scan = (dbg.scan + text).slice(-400);
      const port = JDWP_LISTENING.exec(dbg.scan)?.[1];
      if (!port) return;
      dbg.attached = true;
      void ctx.modules.call("debug", "attachJava", { workspaceId: d.id, id: e.session.id, name: c.name, port: Number(port) }, { timeoutMs: 15 * 60 * 1e3 }).catch((error) => append(ctx, e, "system", `The debugger could not attach: ${errMsg(error)}
`));
    });
  } finally {
    await ctx.modules.call("debug", "end", { workspaceId: d.id, id: e.session.id }).catch(() => {
    });
  }
}
async function stop(ctx, e, force = false) {
  if (!runActive(e.session)) return { ...e.session };
  e.cancelled = true;
  e.killing || (e.killing = force);
  e.session.state = "stopping";
  changed(ctx, e.session.workspaceId);
  if (e.debug) {
    await ctx.modules.call("debug", "end", { workspaceId: e.session.workspaceId, id: e.session.id }, { timeoutMs: 15e3 }).catch(() => {
    });
    e.debug.done?.(null);
  }
  if (e.handle) await ctx.host.process.terminate(e.handle, force ? "SIGKILL" : "SIGTERM").catch(() => {
  });
  if (!force) {
    await Promise.race([e.completion, pause(2e3)]);
    if (runActive(e.session)) {
      e.killing = true;
      if (e.handle) await ctx.host.process.terminate(e.handle, "SIGKILL").catch(() => {
      });
    }
  }
  await e.completion;
  return { ...e.session };
}
function prune(ctx, workspaceId, keep = 40) {
  const ended = byWorkspace(workspaceId).filter((e) => !runActive(e.session));
  for (const e of ended.slice(0, Math.max(0, ended.length - keep))) {
    if (e.outputTimer) clearTimeout(e.outputTimer);
    entries.delete(e.session.id);
  }
  changed(ctx, workspaceId);
}
async function start(ctx, d, a) {
  if (a.mode !== "run" && a.mode !== "debug") throw new Error("Choose run or debug");
  if (!!a.configId === !!a.candidate) throw new Error("Choose one saved or detected configuration");
  const config = await configuration(ctx, d, a);
  const key = a.configId ? `saved:${a.configId}` : JSON.stringify([config.type, config.cwd, config.target]);
  let duplicate = byWorkspace(d.id).find((e2) => runActive(e2.session) && e2.key === key);
  if (duplicate && a.restart) await stop(ctx, duplicate);
  duplicate = byWorkspace(d.id).find((e2) => runActive(e2.session) && e2.key === key);
  if (duplicate) throw new Error("This configuration is already running");
  if (byWorkspace(d.id).filter((e2) => runActive(e2.session)).length >= 24) throw new Error("Stop a run before starting another one");
  const session = {
    id: crypto.randomUUID(),
    workspaceId: d.id,
    configId: a.configId || null,
    name: config.name,
    type: config.type,
    mode: a.mode,
    state: "starting",
    startedAt: Date.now()
  };
  if (a.mode === "debug") {
    if (!debugKind(config.type)) throw new Error(`Debugging isn't supported for ${config.type} configurations`);
    if (!await debugAvailable(ctx, d)) throw new Error("Install the Debugger to debug");
  }
  const e = {
    session,
    args: a,
    key,
    chunks: [],
    size: 0,
    dropped: false,
    seq: 0,
    handle: null,
    cancelled: false,
    killing: false,
    completion: Promise.resolve()
  };
  entries.set(session.id, e);
  changed(ctx, d.id);
  ctx.events.emit("run.reveal", { workspaceId: d.id, id: session.id });
  e.completion = (async () => {
    try {
      const exit = await execute(ctx, d, e, config, new Set(a.configId ? [a.configId] : []), true);
      session.exitCode = exit?.code ?? null;
      session.state = "exited";
      append(ctx, e, "system", e.cancelled ? "Stopped\n" : `Process finished with exit code ${session.exitCode ?? "unknown"}
`);
    } catch (error) {
      session.state = e.cancelled ? "exited" : "failed";
      if (!e.cancelled) session.error = errMsg(error);
      append(ctx, e, "system", e.cancelled ? "Stopped\n" : `${session.error}
`);
    } finally {
      session.endedAt = Date.now();
      delete session.phase;
      prune(ctx, d.id);
    }
  })();
  return { ...session };
}
async function debugAvailable(ctx, d) {
  return !!(await ctx.modules.call("debug", "capabilities", { workspaceId: d.id }).catch(() => null))?.debug;
}
function debugReport(ctx, d, a) {
  const e = entry(a.id, d.id);
  if (a.output && typeof a.output.text === "string") append(ctx, e, ["stdout", "stderr", "system"].includes(a.output.stream) ? a.output.stream : "stdout", a.output.text.slice(0, 65536));
  if (runActive(e.session) && e.session.state !== "stopping") {
    if (a.state === "paused") {
      e.session.state = "paused";
      if (a.pausedAt && typeof a.pausedAt.path === "string" && Number.isInteger(a.pausedAt.line)) e.session.pausedAt = { path: a.pausedAt.path, line: a.pausedAt.line, ...a.pausedAt.reason ? { reason: String(a.pausedAt.reason) } : {} };
      else delete e.session.pausedAt;
      changed(ctx, d.id);
    } else if (a.state === "running") {
      e.session.state = "running";
      delete e.session.pausedAt;
      delete e.session.phase;
      changed(ctx, d.id);
    }
  }
  if (a.ended && e.debug?.kind === "js") e.debug.done?.(Number.isInteger(a.exitCode) ? a.exitCode : null);
  return { ok: true };
}
async function invoke(ctx, d, method, a) {
  switch (method) {
    case "capabilities": {
      const caps = await ctx.modules.call("debug", "capabilities", { workspaceId: d.id }).catch(() => null);
      return caps?.debug ? { debug: true, debugTypes: caps.debugTypes || [] } : { debug: false, debugTypes: [] };
    }
    case "list":
      return list(d.id);
    case "start":
      return start(ctx, d, { ...a, workspaceId: d.id });
    case "stop":
      return stop(ctx, entry(a.id, d.id), a.force === true);
    case "restart": {
      const e = entry(a.id, d.id);
      await stop(ctx, e);
      return start(ctx, d, { ...e.args, restart: false });
    }
    case "output": {
      const e = entry(a.id, d.id), after = Number.isSafeInteger(a.after) && a.after >= 0 ? a.after : 0;
      const limit = Number.isInteger(a.limit) ? Math.max(1, Math.min(maximumChunks, a.limit)) : 400;
      const available = e.chunks.filter((c) => c.seq > after);
      const chunks = a.tail === true ? available.slice(-limit) : available.slice(0, limit);
      return { chunks, next: chunks[chunks.length - 1]?.seq ?? after, truncated: a.tail === true && available.length > limit || e.dropped && after < (e.chunks[0]?.seq ?? e.seq) - 1 };
    }
    case "clear":
      if (a.id) entry(a.id, d.id);
      for (const e of byWorkspace(d.id)) if ((!a.id || a.id === e.session.id) && !runActive(e.session)) {
        if (e.outputTimer) clearTimeout(e.outputTimer);
        entries.delete(e.session.id);
      }
      changed(ctx, d.id);
      return list(d.id);
  }
}
var string = { type: "string" };
var bool = { type: "boolean" };
var definitions = [
  ["capabilities", "Read run and debug support for this workspace.", {}, []],
  ["list", "List sessions in the authenticated workspace.", {}, []],
  ["start", "Run a saved configuration or detected candidate in the authenticated workspace. Requires native approval.", {
    configId: string,
    candidate: { type: "object", properties: { name: string, type: string, target: string, cwd: string, file: string, line: { type: "integer" } }, required: ["name", "type", "target", "cwd"], additionalProperties: false },
    mode: { enum: ["run", "debug"] },
    restart: bool
  }, ["mode"]],
  ["stop", "Stop a run session and wait for exit.", { id: string, force: bool }, ["id"]],
  ["restart", "Stop and start the session's configuration again. Requires native approval.", { id: string }, ["id"]],
  ["output", "Read bounded stdout, stderr and system output. Use next as after to continue.", { id: string, after: { type: "integer" }, limit: { type: "integer" }, tail: bool }, ["id"]],
  ["clear", "Clear ended sessions, optionally by session ID.", { id: string }, []]
];
var mod = {
  id: "run",
  moduleApiVersion: 1,
  activate(ctx, previous) {
    for (const saved of Array.isArray(previous) ? previous : []) {
      if (!saved?.session?.id || runActive(saved.session)) continue;
      entries.set(saved.session.id, { ...saved, handle: null, cancelled: false, killing: false, completion: Promise.resolve() });
    }
    ctx.events.on("viewer.startRunCandidate", async (candidate) => {
      if (candidate?.workspaceId !== ctx.state.get("workspace.selected")?.id) return;
      try {
        const d = await workspace(ctx, candidate.workspaceId);
        const { workspaceId: _w, mode, ...picked } = candidate;
        await start(ctx, d, { workspaceId: d.id, candidate: picked, mode: mode === "debug" ? "debug" : "run" });
      } catch (e) {
        ctx.host.ui.toast("error", errMsg(e));
      }
    });
    mcp = exportMcpTools(ctx, "Run sessions", definitions.map(([method, description, properties, required]) => ({
      name: `run_${method}`,
      description,
      inputSchema: { type: "object", properties, required, additionalProperties: false },
      annotations: { readOnlyHint: ["capabilities", "list", "output"].includes(method), destructiveHint: method === "clear" },
      timeoutMs: method === "start" || method === "restart" ? 175e3 : 3e4,
      handler: async (a, scope) => {
        const d = await workspace(ctx, scope.workspaceId);
        if (d.machineId !== scope.machineId) throw new Error("MCP machine scope does not match this workspace");
        if (method === "start" || method === "restart") {
          const target = method === "restart" ? entry(a.id, d.id).session.name : String(a.configId || a.candidate?.name || "").slice(0, 120);
          const result = await ctx.host.approvals.request({ operation: `run.${method}`, title: "Allow this agent to run code?", detail: `${d.name}
${target}`, timeoutMs: 16e4 });
          if (result.optionId !== "allow") throw new Error("Run approval was denied or expired");
        }
        return invoke(ctx, d, method, a);
      }
    })));
  },
  canSwap: () => ({ ok: !mcp?.pending() && ![...entries.values()].some((e) => runActive(e.session)), reason: "A run or agent command is active" }),
  deactivate() {
    for (const e of entries.values()) if (e.outputTimer) clearTimeout(e.outputTimer);
  },
  snapshot: () => [...entries.values()].map(({ session, args, key, chunks, size, dropped, seq }) => ({ session, args, key, chunks, size, dropped, seq })),
  methods: {
    ...Object.fromEntries(definitions.map(([method]) => [method, async (ctx, a) => invoke(ctx, await workspace(ctx, a.workspaceId), method, a)])),
    async debugReport(ctx, a, meta) {
      if (meta?.caller !== "debug") throw new Error("Only the debugger reports debug state");
      return debugReport(ctx, await workspace(ctx, a.workspaceId), a);
    }
  }
};
var index_default = mod;
export {
  index_default as default
};
