# Language plugins

The marketplace contains three independent language packages. Their manifests declare `distribution: "marketplace"`: source checkout discovery skips them, and they become user plugins only after installation. They are not preinstalled, auto-enabled, or covered by system install-time grants.

Available packages:

| Package | Highlighting | Navigation |
| --- | --- | --- |
| Java | Java grammar | Eclipse JDTLS |
| JavaScript & TypeScript | JS, JSX, TS, TSX grammars | typescript-language-server |
| SAP syntax | CDS/CDL, HANA CDS, DDLS, MTA/MTAEXT, CAP configuration, HANA artifacts | Highlighting only |

Java and JS/TS depend on the shared **Language services** package. SAP depends only on Hato essentials and does not request process execution permissions.

These packages require the native editor bridge introduced with this change. Rebuild/restart Hato once to install that bridge. Language registrations, SAP lexical rules, server commands and settings then hot reload with their TypeScript plugins. Changing highlighting does not replace the native editor or its unsaved buffer.

## Check and install dependencies from Settings

Open Settings → Languages → `jdtls` or `typescript-language-server` after selecting a workspace.
**Check dependencies** reports the server and runtimes on that workspace's machine.
**Install missing dependencies** installs missing tools for your user, checks them, saves the verified
launcher as the workspace's executable preference, and restarts only that workspace/server session.
The buttons show progress and are disabled while their operation runs; failures remain visible.

- Java installs the pinned, SHA-256-verified Eclipse JDTLS archive. It reuses a suitable installed
  JDK, or downloads a checksummed Eclipse Temurin JDK 25 when none is available. Its launcher
  selects the correct JDK even when the GUI/login shell has an older `JAVA_HOME`.
- JS/TS installs `typescript-language-server` and TypeScript into a private npm prefix. It reuses
  suitable Node.js/npm, or downloads a checksummed Node.js 24 distribution when needed.
- Files go under `~/.local/share/hato/language-tools` on the target machine. No sudo, system package
  changes, global npm installs, or shell profile edits are needed. SSH uses the same existing
  connection and target-scoped process API as navigation.

Python 3.8+ must already be installed on the target. Automatic installation supports macOS and
glibc Linux on x64/arm64; configure tools manually on other platforms. Downloads occur only after
pressing Install, not when enabling the marketplace package. Interrupted installs can be retried.
The test-only `HATO_LANGUAGE_TOOLS_HOME` environment override isolates installer fixtures.

Java/JS/TS package 0.1.1 requires Language services 0.1.2, whose dependency on Hato essentials 0.1.4
ensures Settings understands action buttons. Update the packages together through the marketplace.
The terminal panel in Hato essentials 0.1.4 also fixes selecting/closing Markdown shell-block tabs
whose identifiers contain colons.

## Install and configure servers manually

In a development checkout, the marketplace keeps locally known packages visible when GitHub's published catalogue is older. Install uses the prepared local `catalogue.json` artifacts for unpublished/newer versions, verifies their hashes, and passes them through the normal native installer. Prepare those artifacts with `npm run release:prepare`; publication is not required for local testing.

Install the package in Settings → Plugins. Highlighting works without a server. For navigation, install the server **on the machine that holds the workspace**:

