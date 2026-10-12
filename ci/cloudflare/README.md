# Cloudflare Workers Builds CI

This dedicated CI Worker runs the repository's portable verification pipeline. It does not serve product traffic or promote an active Worker version.

`run.sh` installs the repository's pinned Bun version and frozen dependencies, then runs the existing `bun run verify` script. That script covers version validation, dependency audits, TypeScript checks, the root Bun tests, launcher audit/typecheck/tests/build, runtime bundle generation, license generation and release-runtime smoke checks. Test summaries are emitted by the existing Bun and Node test runners; CI must retain their named pass/fail totals in the build log.

This pipeline does not package macOS, Windows or Linux desktop artifacts. It does not run the platform-specific Windows PowerShell checks, Linux AppImage ABI checks, GUI app smoke checks, macOS signing checks, release archive creation, or release publication. GitHub Actions remains enabled for those platform-specific checks. No service-backed tests are silently skipped: the existing `verify` script's named checks are the only claimed coverage.

The Worker is a version-upload target only. It has no routes, `workers.dev` URL, preview URL, product bindings or traffic. The build's deploy command uploads a new version without activating it.
