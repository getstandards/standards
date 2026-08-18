import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveAuthFilePath } from "./auth-file-location.js";

describe("resolveAuthFilePath", () => {
	it("uses XDG_CONFIG_HOME on Unix systems", () => {
		expect(
			resolveAuthFilePath({
				environment: { XDG_CONFIG_HOME: "/var/config" },
				platform: "linux",
				homeDirectory: "/home/user",
			}),
		).toBe("/var/config/standards/auth.json");
	});

	it("uses the home config directory when XDG_CONFIG_HOME is unset", () => {
		expect(
			resolveAuthFilePath({
				environment: {},
				platform: "darwin",
				homeDirectory: "/Users/user",
			}),
		).toBe("/Users/user/.config/standards/auth.json");
	});

	it("uses APPDATA on Windows", () => {
		expect(
			resolveAuthFilePath({
				environment: { APPDATA: "C:\\Users\\user\\AppData\\Roaming" },
				platform: "win32",
				homeDirectory: "C:\\Users\\user",
			}),
		).toBe(
			path.win32.join(
				"C:\\Users\\user\\AppData\\Roaming",
				"standards",
				"auth.json",
			),
		);
	});
});
