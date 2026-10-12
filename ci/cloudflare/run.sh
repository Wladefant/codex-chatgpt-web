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
bun install --cwd launcher --frozen-lockfile
node --test ci/cloudflare/worker.test.mjs
bun run verify
