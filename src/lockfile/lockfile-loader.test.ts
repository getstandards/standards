import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { LockfileLoadError, loadLockfile } from "./lockfile-loader.js";

describe("loadLockfile", () => {
	it("parses tag and branch source locks", () => {
		const lockfile = loadLockfile(`
---
version: 1
sources:
  - repository: https://github.com/acme/rules.git
    revision:
      tag: v2.1.0
    commit: 9d64a5838f8dbf26f0f1e51078a29c756970ca31
  - repository: https://github.com/acme/rules.git
    revision:
      branch: main
    commit: 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
`);

		assert.equal(lockfile.sources.length, 2);
	});

	it("requires the sources field", () => {
		assert.throws(
			() => loadLockfile("version: 1\n"),
			/\.standards\.lock:sources/,
		);
	});

	it("rejects commit revisions", () => {
		assert.throws(
			() =>
				loadLockfile(`
version: 1
sources:
  - repository: https://github.com/acme/rules.git
    revision:
      commit: 9d64a5838f8dbf26f0f1e51078a29c756970ca31
    commit: 9d64a5838f8dbf26f0f1e51078a29c756970ca31
`),
			LockfileLoadError,
		);
	});

	it("rejects duplicate source identities even when commits differ", () => {
		assert.throws(
			() =>
				loadLockfile(`
version: 1
sources:
  - repository: https://github.com/acme/rules.git
    revision:
      branch: main
    commit: 9d64a5838f8dbf26f0f1e51078a29c756970ca31
  - repository: https://github.com/acme/rules.git
    revision:
      branch: main
    commit: 0123456789abcdef0123456789abcdef0123456789
`),
			/\.standards\.lock:sources\[1\]/,
		);
	});

	it("rejects unrecognized source fields", () => {
		assert.throws(
			() =>
				loadLockfile(`
version: 1
sources:
  - repository: https://github.com/acme/rules.git
    revision:
      tag: v1
    commit: 9d64a5838f8dbf26f0f1e51078a29c756970ca31
    extra: true
`),
			LockfileLoadError,
		);
	});
});
