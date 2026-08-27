import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { parseRuleDocument } from "./rule-document.js";

describe("parseRuleDocument", () => {
	it("parses frontmatter and body", () => {
		const parsed = parseRuleDocument(`---
title: Use prompt caching
description: Cache repeated prompt prefixes.
status: stable
applies_to:
  include:
    - "src/**/*.ts"
---

Prompt caching cuts latency and cost.

## Details

More prose.
`);

		assert.ok(parsed.ok);
		assert.equal(parsed.frontmatter.title, "Use prompt caching");
		assert.equal(
			parsed.frontmatter.description,
			"Cache repeated prompt prefixes.",
		);
		assert.equal(parsed.frontmatter.status, "stable");
		assert.deepEqual(parsed.frontmatter.applies_to, {
			include: ["src/**/*.ts"],
		});
		assert.ok(parsed.body.startsWith("Prompt caching cuts latency and cost."));
		assert.ok(parsed.body.endsWith("More prose."));
	});

	it("defaults every absent field", () => {
		const parsed = parseRuleDocument("---\n---\nBody only.\n");

		assert.ok(parsed.ok);
		assert.equal(parsed.frontmatter.title, undefined);
		assert.equal(parsed.frontmatter.description, undefined);
		assert.equal(parsed.frontmatter.status, "stable");
		assert.equal(parsed.frontmatter.adr_status, undefined);
		assert.equal(parsed.body, "Body only.");
	});

	it("accepts and ignores unknown frontmatter fields", () => {
		const parsed = parseRuleDocument(`---
title: A rule
generated: true
verified: 2026-01-01
stale_after: 90d
sources:
  - https://example.com
---
Body.
`);

		assert.ok(parsed.ok);
		assert.equal(parsed.frontmatter.title, "A rule");
	});

	it("rejects a document without a frontmatter block", () => {
		const parsed = parseRuleDocument("# Just markdown\n\nNo frontmatter.\n");

		assert.ok(!parsed.ok);
		assert.match(parsed.problem, /no frontmatter block/);
	});

	it("rejects an unclosed frontmatter block", () => {
		const parsed = parseRuleDocument("---\ntitle: A rule\n");

		assert.ok(!parsed.ok);
		assert.match(parsed.problem, /not closed/);
	});

	it("rejects frontmatter that is not valid YAML", () => {
		const parsed = parseRuleDocument("---\ntitle: [unclosed\n---\nBody.\n");

		assert.ok(!parsed.ok);
		assert.match(parsed.problem, /not valid YAML/);
	});

	it("rejects a frontmatter value with a wrong type", () => {
		const parsed = parseRuleDocument(
			"---\ntitle:\n  - a\n  - list\n---\nBody.\n",
		);

		assert.ok(!parsed.ok);
		assert.match(parsed.problem, /Invalid frontmatter field 'title'/);
	});

	it("rejects an unknown status value", () => {
		const parsed = parseRuleDocument("---\nstatus: published\n---\nBody.\n");

		assert.ok(!parsed.ok);
		assert.match(parsed.problem, /Invalid frontmatter field 'status'/);
	});

	it("rejects an unknown adr_status value", () => {
		const parsed = parseRuleDocument("---\nadr_status: merged\n---\nBody.\n");

		assert.ok(!parsed.ok);
		assert.match(parsed.problem, /Invalid frontmatter field 'adr_status'/);
	});

	it("rejects a malformed applies_to filter", () => {
		for (const appliesTo of [
			"applies_to: src/**/*.ts",
			'applies_to:\n  include:\n    - "/absolute/*.ts"',
			"applies_to:\n  paths:\n    - src/**/*.ts",
		]) {
			const parsed = parseRuleDocument(`---\n${appliesTo}\n---\nBody.\n`);

			assert.ok(!parsed.ok, appliesTo);
			assert.match(parsed.problem, /applies_to/);
		}
	});
});
