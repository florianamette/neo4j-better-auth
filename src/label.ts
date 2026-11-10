/** Backtick-wrap a Neo4j label or property key so arbitrary model / field names cannot alter the query. */
export function escapeIdentifier(id: string): string {
	return "`" + id.replace(/`/g, "") + "`";
}

/** Relationship types must match [A-Z][A-Z0-9_]*; derive one from the child label. */
export function edgeTypeForChildLabel(childLabel: string): string {
	const core = childLabel
		.replace(/[^a-zA-Z0-9]/g, "_")
		.toUpperCase()
		.replace(/_+/g, "_")
		.replace(/^_|_$/g, "");
	return `HAS_${core || "RELATED"}`;
}
