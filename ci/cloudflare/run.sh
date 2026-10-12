#!/usr/bin/env bash
set -euo pipefail

readonly bun_version=1.4.0
readonly bun_install="$HOME/.bun/bin/bun"

if ! command -v curl >/dev/null 2>&1; then
  echo "Required command not found: curl" >&2
  exit 1
fi

if [[ ! -x "$bun_install" ]] || [[ "$("$bun_install" --version)" != "$bun_version" ]]; then
  curl -fsSL https://bun.sh/install | bash -s "bun-v${bun_version}"
fi
export PATH="$HOME/.bun/bin:$PATH"

if [[ "$(bun --version)" != "$bun_version" ]]; then
  echo "Expected Bun ${bun_version}; got $(bun --version)" >&2
  exit 1
fi

bun install --frozen-lockfile
(
  cd launcher
  bun install --frozen-lockfile
)

node --test ci/cloudflare/worker.test.mjs
bun run check-version
bun run typecheck
bun run test
bun run launcher:typecheck
bun run launcher:test
bun run launcher:build

scratch="$(mktemp -d)"
readonly scratch
trap 'rm -rf "$scratch"' EXIT
readonly runtime_bundle="$scratch/runtime"

bun run scripts/build-runtime-bundle.ts "$runtime_bundle"
bun run scripts/generate-third-party-notices.ts "$scratch/THIRD_PARTY_NOTICES.txt" --include-launcher
bun run scripts/smoke-release.ts "$runtime_bundle"
