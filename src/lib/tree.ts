/**
 * Generic tree helpers operating on a list of `{ id, parentId }` records.
 * Used by the agent-tree UI to validate parent reassignments.
 */

export type TreeNode = { id: string; parentId: string | null };

/**
 * Returns true if assigning `candidateParentId` as the new parent of
 * `nodeId` would create a cycle. A cycle happens when the candidate
 * is the node itself or any descendant of it (because the candidate's
 * own ancestor chain would pass through `nodeId`).
 *
 * Walks upward from `candidateParentId` via `parentId` links. If we ever
 * land on `nodeId` we have a cycle. A bound on iterations protects
 * against pre-existing malformed data (cycle in the source array).
 */
export function wouldCreateCycle<T extends TreeNode>(
  nodes: T[],
  nodeId: string,
  candidateParentId: string | null,
): boolean {
  if (candidateParentId === null) return false;
  if (candidateParentId === nodeId) return true;

  const byId = new Map<string, T>();
  for (const n of nodes) byId.set(n.id, n);

  let cursor: string | null = candidateParentId;
  let hops = 0;
  const max = nodes.length + 1;
  while (cursor !== null && hops <= max) {
    if (cursor === nodeId) return true;
    const next = byId.get(cursor);
    if (!next) return false;
    cursor = next.parentId;
    hops += 1;
  }
  // Hit hop limit -> source data already has a cycle. Treat as unsafe.
  return hops > max;
}
