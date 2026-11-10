# Plugin development

This repository owns all application TypeScript under `modules/services/` and `modules/ui/`.
Use `@hato/sdk/*` imports for the host SDK; do not copy SDK or native code into this repository.
Keep behavior, defaults, UI composition, and policy here. Native ownership, capability checks,
and trusted approval remain in Hato's kernel.

Run `npm test` and build affected modules (`npm run build -- settings`). In the usual nested
checkout, Hato's `npm run dev` watches this repository and the SDK and activates changed bundles
without restarting the application. Preserve snapshot state and kernel-owned workspace resources.
A plain build writes seed bundles; activation requires a host running with `--dev-watch` or the
existing in-app module tools. Report which occurred.

Prepare marketplace artifacts with `npm run release:prepare`. Keep prior package versions and
bump changed package/member versions. Review generated manifests, hashes, dependency ranges, and
host compatibility. Preparation does not publish; do not silently commit or push a release.

For native primitives, lifecycle, permissions, and service/UI wiring consult Hato's
`.agents/skills/hato-plugins/SKILL.md` and only its relevant reference branches.
