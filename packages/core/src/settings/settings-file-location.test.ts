import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveStandardsSettingsPath } from "./settings-file-location.js";

describe("resolveStandardsSettingsPath", () => {
	it("uses XDG_CONFIG_HOME on Unix systems", () => {
		expect(
			resolveStandardsSettingsPath({
				environment: { XDG_CONFIG_HOME: "/var/config" },
				platform: "linux",
				homeDirectory: "/home/user",
			}),
		).toBe("/var/config/standards/settings.yml");
	});

	it("uses the home config directory when XDG_CONFIG_HOME is unset", () => {
		expect(
			resolveStandardsSettingsPath({
				environment: {},
				platform: "darwin",
				homeDirectory: "/Users/user",
			}),
		).toBe("/Users/user/.config/standards/settings.yml");
	});

	it("uses HOME from the supplied environment", () => {
		expect(
			resolveStandardsSettingsPath({
				environment: { HOME: "/srv/user" },
				platform: "linux",
			}),
		).toBe("/srv/user/.config/standards/settings.yml");
	});

	it("uses APPDATA on Windows", () => {
		expect(
			resolveStandardsSettingsPath({
				environment: { APPDATA: "C:\\Users\\user\\AppData\\Roaming" },
				platform: "win32",
				homeDirectory: "C:\\Users\\user",
			}),
		).toBe(
			path.win32.join(
				"C:\\Users\\user\\AppData\\Roaming",
				"standards",
				"settings.yml",
			),
		);
	});

	it("uses the Windows home directory when APPDATA is unset", () => {
		expect(
			resolveStandardsSettingsPath({
				environment: {},
				platform: "win32",
				homeDirectory: "C:\\Users\\user",
			}),
		).toBe(
			path.win32.join(
				"C:\\Users\\user",
				"AppData",
				"Roaming",
				"standards",
				"settings.yml",
			),
		);
	});
});
