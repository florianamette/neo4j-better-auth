import neo4j, { type Node, type Relationship } from "neo4j-driver";

type PlainRecord = Record<string, unknown>;

function integerToPlain(v: { toNumber(): number; toString(): string }): number | string {
	const n = v.toNumber();
	return Number.isSafeInteger(n) ? n : v.toString();
}

function bigintToPlain(v: bigint): number | string {
	const n = Number(v);
	return Number.isSafeInteger(n) ? n : v.toString();
}

function isTemporal(v: unknown): v is { toStandardDate(): Date } {
	return neo4j.isDateTime(v) || neo4j.isLocalDateTime(v) || neo4j.isDate(v);
}

/** Convert a value read from the driver into plain JavaScript values. */
function toPlainValue(v: unknown): unknown {
	if (neo4j.isInt(v)) return integerToPlain(v);
	if (typeof v === "bigint") return bigintToPlain(v);
	if (Array.isArray(v)) return v.map(toPlainValue);
	if (neo4j.isNode(v) || neo4j.isRelationship(v)) return propertiesToPlain(v);
	if (v instanceof Date) return v;
	if (isTemporal(v)) return v.toStandardDate();
	if (v !== null && typeof v === "object") return mapValues(v as PlainRecord, toPlainValue);
	return v;
}

function mapValues(
	record: PlainRecord,
	fn: (value: unknown) => unknown,
): PlainRecord {
	const out: PlainRecord = {};
	for (const [key, value] of Object.entries(record)) {
		out[key] = fn(value);
	}
	return out;
}

export function propertiesToPlain(entity: Node | Relationship): PlainRecord {
	return mapValues(entity.properties as PlainRecord, toPlainValue);
}

/** Narrow an arbitrary query result value to a driver Node. */
export function asNode(value: unknown): Node | null {
	return neo4j.isNode(value) ? value : null;
}

/** Counts come back as driver Integers (or bigint); normalise to a JS number. */
export function toCount(value: unknown): number {
	if (neo4j.isInt(value)) return value.toNumber();
	if (typeof value === "bigint") return Number(value);
	return Number(value ?? 0);
}

/**
 * Neo4j node properties must be primitives or arrays of primitives (no nested maps).
 * Dates are stored as ISO strings and objects are JSON-stringified; Better Auth is
 * configured with supportsJSON/supportsDates: false so it parses them back.
 */
export function toNeo4jPropertyValue(v: unknown): unknown {
	if (v === null) return null;
	if (neo4j.isInt(v)) return integerToPlain(v);
	if (typeof v === "bigint") return bigintToPlain(v);
	if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
	if (v instanceof Date) return v.toISOString();
	if (Array.isArray(v)) return v.map(toNeo4jPropertyValue);
	if (v instanceof Map) return JSON.stringify(Object.fromEntries(v));
	if (typeof v === "object") return JSON.stringify(v);
	return String(v);
}

/** Serialize a row for storage, dropping undefined values. */
export function toNeo4jProperties(data: PlainRecord): PlainRecord {
	const out: PlainRecord = {};
	for (const [key, value] of Object.entries(data)) {
		if (value === undefined) continue;
		out[key] = toNeo4jPropertyValue(value);
	}
	return out;
}
