# GitHub Copilot ACP provider

`copilot-acp` is an optional marketplace plugin containing `copilot-provider`. It contributes
GitHub Copilot to AI Chat and Background Agents through the existing provider registry. The
provider module requests no native capabilities or RPC permissions and is never auto-enabled
as a built-in. It requires AI Chat 0.1.7 or newer.

The launch profile is `copilot --acp --stdio`. This is the official CLI's native, newline-delimited
ACP transport; no separate adapter, TCP listener, hardcoded model or approval-bypass arguments
are added. Models and session settings come from the agent's ACP responses. Standard ACP usage
updates use the existing context meter; this package does not invent subscription quota data
or add a provider-specific quota bar.

## Install and authenticate

Install **GitHub Copilot** from Settings → Plugins → Marketplace after refreshing the catalogue.
For local/offline installation, the prepared member folder can also be installed through
Installed → Install from folder: `packages/copilot-acp/0.1.0/copilot-provider`. Update the AI Chat dependency first.
Enable the plugin, then select GitHub Copilot in AI Chat or the Background Agents form.

Copilot CLI must be installed and authenticated on the workspace machine. An existing standalone
or Homebrew installation works; `copilot` must be discoverable in that machine's login PATH,
or a saved profile can specify its absolute executable path. Manage agents can explicitly
install/update the official npm package, `@github/copilot`. npm installation requires Node.js
22 or later; it is not performed automatically by installing this Hato plugin.

```sh
npm install -g @github/copilot
copilot login
```

For an SSH workspace, run these commands on that remote machine; `copilot login --device-code`
is available for headless authentication. Reconnect after authentication. The local GitHub CLI
`gh copilot` extension is not the executable used by this provider. Hato does not copy tokens
into the plugin, source tree, or repository. Existing Copilot environment/provider settings are
left to the CLI.

CLI installation, authentication, and organization policies follow the official documentation:
[install Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/install-copilot-cli),
[ACP server](https://docs.github.com/en/copilot/reference/copilot-cli-reference/acp-server),
[login command](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference#copilot-login-options).

## Verification

```sh
npm test
npm run release:prepare
node tools/smoke-copilot.mjs
```

The optional smoke check uses an already installed CLI. It starts the manifest's command in a
temporary directory, negotiates ACP v1 using Hato's actual JSON-RPC client, and closes the process.
It does not install anything, log in, create an agent session or send a model prompt. It was
verified with GitHub Copilot CLI 1.0.109. Authenticated prompts, tool execution and remote CLI
launch still need testing in the user's chosen workspace after installation.
