# Cloudflare Workers Builds CI

This dedicated CI Worker runs the repository's portable verification pipeline. It does not serve product traffic or promote an active Worker version.

`run.sh` installs repository-pinned Bun and frozen dependencies. It runs version validation, TypeScript checks, root Bun tests, launcher TypeScript checks and Node tests, launcher renderer build, runtime bundle generation, license generation, and release-runtime smoke checks. It does not run dependency audits: the first remote build stopped at `bun audit` because the pinned dependency tree reports 10 advisories. That is a dependency-maintenance issue, not a Workers Builds runtime limitation. Existing Bun and Node runners print named pass/fail totals in the build log.

This pipeline does not package macOS, Windows or Linux desktop artifacts. It does not run platform-specific Windows PowerShell checks, Linux AppImage ABI checks, GUI app smoke checks, macOS signing checks, release archive creation, release publication, or dependency audits. GitHub Actions remains enabled for those checks. No service-backed tests are silently skipped.

The Worker is a version-upload target only. It has no routes, `workers.dev` URL, preview URL, product bindings or traffic. The build's deploy command uploads a new version without activating it.
