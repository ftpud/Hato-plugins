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
function hasher() {
  const buf = new Uint8Array(64);
  const view = new DataView(buf.buffer);
  let used = 0;
  let length = 0;
  const H = new Uint32Array([1779033703, 3144134277, 1013904242, 2773480762, 1359893119, 2600822924, 528734635, 1541459225]);
  const W = new Uint32Array(64);
  const compress = () => {
    for (let i = 0; i < 16; i++) W[i] = view.getUint32(i * 4);
    for (let i = 16; i < 64; i++) {
      const a2 = W[i - 15], b2 = W[i - 2];
      const s0 = (a2 >>> 7 | a2 << 25) ^ (a2 >>> 18 | a2 << 14) ^ a2 >>> 3;
      const s1 = (b2 >>> 17 | b2 << 15) ^ (b2 >>> 19 | b2 << 13) ^ b2 >>> 10;
      W[i] = W[i - 16] + s0 + W[i - 7] + s1 >>> 0;
    }
    let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (let i = 0; i < 64; i++) {
      const S1 = (e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7);
      const ch = e & f ^ ~e & g;
      const t1 = h + S1 + ch + K[i] + W[i] >>> 0;
      const S0 = (a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10);
      const mj = a & b ^ a & c ^ b & c;
      const t2 = S0 + mj >>> 0;
      h = g;
      g = f;
      f = e;
      e = d + t1 >>> 0;
      d = c;
      c = b;
      b = a;
      a = t1 + t2 >>> 0;
    }
    H[0] = H[0] + a >>> 0;
    H[1] = H[1] + b >>> 0;
    H[2] = H[2] + c >>> 0;
    H[3] = H[3] + d >>> 0;
    H[4] = H[4] + e >>> 0;
    H[5] = H[5] + f >>> 0;
    H[6] = H[6] + g >>> 0;
    H[7] = H[7] + h >>> 0;
  };
  const byte = (b) => {
    buf[used++] = b;
    length++;
    if (used === 64) {
      compress();
      used = 0;
    }
  };
  const update = (text, from, to) => {
    let i = from;
    for (; i < to; i++) {
      let c = text.charCodeAt(i);
      if (c >= 55296 && c <= 56319) {
        const d = text.charCodeAt(i + 1);
        if (d >= 56320 && d <= 57343) {
          c = 65536 + (c - 55296 << 10) + d - 56320;
          i++;
        } else c = 65533;
      } else if (c >= 56320 && c <= 57343) c = 65533;
      if (c < 128) byte(c);
      else if (c < 2048) {
        byte(192 | c >> 6);
        byte(128 | c & 63);
      } else if (c < 65536) {
        byte(224 | c >> 12);
        byte(128 | c >> 6 & 63);
        byte(128 | c & 63);
      } else {
        byte(240 | c >> 18);
        byte(128 | c >> 12 & 63);
        byte(128 | c >> 6 & 63);
        byte(128 | c & 63);
      }
    }
    return i;
  };
  const finish = () => {
    const bits = length * 8;
    byte(128);
    while (used !== 56) byte(0);
    view.setUint32(56, Math.floor(bits / 4294967296));
    view.setUint32(60, bits >>> 0);
    compress();
    let out = "";
    for (let i = 0; i < 8; i++) out += H[i].toString(16).padStart(8, "0");
    return out;
  };
  return { update, finish };
}
function sha256Hex(text) {
  const h = hasher();
  h.update(text, 0, text.length);
  return h.finish();
}

// ../sdk/runtime.ts
function cloudMachineId(server, hostId) {
  return "cloud:" + sha256Hex(hostId + " on " + server.replace(/^http/, "ws"));
}
function projectWorkspaceId(project) {
  return project.kind === "cloud" && !project.rootWorkspace ? `cloud:${project.id}` : `project:${project.id}:root`;
}
function sshFromProfile(p) {
  const password = p.authRef === "password";
  return { profileId: p.id, host: p.host, port: p.port, user: p.user, identityFile: p.authRef && p.authRef !== "agent" && !password ? p.authRef : null, transport: p.transport ?? "ssh", ...password ? { auth: "password" } : {} };
}

