#!/usr/bin/env bash
set -euo pipefail
image="${1:?Usage: native-runtime.sh IMAGE musl|glibc}"
libc="${2:?Expected libc is required}"
case "$libc" in musl|glibc) ;; *) echo "Expected musl or glibc" >&2; exit 1 ;; esac
docker run --rm --network none -e EXPECTED_LIBC="$libc" --entrypoint node "$image" -e '
  const assert = require("node:assert/strict");
  assert.equal(process.versions.node.split(".")[0], "24");
  const glibc = process.report.getReport().header.glibcVersionRuntime;
  assert.equal(glibc ? "glibc" : "musl", process.env.EXPECTED_LIBC);
  const fs = require("node:fs");
  const path = require("node:path");
  const native = require("thesidedoor-flock");
  const directory = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "sotto-native-smoke-"));
  const file = path.join(directory, "state.lock");
  const descriptors = new Set();
  try {
    const first = fs.openSync(file, "a", 0o600);
    const second = fs.openSync(file, "a", 0o600);
    descriptors.add(first);
    descriptors.add(second);
    const flags = native.constants.LOCK_EX | native.constants.LOCK_NB;
    native.flock(first, flags);
    assert.throws(() => native.flock(second, flags), error =>
      ["EAGAIN", "EWOULDBLOCK"].includes(error.code));
    fs.closeSync(first);
    descriptors.delete(first);
    native.flock(second, flags);
    console.log("Standalone native file locking acquires, rejects contention and releases.");
  } finally {
    for (const descriptor of descriptors) fs.closeSync(descriptor);
    fs.rmSync(directory, { recursive: true });
  }
'
