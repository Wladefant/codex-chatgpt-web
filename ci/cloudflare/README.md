# Cloudflare Workers Builds CI

This dedicated CI Worker runs the repository's portable verification pipeline. It does not serve product traffic or promote an active Worker version.

`run.sh` installs repository-pinned Bun and frozen dependencies. It runs the Worker isolation tests, version check, TypeScript checks, root Bun tests, launcher audit/typecheck/tests/build, runtime bundle generation, license generation, release-runtime smoke checks, and the root dependency audit. The audit runs last so the build log records named test counts before the gate result. The first remote run stopped at the existing audit and reported 10 advisories, including one critical advisory. The complete parity gate remains blocked until that audit passes; the Worker does not suppress or replace it.

This pipeline does not package desktop artifacts. It does not run platform-specific Windows PowerShell checks, Linux AppImage ABI checks, GUI app smoke checks, macOS signing checks, release archive creation or release publication. GitHub Actions now runs Linux jobs only. Windows and macOS native packages are no longer built or published because no Linux cross-build has been proven. No service-backed tests are silently skipped.

The Worker is a version-upload target only. It has no routes, `workers.dev` URL, preview URL, product bindings or traffic. The build's deploy command uploads a new version without activating it.
