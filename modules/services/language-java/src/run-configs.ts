import { runDirname, type RunCandidate, type RunConfigType, type RunDiscovery } from "@hato/sdk/run-configurations";

export const javaRunTypes: RunConfigType[] = [
  ["java-application", "Java application", "Main class", "Application profile"],
  ["java-maven", "Maven goal", "Goal", "Maven profile"],
  ["java-gradle", "Gradle task", "Task", "Build profile"],
  ["spring-boot", "Spring Boot", "Main class", "Spring profile"],
  ["junit", "JUnit test", "Test class", "Test profile"],
].map(([id, label, targetLabel, profileHint]) => ({ id, label, targetLabel, profileHint, runtimeLabel: "JDK home", runtimeHint: "Use workspace JAVA_HOME" }));

export function detectJavaRuns({ sources, paths }: RunDiscovery): RunCandidate[] {
  const candidates: RunCandidate[] = [];
  const roots = new Set<string>();
  for (const file of paths) {
    const name = file.split("/").pop();
    const cwd = runDirname(file);
    if (name === "pom.xml") {
      roots.add(cwd);
      for (const target of ["test", "package"]) candidates.push({ name: `Maven ${target}`, type: "java-maven", target, cwd, file, line: 0 });
    }
    if (name === "build.gradle" || name === "build.gradle.kts") {
      roots.add(cwd);
      for (const target of ["test", "build"]) candidates.push({ name: `Gradle ${target}`, type: "java-gradle", target, cwd, file, line: 0 });
    }
  }
  for (const { path: file, text } of sources) {
    if (!file.endsWith(".java")) continue;
    const source = text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|"""[\s\S]*?"""|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/g, match => match.replace(/[^\n]/g, " "));
    const packageName = /^\s*package\s+([\w$.]+)\s*;/m.exec(source)?.[1];
    const declaration = /\b(?:class|record|enum)\s+([\w$]+)/.exec(source);
    if (!declaration) continue;
    const cwd = [...roots].filter(root => root === "." || file.startsWith(root + "/")).sort((a, b) => b.length - a.length)[0] || ".";
    const name = declaration[1];
    const target = packageName ? `${packageName}.${name}` : name;
    const main = /\bstatic\s+(?:public\s+)?void\s+main\s*\(/.exec(source);
    const spring = /@(?:[\w$.]+\.)?SpringBootApplication\b/.exec(source);
    const test = /@(?:[\w$.]+\.)?(?:Test|ParameterizedTest|RepeatedTest|TestFactory)\b/.exec(source);
    const entry = (type: string, index: number) => candidates.push({ name, type, target, cwd, file, line: source.slice(0, index).split("\n").length - 1 });
    if (spring) entry("spring-boot", spring.index);
    if (main) entry("java-application", main.index);
    if (test) {
      entry("junit", declaration.index);
      const methods = /@(?:[\w$.]+\.)?(?:Test|ParameterizedTest|RepeatedTest|TestFactory)\b(?:\s*\([^)]*\))?\s+(?:(?:\w+|@\w+)\s+)*?([\w$]+)\s*\(/g;
      for (const match of source.matchAll(methods)) {
        candidates.push({ name: `${name}.${match[1]}`, type: "junit", target: `${target}#${match[1]}`, cwd, file,
          line: source.slice(0, match.index).split("\n").length - 1 });
      }
    }
  }
  return candidates;
}