- Java: install [Eclipse JDTLS](https://github.com/eclipse-jdtls/eclipse.jdt.ls) and a JDK supported by that JDTLS version (currently JDK 25 or newer). Put its `jdtls` launcher on PATH or supply its absolute path. If needed, use a launcher wrapper that selects the correct `JAVA_HOME`. Each workspace uses its own `.hato/jdtls` data directory; exclude that generated directory from version control. Open the Maven/Gradle project root.
- JS/TS: install Node.js, then `npm install -g typescript-language-server typescript@6`. See the [server documentation](https://github.com/typescript-language-server/typescript-language-server). The semantic server is used for definitions so navigation resolves imports even during initial project loading.

Settings → Languages exposes a server executable field for each enabled server. Press Enter to save. With a workspace selected this persists a workspace-specific override, including for an SSH project. Without a workspace it sets the user default. Values are executable paths/command names, not shell commands. Changing the setting restarts the affected language sessions.

Ctrl-click on Linux/Windows or Cmd-click on macOS opens the definition at its UTF-16 position. Opening a supported source file starts the server and synchronizes the document; indexing may continue in the background. All unsaved editor buffers belonging to that server are synchronized before the request, including when autosave is disabled.

## Server status and Java project settings

These controls ship in Hato essentials 0.1.7, Language services 0.1.5 and Java 0.1.3. Update the packages together.

Open a Java/JS/TS source file. The editor's bottom bar shows the server id and its current phase
(idle, starting, indexing, ready, disabled or error). Click it to view startup errors, server messages,
advertised features and diagnostic count, or restart the server. A connected status is not proof that
project import has finished. **Symbols…** lists classes, methods and fields in the active file and
reveals the selected symbol; refresh it after import if the list is initially empty.

The Java panel includes **Treat this workspace as a Java project** (enabled by default). It can
be disabled per workspace. **Source folders** and **Output folder** accept workspace-relative paths
or selections from **Browse folders…**. The browser uses the Files service for the selected machine,
including SSH. Source folders and referenced JAR paths/globs accept one entry per line. Empty
source/output overrides preserve JDTLS defaults. Source/output/library overrides are for unmanaged
plain Java projects; Maven/Gradle projects should keep using their build files. Import toggles can
disable Maven or Gradle import. **Apply and restart** persists workspace settings and restarts that
workspace's server so the new import configuration takes effect.

Additional server settings accept a JSON object, for example a remote project's JDK 21:

```json
{"java":{"configuration":{"runtimes":[{"name":"JavaSE-21","path":"/remote/path/to/jdk21","default":true}]}}}
```

That is the project's runtime, not the tooling JVM that runs JDTLS. Paths are on the workspace
machine. The settings are stored through persistence, not written into source files or build files.
JDTLS receives the merged configuration in initialization options and subsequent configuration RPCs.

The status button, project settings and symbol picker hot reload through modules. Native hover and
completion callbacks require the updated desktop build once; updating marketplace bundles alone
cannot add those callbacks to an older running host. No new SSH daemon primitive is required.

## SSH

The language service coordinates from the desktop and uses Hato's scoped process API with the workspace's SSH target. Server stdin/stdout travel over the existing SSH connection; source URIs remain remote paths. Nothing falls back to launching a local server for a remote workspace. Highlighting stays in the local native editor.

Servers must be installed on the remote machine. Remote launches use its login shell environment. The server stops when the workspace changes, the plugin reloads/disables, or the app exits; a dead/disconnected session restarts on the next request. This initial implementation does not persist language servers in the daemon while the desktop is disconnected.

## SAP coverage

- `.cds`, `.hdbcds`, `.ddls`, `.asddls`: module-defined lexical highlighting for comments, strings, annotations, keywords, primitive types, booleans and numbers. This is a lexical highlighter, not a full CDS parser or semantic analyzer.
- `mta.yaml`, `mta.yml`, `mtad.yaml`, `mtad.yml`, `.mta`, `.mtaext`: YAML grammar.
- `.cdsrc.json`, `.cdsrc-private.json`, `.hdiconfig`, `.hdinamespace`, `xs-app.json`, `xs-security.json`, `.hdbtabledata`, `.hdbsynonym`, `.hdbsynonymconfig`, `.hdbgrants`, `.hdbrole`, `.hdbroleconfig`: JSON grammar.
- `.hdbtable`, `.hdbview`, `.hdbprocedure`, `.hdbfunction`, `.hdbindex`, `.hdbconstraint`, `.hdbsequence`, `.hdbtrigger`, `.hdbmigrationtable`: SQL grammar.

## Current scope

Go to definition opens files within the current workspace. External files and JDTLS virtual/class-file URIs show an explanatory message; dependency-source viewers are not implemented yet. Hover documentation, automatic completion and the file-symbol picker are supported. Diagnostics are counted in the server panel; editor squiggles, rename and refactoring are not implemented. Only UTF-16 LSP positions are negotiated. Marketplace installation does not download language runtimes automatically; use the explicit dependency Install button or supply your own servers.

## Development and checks

`contributes.languages` owns file matching, grammar selection, lexical rules and server specifications. The shared SDK validates/matches contributions and frames LSP JSON-RPC by UTF-8 byte length. The native bridge connects the editor's definition, hover and completion providers and document activation hook to the owning UI module, applies grammar/lexical data, and reveals a requested cursor position. No Java, TypeScript or SAP policy lives in Rust.

Run `npm test`, build affected modules, and prepare immutable marketplace artifacts with `npm run release:prepare`. To smoke test a real server against a temporary project:

```sh
node tools/smoke-languages.mjs typescript /absolute/path/to/typescript-language-server
JAVA_HOME=/path/to/jdk node tools/smoke-languages.mjs java /absolute/path/to/jdtls
```

The smoke test exercises the real language-service module, stdio framing, cross-file definitions, and unsaved-buffer updates. Routing tests cover local and SSH targets. The host integration driver `tests/integration/languages.js` also exercises real scoped process/stream primitives, viewer navigation and optional loopback SSH; native pointer interaction still requires a desktop check.

## Repairing a stale permission manifest

If an older installation reports that `language-service` is not allowed to call `persistence`
even though its installed manifest and approvals contain `call:persistence`, the host may have
reused an older cached manifest based only on unchanged JavaScript. Language services 0.1.1 has
a fresh bundle and a health endpoint; install/update that package through the normal installer.
In this checkout, Settings → Plugins → Installed → Install from folder can use
`packages/language-service/0.1.1/language-service`. This package update works without restarting.
The host artifact-cache fix additionally makes future manifest-only updates take effect while
preserving custom builds and rollback artifacts; the rebuilt host takes effect on the next restart.

## Java server JVM versus project JDK

The pinned JDTLS 1.63.0 archive contains a core bundle requiring Java 25, despite the launcher's
older minimum check. Java plugin 0.1.2 requires Language services 0.1.3: dependency checks inspect
the installed core bundle and installation provisions the matching JVM in a versioned user directory
(such as `java-25`). The managed launcher sets `JAVA_HOME` only for JDTLS; the project's JDK 21
and machine-wide environment are left intact. Project Maven/Gradle toolchains may still specify 21.

A source manifest edit does not update an installed marketplace plugin. Prepare/export the new
packages, install/update both Java and Language services, select the SSH workspace, then run Check
and Install missing dependencies there. The remote workspace's persisted executable must point at
the generated remote `~/.local/share/hato/language-tools/bin/jdtls` launcher. A plain `jdtls` command
or a wrapper hardcoded to the old JDK can still launch Java 21 after editing a version requirement.
