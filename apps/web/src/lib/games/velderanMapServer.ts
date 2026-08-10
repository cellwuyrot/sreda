import fs from "fs";
import path from "path";
import { setMapEdges, setCustomNodes } from "./velderanMap";

/** Load map config from JSON files on server side (edges + custom nodes) */
export function loadMapConfigFromFiles(): void {
  try {
    const edgesPath = path.join(process.cwd(), "public/games/velderan/map-edges.json");
    const nodesPath = path.join(process.cwd(), "public/games/velderan/map-nodes-custom.json");
    if (fs.existsSync(edgesPath)) {
      const edges = JSON.parse(fs.readFileSync(edgesPath, "utf-8"));
      if (Array.isArray(edges) && edges.length > 0) setMapEdges(edges);
    }
    if (fs.existsSync(nodesPath)) {
      const nodes = JSON.parse(fs.readFileSync(nodesPath, "utf-8"));
      if (Array.isArray(nodes) && nodes.length > 0) setCustomNodes(nodes);
    }
  } catch {
    // ignore — files may not exist yet
  }
}
