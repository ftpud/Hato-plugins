import type { ModuleContext, SpawnRequest } from "@hato/sdk/types";
import type { RunConfigDraft } from "@hato/sdk/run-configurations";
import { workspaceGrant, type WorkspaceDescriptor } from "@hato/sdk/runtime";

export type Launch = Pick<SpawnRequest, "executable" | "args" | "env" | "cwd">;
export const absoluteCwd = (d: WorkspaceDescriptor, relative: string) => relative === "." ? d.rootAbsolutePath : `${d.rootAbsolutePath.replace(/\/$/, "")}/${relative}`;
const javaTypes = /^(java-|spring-boot$|junit$)/;
function operand(value: string) {
  if (!value || value.startsWith("-")) throw new Error("The target cannot be a command-line option");
  return value;
}
export function launchEnvironment(c: RunConfigDraft): Record<string, string> {
  if (javaTypes.test(c.type)) return { ...(c.runtime ? { JAVA_HOME: c.runtime } : {}), ...c.env };
  return { ...(c.profiles[0] ? { NODE_ENV: c.profiles[0] } : {}), ...c.env };
}

export async function buildTools(ctx: ModuleContext, d: WorkspaceDescriptor, cwd: string) {
  // Keep wrapper selection on the workspace machine.
  const g = await workspaceGrant(ctx, d, "fs");
  const entries = (await ctx.host.fs.list(g.grant, cwd)).entries;
  const file = (name: string) => entries.some(e => e.name === name && (e.kind === "file" || e.kind === "symlink"));
  return { maven: file("mvnw") ? "./mvnw" : "mvn", gradle: file("gradlew") ? "./gradlew" : "gradle",
    hasMaven: file("pom.xml") || file("mvnw"), hasGradle: file("build.gradle") || file("build.gradle.kts") || file("gradlew") };
}

export async function launchCommand(ctx: ModuleContext, d: WorkspaceDescriptor, c: RunConfigDraft): Promise<Launch> {
  const cwd = absoluteCwd(d, c.cwd), env = launchEnvironment(c), target = operand(c.target);
  if (c.type === "node") return { cwd, env, executable: c.runtime || "node", args: [...c.runtimeArgs, "--", target, ...c.args] };
  if (c.type === "npm-script") return { cwd, env, executable: "npm", args: ["run", target, "--", ...c.args] };
  if (c.type === "jest" || c.type === "vitest") {
    const executable = c.runtime || "node";
    const cli = c.type === "jest" ? "node_modules/jest/bin/jest.js" : "node_modules/vitest/vitest.mjs";
    return { cwd, env, executable, args: [...c.runtimeArgs, cli, ...(c.type === "vitest" ? ["run"] : []), ...(target === "." ? [] : [target]), ...c.args] };
  }

  const tools = await buildTools(ctx, d, c.cwd);
  const mavenProfiles = c.profiles.length ? [`-P${c.profiles.join(",")}`] : [];
  const gradleProfiles = c.profiles.length ? [`-Pprofiles=${c.profiles.join(",")}`] : [];
  switch (c.type) {
    case "java-application": {
      const executable = env.JAVA_HOME ? env.JAVA_HOME.replace(/\/$/, "") + "/bin/java" : "java";
      const hasClasspath = c.runtimeArgs.some(a => ["-cp", "-classpath", "--class-path"].includes(a) || a.startsWith("--class-path="));
      const inferred = tools.hasMaven ? ["-cp", "target/classes:target/dependency/*"] :
        tools.hasGradle ? ["-cp", "build/classes/java/main:build/resources/main:build/dependencies/*"] : [];
      return { cwd, env, executable, args: [...(hasClasspath ? [] : inferred), ...c.runtimeArgs, target, ...c.args] };
    }
    case "java-maven": return { cwd, env, executable: tools.maven, args: [...mavenProfiles, ...c.runtimeArgs, target, ...c.args] };
    case "java-gradle": return { cwd, env, executable: tools.gradle, args: [...gradleProfiles, ...c.runtimeArgs, target, ...c.args] };
    case "spring-boot":
      if (tools.hasGradle && !tools.hasMaven) return { cwd, env: { SPRING_PROFILES_ACTIVE: c.profiles.join(","), ...env }, executable: tools.gradle, args: ["bootRun", ...c.runtimeArgs, ...c.args] };
      return { cwd, env, executable: tools.maven, args: ["spring-boot:run", `-Dspring-boot.run.main-class=${target}`,
        ...(c.profiles.length ? [`-Dspring-boot.run.profiles=${c.profiles.join(",")}`] : []), ...c.runtimeArgs, ...c.args] };
    case "junit":
      return tools.hasGradle && !tools.hasMaven
        ? { cwd, env, executable: tools.gradle, args: ["test", "--tests", target.replace("#", "."), ...gradleProfiles, ...c.runtimeArgs, ...c.args] }
        : { cwd, env, executable: tools.maven, args: ["test", `-Dtest=${target}`, ...mavenProfiles, ...c.runtimeArgs, ...c.args] };
    default: throw new Error(`Unsupported run configuration type: ${c.type}`);
  }
}
