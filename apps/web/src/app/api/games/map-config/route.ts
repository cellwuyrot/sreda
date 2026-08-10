import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import fs from "fs";
import path from "path";

const MAP_EDGES_PATH = path.join(process.cwd(), "public/games/velderan/map-edges.json");
const MAP_NODES_CUSTOM_PATH = path.join(process.cwd(), "public/games/velderan/map-nodes-custom.json");

function isGameAdmin(session: { user?: { id?: string; username?: string } } | null): boolean {
  if (!session?.user) return false;
  const u = session.user as { id?: string; username?: string };
  return (u.username || "").includes("acoulbot") || (u.id || "").includes("acoulbot");
}

// GET — load current map edges and custom nodes
export async function GET() {
  try {
    let edges: unknown[] = [];
    let nodes: unknown[] = [];

    if (fs.existsSync(MAP_EDGES_PATH)) {
      edges = JSON.parse(fs.readFileSync(MAP_EDGES_PATH, "utf-8"));
    }
    if (fs.existsSync(MAP_NODES_CUSTOM_PATH)) {
      nodes = JSON.parse(fs.readFileSync(MAP_NODES_CUSTOM_PATH, "utf-8"));
    }

    return NextResponse.json({ edges, nodes });
  } catch {
    return NextResponse.json({ edges: [], nodes: [] });
  }
}

// POST — save map edges and custom nodes (admin only)
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!isGameAdmin(session)) {
    return NextResponse.json({ error: "Доступ запрещён" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { edges, nodes } = body;

    if (edges !== undefined) {
      fs.writeFileSync(MAP_EDGES_PATH, JSON.stringify(edges, null, 2));
    }
    if (nodes !== undefined) {
      fs.writeFileSync(MAP_NODES_CUSTOM_PATH, JSON.stringify(nodes, null, 2));
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Ошибка сохранения" }, { status: 500 });
  }
}
