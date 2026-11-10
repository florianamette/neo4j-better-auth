import { edgeTypeForChildLabel, escapeIdentifier } from "./label.js";
import {
	foreignKeys,
	idProperty,
	type ForeignKey,
	type SchemaContext,
} from "./schema-context.js";

export type RunStatement = (
	cypher: string,
	params?: Record<string, unknown>,
) => Promise<unknown>;

export interface ChildNode {
	/** Schema key of the child model. */
	schemaKey: string;
	/** Neo4j label of the child model. */
	label: string;
	id: string;
}

interface EdgeNames {
	parentLabel: string;
	parentIdProp: string;
	childLabel: string;
	childIdProp: string;
	relType: string;
}

function edgeNames(ctx: SchemaContext, child: ChildNode, fk: ForeignKey): EdgeNames {
	return {
		parentLabel: escapeIdentifier(fk.parentLabel),
		parentIdProp: escapeIdentifier(fk.parentIdProp),
		childLabel: escapeIdentifier(child.label),
		childIdProp: escapeIdentifier(idProperty(ctx, child.schemaKey)),
		relType: edgeTypeForChildLabel(child.label),
	};
}

function mergeEdgeStatement(e: EdgeNames): string {
	return [
		`MATCH (parent:${e.parentLabel} { ${e.parentIdProp}: $parentId })`,
		`MATCH (child:${e.childLabel} { ${e.childIdProp}: $childId })`,
		`MERGE (parent)-[:${e.relType}]->(child)`,
	].join("\n");
}

function deleteEdgeStatement(e: EdgeNames): string {
	return [
		`MATCH (child:${e.childLabel} { ${e.childIdProp}: $childId })`,
		`OPTIONAL MATCH (:${e.parentLabel})-[r:${e.relType}]->(child)`,
		`DELETE r`,
	].join("\n");
}

function hasValue(v: unknown): boolean {
	return v !== undefined && v !== null;
}

/** MERGE (parent)-[:HAS_*]->(child) for each foreign key present in `data`. */
export async function linkReferenceEdges(
	ctx: SchemaContext,
	run: RunStatement,
	child: ChildNode,
	data: Record<string, unknown>,
): Promise<void> {
	for (const fk of foreignKeys(ctx, child.schemaKey)) {
		const parentId = data[fk.fkProp];
		if (!hasValue(parentId)) continue;
		await run(mergeEdgeStatement(edgeNames(ctx, child, fk)), {
			parentId,
			childId: child.id,
		});
	}
}

/** Rewire edges for every foreign key present in `patch` (null unlinks the parent). */
export async function relinkReferenceEdges(
	ctx: SchemaContext,
	run: RunStatement,
	child: ChildNode,
	patch: Record<string, unknown>,
): Promise<void> {
	for (const fk of foreignKeys(ctx, child.schemaKey)) {
		if (!(fk.fkProp in patch)) continue;
		const names = edgeNames(ctx, child, fk);
		await run(deleteEdgeStatement(names), { childId: child.id });

		const parentId = patch[fk.fkProp];
		if (!hasValue(parentId)) continue;
		await run(mergeEdgeStatement(names), { parentId, childId: child.id });
	}
}

export interface CascadeTarget {
	schemaKey: string;
	label: string;
	fkProp: string;
}

/** Child models whose schema declares `onDelete: "cascade"` towards `parentKey`. */
export function cascadeTargets(ctx: SchemaContext, parentKey: string): CascadeTarget[] {
	const targets: CascadeTarget[] = [];
	for (const schemaKey of Object.keys(ctx.schema)) {
		for (const fk of foreignKeys(ctx, schemaKey)) {
			if (!fk.cascadeOnDelete || fk.parentKey !== parentKey) continue;
			targets.push({ schemaKey, label: ctx.getModelName(schemaKey), fkProp: fk.fkProp });
		}
	}
	return targets;
}
