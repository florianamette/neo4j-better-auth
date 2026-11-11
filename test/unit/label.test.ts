import { describe, expect, it } from "vitest";
import { edgeTypeForChildLabel, escapeIdentifier } from "../../src/label.js";

describe("escapeIdentifier", () => {
	it("wraps identifiers in backticks", () => {
		expect(escapeIdentifier("user")).toBe("`user`");
	});

	it("strips backticks so a name cannot break out of the identifier", () => {
		expect(escapeIdentifier("user`) DETACH DELETE (n")).toBe("`user) DETACH DELETE (n`");
	});
});

describe("edgeTypeForChildLabel", () => {
	it.each([
		["session", "HAS_SESSION"],
		["twoFactor", "HAS_TWOFACTOR"],
		["oauth-access token", "HAS_OAUTH_ACCESS_TOKEN"],
		["__weird__", "HAS_WEIRD"],
		["!!!", "HAS_RELATED"],
	])("%s -> %s", (label, expected) => {
		expect(edgeTypeForChildLabel(label)).toBe(expected);
	});
});
