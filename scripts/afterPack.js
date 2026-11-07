'use strict'

const fs = require('fs')
const path = require('path')

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'linux') {
    return
  }

  const targets = context.targets || []
  if (!targets.every(target => target.name === 'appImage')) {
    console.warn('[afterPack] Skipping AppImage sandbox wrapper: non-AppImage Linux targets are configured')
    return
  }

  const executableName = context.packager.executableName
  const executablePath = path.join(context.appOutDir, executableName)
  const realExecutablePath = `${executablePath}.bin`

  // afterPack can run more than once against the same app directory, so keep
  // the existing .bin rather than renaming the wrapper over itself.
  if (fs.existsSync(realExecutablePath)) {
    return
  }

  await fs.promises.rename(executablePath, realExecutablePath)

  const wrapper = `#!/bin/bash
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
real_bin="$script_dir/${executableName}.bin"

args=()
for arg in "$@"; do
  if [ "$arg" = "--sandbox-auto" ]; then
    continue
  fi
  args+=("$arg")
done

for arg in "\${args[@]}"; do
  if [ "$arg" = "--no-sandbox" ]; then
    exec "$real_bin" "\${args[@]}"
  fi
done

if command -v unshare >/dev/null 2>&1 && unshare -Ur true >/dev/null 2>&1; then
  exec "$real_bin" "\${args[@]}"
fi

echo "pdf-annotator: unprivileged user namespaces are unavailable; starting with --no-sandbox" >&2
exec "$real_bin" --no-sandbox "\${args[@]}"
`

  await fs.promises.writeFile(executablePath, wrapper, { mode: 0o755 })
  await fs.promises.chmod(executablePath, 0o755)
}
