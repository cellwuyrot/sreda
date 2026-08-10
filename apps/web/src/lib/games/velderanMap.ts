export type NodeType = "city" | "battle" | "port" | "shrine" | "windrose" | "pirate" | "ghost" | "camp" | "smuggler";

export interface MapNode {
  id: string;
  name: string;
  type: NodeType;
  x: number; // % from left (0-100)
  y: number; // % from top (0-100)
  faction?: string;
}

export interface MapEdge {
  from: string;
  to: string;
  sea?: boolean;
}

// Positions extracted from the official template overlay (2400×1792)
// 155 nodes: 49 cities, 41 battles, 26 shrines, 39 ports
export const MAP_NODES: MapNode[] = [
  // === ANCIENTS (brown, 7 cities) ===
  { id: "anc1", name: "anc1", type: "city", x: 37.0, y: 3.8, faction: "ancients" },
  { id: "anc2", name: "anc2", type: "city", x: 33.8, y: 8.6, faction: "ancients" },
  { id: "anc3", name: "anc3", type: "city", x: 37.4, y: 14.9, faction: "ancients" },
  { id: "anc4", name: "anc4", type: "city", x: 32.3, y: 15.6, faction: "ancients" },
  { id: "anc5", name: "anc5", type: "city", x: 74.7, y: 43.1, faction: "ancients" },
  { id: "anc6", name: "anc6", type: "city", x: 66.3, y: 51.6, faction: "ancients" },
  { id: "anc7", name: "anc7", type: "city", x: 81.6, y: 65.7, faction: "ancients" },

  // === AVAINS (light blue, 5 cities) ===
  { id: "ava1", name: "ava1", type: "city", x: 52.4, y: 2.5, faction: "avains" },
  { id: "ava2", name: "ava2", type: "city", x: 47.3, y: 3.2, faction: "avains" },
  { id: "ava3", name: "ava3", type: "city", x: 56.9, y: 3.8, faction: "avains" },
  { id: "ava4", name: "ava4", type: "city", x: 43.4, y: 6.9, faction: "avains" },
  { id: "ava5", name: "ava5", type: "city", x: 63.6, y: 5.3, faction: "avains" },

  // === EMPIRE (red, 7 cities) ===
  { id: "emp1", name: "emp1", type: "city", x: 43.1, y: 16.9, faction: "empire" },
  { id: "emp2", name: "emp2", type: "city", x: 38.9, y: 27.1, faction: "empire" },
  { id: "emp3", name: "emp3", type: "city", x: 20.9, y: 37.0, faction: "empire" },
  { id: "emp4", name: "emp4", type: "city", x: 29.9, y: 39.2, faction: "empire" },
  { id: "emp5", name: "emp5", type: "city", x: 42.4, y: 42.0, faction: "empire" },
  { id: "emp6", name: "emp6", type: "city", x: 27.1, y: 49.3, faction: "empire" },
  { id: "emp7", name: "emp7", type: "city", x: 19.2, y: 51.1, faction: "empire" },

  // === REPUBLIC (blue, 6 cities) ===
  { id: "rep1", name: "rep1", type: "city", x: 74.5, y: 12.9, faction: "republic" },
  { id: "rep2", name: "rep2", type: "city", x: 26.7, y: 55.1, faction: "republic" },
  { id: "rep3", name: "rep3", type: "city", x: 31.5, y: 59.0, faction: "republic" },
  { id: "rep4", name: "rep4", type: "city", x: 42.7, y: 65.1, faction: "republic" },
  { id: "rep5", name: "rep5", type: "city", x: 36.6, y: 70.6, faction: "republic" },
  { id: "rep6", name: "rep6", type: "city", x: 19.4, y: 74.5, faction: "republic" },

  // === SUBBGARS (purple, 3 cities) ===
  { id: "sub1", name: "sub1", type: "city", x: 54.5, y: 18.4, faction: "subbgars" },
  { id: "sub2", name: "sub2", type: "city", x: 65.8, y: 15.3, faction: "subbgars" },
  { id: "sub3", name: "sub3", type: "city", x: 80.9, y: 24.9, faction: "subbgars" },

  // === DWARVES (yellow, 4 cities) ===
  { id: "dwa1", name: "dwa1", type: "city", x: 84.1, y: 19.9, faction: "dwarves" },
  { id: "dwa2", name: "dwa2", type: "city", x: 82.9, y: 37.0, faction: "dwarves" },
  { id: "dwa3", name: "dwa3", type: "city", x: 83.6, y: 55.0, faction: "dwarves" },
  { id: "dwa4", name: "dwa4", type: "city", x: 13.9, y: 75.5, faction: "dwarves" },

  // === TROLLS (green, 6 cities) ===
  { id: "tro1", name: "tro1", type: "city", x: 57.7, y: 40.5, faction: "trolls" },
  { id: "tro2", name: "tro2", type: "city", x: 95.7, y: 39.4, faction: "trolls" },
  { id: "tro3", name: "tro3", type: "city", x: 8.4, y: 50.6, faction: "trolls" },
  { id: "tro4", name: "tro4", type: "city", x: 80.1, y: 50.8, faction: "trolls" },
  { id: "tro5", name: "tro5", type: "city", x: 44.2, y: 53.9, faction: "trolls" },
  { id: "tro6", name: "tro6", type: "city", x: 89.3, y: 61.9, faction: "trolls" },

  // === REBELLION (gray-brown, 3 cities) ===
  { id: "reb1", name: "reb1", type: "city", x: 23.4, y: 51.5, faction: "rebellion" },
  { id: "reb2", name: "reb2", type: "city", x: 9.5, y: 56.3, faction: "rebellion" },
  { id: "reb3", name: "reb3", type: "city", x: 10.6, y: 64.6, faction: "rebellion" },

  // === DELIONS (white, 5 cities) ===
  { id: "del1", name: "del1", type: "city", x: 76.3, y: 66.0, faction: "delions" },
  { id: "del2", name: "del2", type: "city", x: 68.6, y: 77.9, faction: "delions" },
  { id: "del3", name: "del3", type: "city", x: 56.4, y: 83.2, faction: "delions" },
  { id: "del4", name: "del4", type: "city", x: 66.5, y: 83.6, faction: "delions" },
  { id: "del5", name: "del5", type: "city", x: 75.1, y: 91.1, faction: "delions" },

  // === DARK (black circles, 3 cities) ===
  { id: "dar1", name: "dar1", type: "city", x: 40.1, y: 83.4, faction: "dark" },
  { id: "dar2", name: "dar2", type: "city", x: 62.0, y: 90.5, faction: "dark" },
  { id: "dar3", name: "dar3", type: "city", x: 42.5, y: 94.8, faction: "dark" },

  // === BATTLE / CROSSING POINTS (41) ===
  { id: "x1", name: "x1", type: "battle", x: 66.4, y: 7.0 },
  { id: "x2", name: "x2", type: "battle", x: 40.4, y: 7.4 },
  { id: "x3", name: "x3", type: "battle", x: 49.9, y: 7.7 },
  { id: "x4", name: "x4", type: "battle", x: 69.5, y: 8.3 },
  { id: "x5", name: "x5", type: "battle", x: 54.0, y: 11.2 },
  { id: "x6", name: "x6", type: "battle", x: 45.3, y: 12.5 },
  { id: "x7", name: "x7", type: "battle", x: 39.8, y: 13.2 },
  { id: "x8", name: "x8", type: "battle", x: 61.4, y: 18.9 },
  { id: "x9", name: "x9", type: "battle", x: 89.4, y: 25.6 },
  { id: "x10", name: "x10", type: "battle", x: 84.3, y: 26.1 },
  { id: "x11", name: "x11", type: "battle", x: 86.2, y: 34.2 },
  { id: "x12", name: "x12", type: "battle", x: 38.2, y: 34.7 },
  { id: "x13", name: "x13", type: "battle", x: 91.3, y: 34.7 },
  { id: "x14", name: "x14", type: "battle", x: 35.7, y: 40.4 },
  { id: "x15", name: "x15", type: "battle", x: 31.2, y: 43.4 },
  { id: "x16", name: "x16", type: "battle", x: 17.6, y: 47.4 },
  { id: "x17", name: "x17", type: "battle", x: 12.9, y: 49.2 },
  { id: "x18", name: "x18", type: "battle", x: 37.3, y: 50.4 },
  { id: "x19", name: "x19", type: "battle", x: 13.4, y: 53.5 },
  { id: "x20", name: "x20", type: "battle", x: 30.5, y: 54.7 },
  { id: "x21", name: "x21", type: "battle", x: 39.8, y: 55.2 },
  { id: "x22", name: "x22", type: "battle", x: 69.8, y: 55.5 },
  { id: "x23", name: "x23", type: "battle", x: 74.8, y: 56.8 },
  { id: "x24", name: "x24", type: "battle", x: 28.4, y: 60.0 },
  { id: "x25", name: "x25", type: "battle", x: 34.8, y: 60.0 },
  { id: "x26", name: "x26", type: "battle", x: 18.6, y: 60.8 },
  { id: "x27", name: "x27", type: "battle", x: 79.2, y: 62.1 },
  { id: "x28", name: "x28", type: "battle", x: 6.2, y: 64.7 },
  { id: "x29", name: "x29", type: "battle", x: 31.9, y: 66.9 },
  { id: "x30", name: "x30", type: "battle", x: 78.5, y: 70.8 },
  { id: "x31", name: "x31", type: "battle", x: 89.9, y: 73.0 },
  { id: "x32", name: "x32", type: "battle", x: 7.4, y: 73.7 },
  { id: "x33", name: "x33", type: "battle", x: 34.8, y: 74.9 },
  { id: "x34", name: "x34", type: "battle", x: 78.8, y: 78.4 },
  { id: "x35", name: "x35", type: "battle", x: 17.9, y: 80.2 },
  { id: "x36", name: "x36", type: "battle", x: 69.8, y: 85.1 },
  { id: "x37", name: "x37", type: "battle", x: 48.0, y: 86.4 },
  { id: "x38", name: "x38", type: "battle", x: 56.4, y: 86.9 },
  { id: "x39", name: "x39", type: "battle", x: 80.9, y: 88.2 },
  { id: "x40", name: "x40", type: "battle", x: 50.0, y: 90.2 },
  { id: "x41", name: "x41", type: "battle", x: 67.6, y: 91.0 },

  // === SHRINES / SPECIAL LOCATIONS (26) ===
  { id: "s1", name: "s1", type: "shrine", x: 85.0, y: 4.3 },
  { id: "s2", name: "s2", type: "shrine", x: 37.1, y: 21.3 },
  { id: "s3", name: "s3", type: "shrine", x: 43.8, y: 22.2 },
  { id: "s4", name: "s4", type: "shrine", x: 24.5, y: 24.3 },
  { id: "s5", name: "s5", type: "shrine", x: 69.3, y: 25.2 },
  { id: "s6", name: "s6", type: "shrine", x: 56.1, y: 26.6 },
  { id: "s7", name: "s7", type: "shrine", x: 17.8, y: 30.8 },
  { id: "s8", name: "s8", type: "shrine", x: 25.1, y: 35.4 },
  { id: "s9", name: "s9", type: "shrine", x: 46.4, y: 35.8 },
  { id: "s10", name: "s10", type: "shrine", x: 62.3, y: 38.1 },
  { id: "s11", name: "s11", type: "shrine", x: 80.9, y: 44.6 },
  { id: "s12", name: "s12", type: "shrine", x: 91.2, y: 51.6 },
  { id: "s13", name: "s13", type: "shrine", x: 59.7, y: 52.0 },
  { id: "s14", name: "s14", type: "shrine", x: 48.5, y: 53.5 },
  { id: "s15", name: "s15", type: "shrine", x: 1.4, y: 56.7 },
  { id: "s16", name: "s16", type: "shrine", x: 22.8, y: 63.8 },
  { id: "s17", name: "s17", type: "shrine", x: 63.7, y: 68.4 },
  { id: "s18", name: "s18", type: "shrine", x: 47.8, y: 72.6 },
  { id: "s19", name: "s19", type: "shrine", x: 95.3, y: 78.1 },
  { id: "s20", name: "s20", type: "shrine", x: 37.1, y: 79.5 },
  { id: "s21", name: "s21", type: "shrine", x: 27.6, y: 82.3 },
  { id: "s22", name: "s22", type: "shrine", x: 33.5, y: 88.9 },
  { id: "s23", name: "s23", type: "shrine", x: 96.7, y: 90.7 },
  { id: "s24", name: "s24", type: "shrine", x: 9.4, y: 92.5 },
  { id: "s25", name: "s25", type: "shrine", x: 83.4, y: 96.1 },
  { id: "s26", name: "s26", type: "shrine", x: 60.5, y: 97.5 },

  // === PORTS / ANCHORS (39) ===
  { id: "p1", name: "p1", type: "port", x: 35.6, y: 2.8 },
  { id: "p2", name: "p2", type: "port", x: 63.4, y: 2.8 },
  { id: "p3", name: "p3", type: "port", x: 43.1, y: 4.1 },
  { id: "p4", name: "p4", type: "port", x: 32.9, y: 6.4 },
  { id: "p5", name: "p5", type: "port", x: 31.0, y: 16.8 },
  { id: "p6", name: "p6", type: "port", x: 74.6, y: 17.4 },
  { id: "p7", name: "p7", type: "port", x: 34.4, y: 19.2 },
  { id: "p8", name: "p8", type: "port", x: 68.5, y: 19.2 },
  { id: "p9", name: "p9", type: "port", x: 38.9, y: 24.7 },
  { id: "p10", name: "p10", type: "port", x: 62.2, y: 28.5 },
  { id: "p11", name: "p11", type: "port", x: 14.9, y: 29.7 },
  { id: "p12", name: "p12", type: "port", x: 65.4, y: 30.8 },
  { id: "p13", name: "p13", type: "port", x: 20.7, y: 34.7 },
  { id: "p14", name: "p14", type: "port", x: 41.1, y: 37.1 },
  { id: "p15", name: "p15", type: "port", x: 28.3, y: 39.0 },
  { id: "p16", name: "p16", type: "port", x: 74.0, y: 39.4 },
  { id: "p17", name: "p17", type: "port", x: 79.1, y: 39.4 },
  { id: "p18", name: "p18", type: "port", x: 96.4, y: 41.3 },
  { id: "p19", name: "p19", type: "port", x: 43.7, y: 42.5 },
  { id: "p20", name: "p20", type: "port", x: 79.7, y: 47.6 },
  { id: "p21", name: "p21", type: "port", x: 7.6, y: 48.0 },
  { id: "p22", name: "p22", type: "port", x: 64.7, y: 50.3 },
  { id: "p23", name: "p23", type: "port", x: 83.9, y: 52.3 },
  { id: "p24", name: "p24", type: "port", x: 45.6, y: 54.7 },
  { id: "p25", name: "p25", type: "port", x: 90.4, y: 59.5 },
  { id: "p26", name: "p26", type: "port", x: 43.7, y: 65.7 },
  { id: "p27", name: "p27", type: "port", x: 26.5, y: 67.6 },
  { id: "p28", name: "p28", type: "port", x: 76.3, y: 68.7 },
  { id: "p29", name: "p29", type: "port", x: 3.2, y: 72.3 },
  { id: "p30", name: "p30", type: "port", x: 18.1, y: 72.3 },
  { id: "p31", name: "p31", type: "port", x: 31.0, y: 76.2 },
  { id: "p32", name: "p32", type: "port", x: 55.8, y: 79.7 },
  { id: "p33", name: "p33", type: "port", x: 50.3, y: 80.6 },
  { id: "p34", name: "p34", type: "port", x: 66.6, y: 80.8 },
  { id: "p35", name: "p35", type: "port", x: 38.9, y: 85.0 },
  { id: "p36", name: "p36", type: "port", x: 20.7, y: 91.3 },
  { id: "p37", name: "p37", type: "port", x: 90.4, y: 91.8 },
  { id: "p38", name: "p38", type: "port", x: 74.6, y: 93.7 },
  { id: "p39", name: "p39", type: "port", x: 41.1, y: 96.0 },
];

