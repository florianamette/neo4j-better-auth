import { describe, expect, it } from "vitest";
import neo4j from "neo4j-driver";
import {
	asNode,
	propertiesToPlain,
	toCount,
	toNeo4jProperties,
	toNeo4jPropertyValue,
} from "../../src/neo4j-record.js";

const node = (properties: Record<string, unknown>) =>
	new neo4j.types.Node(neo4j.int(1), ["user"], properties, "element-1");

describe("toCount", () => {
	it.each([
		[neo4j.int(3), 3],
		[5n, 5],
		[7, 7],
		[undefined, 0],
		[null, 0],
	])("%s -> %s", (input, expected) => {
		expect(toCount(input)).toBe(expected);
	});
});

describe("asNode", () => {
	it("narrows driver nodes and rejects anything else", () => {
		const n = node({});
		expect(asNode(n)).toBe(n);
		expect(asNode({ properties: {} })).toBeNull();
		expect(asNode(undefined)).toBeNull();
	});
});

describe("propertiesToPlain", () => {
	it("converts driver values into plain JavaScript", () => {
		const big = neo4j.int("9007199254740993");
		const when = new Date("2026-01-02T03:04:05.000Z");
		const plain = propertiesToPlain(
			node({
				small: neo4j.int(42),
				big,
				bigint: 12n,
				list: [neo4j.int(1), neo4j.int(2)],
				date: neo4j.types.DateTime.fromStandardDate(when),
				text: "hello",
				flag: true,
			}),
		);
		expect(plain).toEqual({
			small: 42,
			big: "9007199254740993",
			bigint: 12,
			list: [1, 2],
			date: when,
			text: "hello",
			flag: true,
		});
	});
});

describe("toNeo4jPropertyValue", () => {
	it("keeps primitives and null", () => {
		expect(toNeo4jPropertyValue("a")).toBe("a");
		expect(toNeo4jPropertyValue(1.5)).toBe(1.5);
		expect(toNeo4jPropertyValue(false)).toBe(false);
		expect(toNeo4jPropertyValue(null)).toBeNull();
	});

	it("stores dates as ISO strings", () => {
		expect(toNeo4jPropertyValue(new Date("2026-01-02T03:04:05.000Z"))).toBe(
			"2026-01-02T03:04:05.000Z",
		);
	});

	it("JSON-encodes objects and maps, which Neo4j cannot store as properties", () => {
		expect(toNeo4jPropertyValue({ a: 1 })).toBe('{"a":1}');
		expect(toNeo4jPropertyValue(new Map([["a", 1]]))).toBe('{"a":1}');
	});

	it("converts arrays element by element", () => {
		expect(toNeo4jPropertyValue([new Date(0), 2n])).toEqual(["1970-01-01T00:00:00.000Z", 2]);
	});
});

describe("toNeo4jProperties", () => {
	it("drops undefined values", () => {
		expect(toNeo4jProperties({ a: 1, b: undefined, c: null })).toEqual({ a: 1, c: null });
	});
});