// modules/services/workspace/src/index.ts
var selectedId = null;
async function resolve(ctx, workspaceId) {
  if (typeof workspaceId !== "string") throw new Error("workspaceId required");
  let project;
  let task = null;
  const cloud = /^cloud:([0-9a-f-]+)$/.exec(workspaceId);
  const root = /^project:([0-9a-f-]+):root$/.exec(workspaceId);
  if (cloud || root) {
    project = await ctx.modules.call("persistence", "projects.get", { id: (cloud || root)[1] });
    if (cloud && !project) {
      const item = await ctx.modules.call("persistence", "settings.get", { key: `workspace.${workspaceId}` });
      if (item?.location === "cloud" && item.id === workspaceId) return item;
    }
    if (cloud && project?.kind !== "cloud") throw new Error("Unknown Cloud workspace.");
  } else {
    const t = /^task:([0-9a-f-]+)$/.exec(workspaceId);
    if (!t) throw new Error(`malformed workspace id ${workspaceId}`);
    task = await ctx.modules.call("persistence", "tasks.get", { id: t[1] });
    if (!task) throw new Error(`unknown task ${t[1]}`);
    project = await ctx.modules.call("persistence", "projects.get", { id: task.projectId });
  }
  if (!project) throw new Error(`unknown workspace ${workspaceId}`);
  let ssh = null;
  if (project.kind === "ssh") {
    const p = await ctx.modules.call("persistence", "ssh.get", { id: project.sshProfileId });
    if (!p) throw new Error(`SSH profile ${project.sshProfileId} missing`);
    ssh = sshFromProfile(p);
  }
  return {
    id: task ? `task:${task.id}` : projectWorkspaceId(project),
    projectId: project.id,
    taskId: task ? task.id : null,
    name: task ? `${project.name} / ${task.name}` : project.name,
    location: project.kind,
    machineId: project.kind === "cloud" ? cloudMachineId(project.cloudOrigin, project.cloudHostId) : project.kind === "ssh" ? `ssh:${project.sshProfileId}` : "local",
    ...project.kind === "cloud" ? { cloudHostId: project.cloudHostId } : {},
    rootAbsolutePath: task ? task.worktreePath : project.rootPath,
    connectionRef: project.kind === "ssh" ? project.sshProfileId : null,
    ssh,
    status: task ? task.status : "ready"
  };
}
async function publish(ctx) {
  if (!selectedId) {
    ctx.state.set("workspace.selected", null);
    return;
  }
  try {
    const d = await resolve(ctx, selectedId);
    const view = await ctx.modules.call("persistence", "views.get", { workspaceId: d.id });
    ctx.state.set("workspace.selected", { ...d, view });
  } catch (e) {
    ctx.log.warn("selected workspace no longer resolves:", e.message);
    selectedId = null;
    ctx.state.set("workspace.selected", null);
  }
}
var mod = {
  id: "workspace",
  moduleApiVersion: 1,
  async activate(ctx, prev) {
    selectedId = prev && prev.selectedId || await ctx.modules.call("persistence", "settings.get", { key: "workspace.selected" });
    await publish(ctx);
  },
  snapshot: () => ({ selectedId }),
  methods: {
    resolve: (ctx, a) => resolve(ctx, a.workspaceId),
    current: async (ctx) => selectedId ? resolve(ctx, selectedId) : null,
    currentId: () => selectedId,
    async select(ctx, a) {
      const d = await resolve(ctx, a.workspaceId);
      selectedId = d.id;
      await ctx.modules.call("persistence", "settings.set", { key: "workspace.selected", value: d.id });
      await publish(ctx);
      ctx.events.emit("workspace.selected", { workspaceId: d.id });
      return d;
    },
    /** Clear the selection when it points at a workspace being removed (ids in `workspaceIds`). */
    async forget(ctx, a) {
      const ids = Array.isArray(a.workspaceIds) ? a.workspaceIds.map(String) : [];
      if (!selectedId || !ids.includes(selectedId)) return false;
      selectedId = null;
      await ctx.modules.call("persistence", "settings.set", { key: "workspace.selected", value: null });
      await publish(ctx);
      ctx.events.emit("workspace.selected", { workspaceId: null });
      return true;
    },
    "view.get": (ctx, a) => ctx.modules.call("persistence", "views.get", { workspaceId: a.workspaceId }),
    async "view.patch"(ctx, a) {
      const v = await ctx.modules.call("persistence", "views.patch", { workspaceId: a.workspaceId, patch: a.patch });
      if (a.workspaceId === selectedId) await publish(ctx);
      ctx.events.emit("workspace.viewChanged", { workspaceId: a.workspaceId, changed: Object.keys(a.patch || {}), previewPath: a.patch?.previewPath });
      return v;
    },
    async refresh(ctx) {
      await publish(ctx);
      return null;
    }
  }
};
var index_default = mod;
export {
  index_default as default
};
