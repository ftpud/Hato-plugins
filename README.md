# Hato plugins

This repository owns Hato's TypeScript application: services, UI panels, manifests, catalogue,
build tools, and versioned marketplace artifacts. The native host and shared SDK live in
[Hato](https://github.com/ftpud/Hato). There is no second plugin source tree in the host repository.

## Develop with live reload

The normal development checkout is `Hato/Hato-plugins/`. From the Hato directory:

```sh
npm ci
npm run plugins:setup
npm run dev
```

Edit `Hato-plugins/modules/services/` or `Hato-plugins/modules/ui/`. The watcher rebuilds changed
bundles and the host activates them live. SDK edits also rebuild consumers. The native kernel
keeps workspace resources and supplies each new generation with the old generation's snapshot.
`canSwap` vetoes and failed health checks keep the old generation active.

`npm run dev` opts into trusted local reload with `--dev-watch`; marketplace overrides for
checkout IDs stay on disk but do not shadow the editable code in this mode. Normal launches
use installed overrides. Existing in-app module build, stage, activate, and rollback tools
still work against this checkout, without restarting the app for TypeScript edits.

From this repository you can also run `npm ci`, `npm test`, `npm run build`, or `npm run watch`.
The builder finds the SDK at `../sdk` (nested checkout) or `../Hato/sdk` (sibling checkout).
Set `HATO_SDK_ROOT` to another SDK location for builds. For typechecking a custom layout, adjust
the `@hato/sdk/*` paths and ambient declaration includes in `tsconfig.json`.

## Publish updates

```sh
npm run release:prepare
```

This builds plugins, bumps patch versions for changed packages, updates member manifests,
rebuilds catalogue consumers, and exports new artifact directories with SHA-256 digests.
It preserves older version directories. It does not commit or push. Review and publish this
repository, then run `npm run plugins:lock` in Hato to pin that published revision for new installs.
Commit the new host lock with the corresponding native release. Plugin-only releases do not
require an app release: existing users can check for updates and update installed packages live.

`plugins.catalogue.json` owns package membership, types, dependencies, and compatibility.
`catalogue.json` is generated for download clients; `packages/` contains generated, self-contained
JavaScript and manifests. Application settings and policy belong in the TypeScript sources.

## Install and update

The host app ships `plugins.lock.json`, not plugin sources or bundles. First launch downloads
and verifies its pinned set into `<data>/runtime/plugins`. Subsequent launches work offline;
verified cached downloads also repair missing or damaged baseline files. Installed plugins,
settings, and rollback artifacts persist across host application upgrades.

Settings → Plugins separates Marketplace, Installed, and System. The list is searchable and
grouped by type. Marketplace excludes packages with installed members. Refresh discovers updates;
Update all prepares the dependency closure from one pinned repository revision, verifies artifacts,
and submits one native install request. Permission approval stays in the host. New plugins stay
disabled until enabled; updates preserve enabled state. Failures during synchronous activation
restore the prior installed copies and generations. A manager updating itself activates after
its requesting event completes; if its health check fails, its previous copy stays active.

Fresh installations download the system set only: Hato essentials, Git and AI Chat. Optional
features are installed from Marketplace as complete plugins:

| Plugin | Included modules |
| --- | --- |
| Claude | Provider definitions, adapter/authentication policy and usage parser; usage bar |
| Codex | Provider definitions, adapter/authentication policy and usage parser; usage bar |
| Background Agents | Agent runner, workspace tools, persistent agent gateway and agent panel |
| Workflows | Workflow service, execution runtime and visual editor; depends on Background Agents |
| Remote workspaces | Remote runtime manager and remote panel |

Installed and System show one row per plugin. Expand it to inspect individual modules; normal
install, enable, disable and uninstall controls operate on the whole plugin. A fresh install
activates its modules together after native approval. Updates keep a disabled plugin disabled,
and add new modules to a plugin that was already enabled. Cross-plugin dependents must be disabled
before their dependency can be removed. Existing saved provider profiles and settings are retained,
but a named provider is offered only while its provider plugin is installed and enabled.

The shared ACP client discovers `contributes.agentProviders`; it does not seed built-in provider
profiles. Provider modules supply profile defaults, adapter metadata, auth options, usage commands,
and parsing. The marketplace installs the Hato integration and usage UI; installing/authenticating
the external CLI adapter remains an explicit operation on the chosen workspace machine.
