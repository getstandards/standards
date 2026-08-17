import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveCacheDirectory } from "./cache-directory.js";

describe("resolveCacheDirectory", () => {
	it("prefers the option over the environment and the platform default", () => {
		const resolved = resolveCacheDirectory({
			cacheDir: "/option/cache",
			environment: { STANDARDS_CACHE_DIR: "/env/cache" },
			platform: "linux",
			homeDirectory: "/home/user",
		});

		expect(resolved).toEqual({
			directory: path.resolve("/option/cache"),
			disabled: false,
		});
	});

	it("uses STANDARDS_CACHE_DIR when no option is present", () => {
		const resolved = resolveCacheDirectory({
			environment: { STANDARDS_CACHE_DIR: "/env/cache" },
			platform: "linux",
			homeDirectory: "/home/user",
		});

		expect(resolved.directory).toBe(path.resolve("/env/cache"));
	});

	it("falls back to the XDG cache directory on Linux", () => {
		const resolved = resolveCacheDirectory({
			environment: { XDG_CACHE_HOME: "/home/user/.cache" },
			platform: "linux",
			homeDirectory: "/home/user",
		});

		expect(resolved.directory).toBe("/home/user/.cache/standards");
	});

	it("uses $HOME/.cache/standards when XDG_CACHE_HOME is unset", () => {
		const resolved = resolveCacheDirectory({
			environment: {},
			platform: "linux",
			homeDirectory: "/home/user",
		});

		expect(resolved.directory).toBe("/home/user/.cache/standards");
	});

	it("uses the XDG cache directory on macOS", () => {
		expect(
			resolveCacheDirectory({
				environment: {},
				platform: "darwin",
				homeDirectory: "/Users/user",
			}).directory,
		).toBe("/Users/user/.cache/standards");
		expect(
			resolveCacheDirectory({
				environment: { XDG_CACHE_HOME: "/Users/user/.cache" },
				platform: "darwin",
				homeDirectory: "/Users/user",
			}).directory,
		).toBe("/Users/user/.cache/standards");
	});

	it("uses the Windows local application data directory", () => {
		const resolved = resolveCacheDirectory({
			environment: { LOCALAPPDATA: "C:\\Users\\user\\AppData\\Local" },
			platform: "win32",
			homeDirectory: "C:\\Users\\user",
		});

		expect(resolved.directory).toBe(
			path.resolve("C:\\Users\\user\\AppData\\Local", "standards", "cache"),
		);
	});

	it("disables the cache with the option or the environment variable", () => {
		expect(
			resolveCacheDirectory({
				noCache: true,
				environment: {},
				platform: "linux",
				homeDirectory: "/home/user",
			}).disabled,
		).toBe(true);
		expect(
			resolveCacheDirectory({
				environment: { STANDARDS_NO_CACHE: "1" },
				platform: "linux",
				homeDirectory: "/home/user",
			}).disabled,
		).toBe(true);
		expect(
			resolveCacheDirectory({
				environment: { STANDARDS_NO_CACHE: "" },
				platform: "linux",
				homeDirectory: "/home/user",
			}).disabled,
		).toBe(false);
	});
});
