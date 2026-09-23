The container image now installs dependencies with `bun install --frozen-lockfile`; the previous `bun ci` step does not exist in the pinned Bun 1.2.15 and failed the build.