// Custom nodes loaded from map config, overrides MAP_NODES when set
let customNodes: MapNode[] | null = null;

export function setCustomNodes(nodes: MapNode[]) {
  customNodes = nodes;
}

export function getActiveNodes(): MapNode[] {
  return customNodes && customNodes.length > 0 ? customNodes : MAP_NODES;
}

// Edges stored in map config file, loaded at runtime
export let MAP_EDGES: MapEdge[] = [];

export function setMapEdges(edges: MapEdge[]) {
  MAP_EDGES = edges;
}

export const NODE_COLORS: Record<NodeType, string> = {
  city: "#fff",
  battle: "#ef4444",
  shrine: "#a855f7",
  port: "#3b82f6",
  windrose: "#38bdf8",
  pirate: "#f97316",
  ghost: "#6b7280",
  camp: "#d97706",
  smuggler: "#10b981",
};

export const NODE_ICONS: Record<NodeType, string> = {
  city: "🏰",
  battle: "⚔️",
  shrine: "💎",
  port: "⚓",
  windrose: "🧭",
  pirate: "🏴‍☠️",
  ghost: "☠️",
  camp: "🏕️",
  smuggler: "⛵",
};

export const FACTION_COLORS: Record<string, string> = {
  empire: "#ef4444",
  republic: "#3b82f6",
  subbgars: "#a855f7",
  dwarves: "#eab308",
  delions: "#f5f5f5",
  avains: "#93c5fd",
  ancients: "#92400e",
  trolls: "#22c55e",
  dark: "#67e8f9",
  rebellion: "#9ca3af",
};

export function getNeighbors(nodeId: string): string[] {
  const neighbors: string[] = [];
  for (const edge of MAP_EDGES) {
    if (edge.from === nodeId) neighbors.push(edge.to);
    if (edge.to === nodeId) neighbors.push(edge.from);
  }
  return [...new Set(neighbors)];
}

export function getNodeById(id: string): MapNode | undefined {
  return getActiveNodes().find((n) => n.id === id);
}

