import { Chess } from 'chess.js';

export interface VNode {
  id: number;
  parent: number | null;
  fen: string;
  san?: string;
  uci?: string;
  color?: 'w' | 'b';
  children: number[];
}

export interface VTree {
  nodes: Record<number, VNode>;
  root: number;
  next: number;
}

export function newTree(fen: string): VTree {
  return { nodes: { 0: { id: 0, parent: null, fen, children: [] } }, root: 0, next: 1 };
}

/** Añade (o reutiliza) la jugada `uci` desde el nodo `parentId`. Devuelve [árbol, id del nodo] o null si es ilegal. */
export function addMove(tree: VTree, parentId: number, uci: string): [VTree, number] | null {
  const parent = tree.nodes[parentId];
  for (const cid of parent.children) if (tree.nodes[cid].uci === uci) return [tree, cid];
  const c = new Chess(parent.fen);
  let m;
  try {
    m = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || undefined });
  } catch {
    return null;
  }
  const id = tree.next;
  const node: VNode = { id, parent: parentId, fen: c.fen(), san: m.san, uci: m.from + m.to + (m.promotion ?? ''), color: m.color, children: [] };
  const nodes = { ...tree.nodes, [id]: node, [parentId]: { ...parent, children: [...parent.children, id] } };
  return [{ nodes, root: tree.root, next: id + 1 }, id];
}

/** Añade una secuencia de jugadas UCI; devuelve los ids creados */
export function addLine(tree: VTree, fromId: number, ucis: string[], max = 99): [VTree, number[]] {
  let t = tree;
  let cur = fromId;
  const ids: number[] = [];
  for (const u of ucis.slice(0, max)) {
    const r = addMove(t, cur, u);
    if (!r) break;
    [t, cur] = r;
    ids.push(cur);
  }
  return [t, ids];
}

export function pathTo(tree: VTree, id: number): number[] {
  const p: number[] = [];
  let cur: number | null = id;
  while (cur !== null) {
    p.unshift(cur);
    cur = tree.nodes[cur].parent;
  }
  return p;
}

/** Elimina un nodo (y su subárbol) */
export function deleteNode(tree: VTree, id: number): VTree {
  const n = tree.nodes[id];
  if (n.parent === null) return tree;
  const nodes = { ...tree.nodes };
  const rm = (x: number) => {
    nodes[x].children.forEach(rm);
    delete nodes[x];
  };
  rm(id);
  const p = nodes[n.parent];
  nodes[n.parent] = { ...p, children: p.children.filter((c) => c !== id) };
  return { ...tree, nodes };
}

/** Convierte un nodo en la línea principal de su padre */
export function promote(tree: VTree, id: number): VTree {
  const n = tree.nodes[id];
  if (n.parent === null) return tree;
  const p = tree.nodes[n.parent];
  return { ...tree, nodes: { ...tree.nodes, [p.id]: { ...p, children: [id, ...p.children.filter((c) => c !== id)] } } };
}
