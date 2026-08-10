"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { FACTION_COLORS, NODE_ICONS } from "@/lib/games/velderanMap";
import type { MapEdge, MapNode, NodeType } from "@/lib/games/velderanMap";

const FACTIONS = [
  { id: "empire", name: "Империя" },
  { id: "republic", name: "Республика" },
  { id: "subbgars", name: "Суббгары" },
  { id: "dwarves", name: "Дворфы" },
  { id: "delions", name: "Дэлионы" },
  { id: "avains", name: "Авайны" },
  { id: "ancients", name: "Древние" },
  { id: "trolls", name: "Тролли" },
  { id: "dark", name: "Тёмные" },
  { id: "rebellion", name: "Мятеж" },
];

const ELEMENT_TYPES: { type: NodeType; label: string }[] = [
  { type: "battle", label: "Сражение" },
  { type: "port", label: "Порт" },
  { type: "shrine", label: "Алтарь" },
  { type: "windrose", label: "Море" },
];

const SPECIAL_TYPES: { type: NodeType; label: string }[] = [
  { type: "pirate", label: "Пираты" },
  { type: "ghost", label: "Призраки" },
  { type: "camp", label: "Лагерь" },
  { type: "smuggler", label: "Контрабандисты" },
];

let nextId = 1;
function genId(type: NodeType, faction?: string): string {
  const prefix = type === "city" ? (faction || "city").slice(0, 3) : type === "battle" ? "x" : type === "port" ? "p" : type === "shrine" ? "s" : type[0];
  return `${prefix}${nextId++}`;
}

export default function MapEditorPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [nodes, setNodes] = useState<MapNode[]>([]);
  const [edges, setEdges] = useState<MapEdge[]>([]);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [draggingNode, setDraggingNode] = useState<string | null>(null);
  const [drawMode, setDrawMode] = useState<"path" | "sea_path" | null>(null);
  const [showTemplate, setShowTemplate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [editingNode, setEditingNode] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapWrapperRef = useRef<HTMLDivElement>(null);

  const user = session?.user as { id?: string; username?: string } | undefined;
  const isAdmin = user && ((user.username || "").includes("acoulbot") || (user.id || "").includes("acoulbot"));

  const loadConfig = useCallback(async () => {
    try {
      const res = await fetch("/api/games/map-config");
      if (res.ok) {
        const data = await res.json();
        setEdges(data.edges || []);
        if (data.nodes && data.nodes.length > 0) {
          setNodes(data.nodes);
          const maxExisting = data.nodes.reduce((max: number, n: MapNode) => {
            const num = parseInt(n.id.replace(/[^0-9]/g, ""));
            return isNaN(num) ? max : Math.max(max, num);
          }, 0);
          nextId = maxExisting + 1;
        }
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (status === "authenticated") {
      if (!isAdmin) { router.push("/games/velderan"); return; }
      loadConfig();
    } else if (status === "unauthenticated") {
      router.push("/");
    }
  }, [status, isAdmin, router, loadConfig]);

  const handleMapClick = () => {
    if (draggingNode || editingNode || isPanning) return;
    if (!drawMode) {
      setSelectedNode(null);
    }
  };

  const zoomIn = () => setZoom((z) => Math.min(z + 0.25, 4));
  const zoomOut = () => setZoom((z) => Math.max(z - 0.25, 0.5));
  const zoomReset = () => { setZoom(1); setPan({ x: 0, y: 0 }); };

  const handleMiddleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 1) {
      e.preventDefault();
      setIsPanning(true);
      panStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
    }
  };

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isPanning) return;
      const dx = e.clientX - panStart.current.x;
      const dy = e.clientY - panStart.current.y;
      setPan({ x: panStart.current.panX + dx, y: panStart.current.panY + dy });
    };
    const onMouseUp = () => setIsPanning(false);
    if (isPanning) {
      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    }
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [isPanning, pan]);

  const handleNodeClick = (e: React.MouseEvent, nodeId: string) => {
    e.stopPropagation();
    if (draggingNode) return;

    if (drawMode && selectedNode && selectedNode !== nodeId) {
      const exists = edges.some(
        (ed) => (ed.from === selectedNode && ed.to === nodeId) || (ed.from === nodeId && ed.to === selectedNode)
      );
      if (exists) {
        setEdges(edges.filter(
          (ed) => !((ed.from === selectedNode && ed.to === nodeId) || (ed.from === nodeId && ed.to === selectedNode))
        ));
        setMessage("Путь удалён");
      } else {
        setEdges([...edges, { from: selectedNode, to: nodeId, sea: drawMode === "sea_path" || undefined }]);
        setMessage(`Путь создан${drawMode === "sea_path" ? " (морской)" : ""}`);
      }
      setSelectedNode(null);
    } else {
      setSelectedNode(nodeId);
    }
  };

  const handleNodeMouseDown = (e: React.MouseEvent, nodeId: string) => {
    if (drawMode || editingNode) return;
    e.preventDefault();
    e.stopPropagation();
    setDraggingNode(nodeId);

    const onMouseMove = (ev: MouseEvent) => {
      const container = mapContainerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const x = Math.max(0, Math.min(100, ((ev.clientX - rect.left) / rect.width) * 100));
      const y = Math.max(0, Math.min(100, ((ev.clientY - rect.top) / rect.height) * 100));
      setNodes((prev) => prev.map((n) => n.id === nodeId ? { ...n, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 } : n));
    };

    const onMouseUp = () => {
      setDraggingNode(null);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  const addNode = (type: NodeType, faction?: string) => {
    const id = genId(type, faction);
    const newNode: MapNode = {
      id,
      name: id,
      type,
      x: 50,
      y: 50,
      ...(faction ? { faction } : {}),
    };
    setNodes((prev) => [...prev, newNode]);
    setSelectedNode(id);
    setMessage(`Добавлен: ${id}. Перетащите на нужное место.`);
  };

  const deleteNode = (nodeId: string) => {
    setNodes((prev) => prev.filter((n) => n.id !== nodeId));
    setEdges((prev) => prev.filter((e) => e.from !== nodeId && e.to !== nodeId));
    if (selectedNode === nodeId) setSelectedNode(null);
    if (editingNode === nodeId) setEditingNode(null);
    setMessage(`Удалён: ${nodeId}`);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/games/map-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ edges, nodes }),
      });
      if (res.ok) {
        setMessage("Сохранено!");
      } else {
        setMessage("Ошибка сохранения");
      }
    } catch {
      setMessage("Ошибка сети");
    }
    setSaving(false);
  };

  const startEdit = (nodeId: string) => {
    const node = nodes.find((n) => n.id === nodeId);
    if (node) {
      setEditingNode(nodeId);
      setEditName(node.name);
    }
  };

  const saveEdit = () => {
    if (editingNode) {
      setNodes((prev) => prev.map((n) => n.id === editingNode ? { ...n, name: editName } : n));
      setEditingNode(null);
    }
  };

  if (status === "loading" || !isAdmin) {
    return (
      <div className="h-screen bg-neutral-950 flex items-center justify-center">
        <div className="text-white/50">Загрузка...</div>
      </div>
    );
  }

  const selectedNodeData = selectedNode ? nodes.find((n) => n.id === selectedNode) : null;

  return (
    <div className="h-screen bg-neutral-950 flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 bg-neutral-900 border-b border-white/10 flex-shrink-0 flex-wrap">
        <button onClick={() => router.push("/games/velderan")} className="text-gray-500 hover:text-gray-300 text-sm">
          ← Назад
        </button>
        <span className="text-white font-bold text-sm">🗺️ Редактор</span>
        <div className="w-px h-5 bg-white/10" />

        <button
          onClick={() => { setDrawMode(drawMode === "path" ? null : "path"); setSelectedNode(null); }}
          className={`px-2 py-1 rounded text-xs font-medium transition-all ${drawMode === "path" ? "bg-amber-600 text-white" : "bg-white/5 text-gray-300 hover:bg-white/10"}`}
        >
          ✏️ Путь
        </button>
        <button
          onClick={() => { setDrawMode(drawMode === "sea_path" ? null : "sea_path"); setSelectedNode(null); }}
          className={`px-2 py-1 rounded text-xs font-medium transition-all ${drawMode === "sea_path" ? "bg-sky-600 text-white" : "bg-white/5 text-gray-300 hover:bg-white/10"}`}
        >
          🌊 Море
        </button>
        <div className="w-px h-5 bg-white/10" />
        <button
          onClick={() => setShowTemplate(!showTemplate)}
          className={`px-2 py-1 rounded text-xs font-medium transition-all ${showTemplate ? "bg-purple-600 text-white" : "bg-white/5 text-gray-300 hover:bg-white/10"}`}
        >
          👁️ Шаблон
        </button>

        <div className="flex-1" />
        <span className="text-gray-500 text-xs">
          {nodes.length} нод · {edges.length} путей
        </span>
        <button onClick={handleSave} disabled={saving}
          className="px-3 py-1 bg-green-600 text-white rounded text-xs font-medium hover:bg-green-500 disabled:opacity-50">
          {saving ? "..." : "💾 Сохранить"}
        </button>
        {message && <span className="text-amber-400 text-xs">{message}</span>}
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Map area */}
        <div
          ref={mapWrapperRef}
          className="flex-1 relative flex items-center justify-center overflow-hidden bg-neutral-950"
          onMouseDown={handleMiddleMouseDown}
          onWheel={(e) => e.preventDefault()}
        >
          <div
            ref={mapContainerRef}
            className="relative"
            style={{
              width: "100%",
              maxWidth: `calc((100vh - 48px) * 2400 / 1792)`,
              aspectRatio: "2400/1792",
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: "center center",
              transition: isPanning ? "none" : "transform 0.15s ease-out",
            }}
            onClick={handleMapClick}
          >
            {/* Base map */}
            <Image src="/games/velderan/map-editor.png" alt="Карта" fill className="object-contain" priority unoptimized />

            {/* Template overlay */}
            {showTemplate && (
              <Image src="/games/velderan/map-template.png" alt="Шаблон" fill className="object-contain opacity-60 pointer-events-none" unoptimized />
            )}

          {/* Zoom controls */}
          <div className="absolute bottom-3 left-3 flex items-center gap-1 z-50">
            <button onClick={zoomOut} className="w-8 h-8 bg-black/70 text-white rounded-lg hover:bg-black/90 text-lg font-bold">−</button>
            <button onClick={zoomReset} className="px-2 h-8 bg-black/70 text-white rounded-lg hover:bg-black/90 text-xs">{Math.round(zoom * 100)}%</button>
            <button onClick={zoomIn} className="w-8 h-8 bg-black/70 text-white rounded-lg hover:bg-black/90 text-lg font-bold">+</button>
          </div>

            {/* SVG edges */}
            <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none">
              {edges.map((edge, i) => {
                const from = nodes.find((n) => n.id === edge.from);
                const to = nodes.find((n) => n.id === edge.to);
                if (!from || !to) return null;
                return (
                  <line key={i} x1={from.x} y1={from.y} x2={to.x} y2={to.y}
                    stroke={edge.sea ? "#38bdf8" : "#fbbf24"} strokeWidth={0.15} strokeDasharray="0.5 0.3" opacity={0.8} />
                );
              })}
            </svg>

            {/* Nodes */}
            {nodes.map((node) => {
              const isSelected = selectedNode === node.id;
              const isDragging = draggingNode === node.id;
              const isCity = node.type === "city";
              const factionColor = node.faction ? FACTION_COLORS[node.faction] : undefined;
              const icon = NODE_ICONS[node.type] || "❓";

              return (
                <div
                  key={node.id}
                  className={`absolute transform -translate-x-1/2 -translate-y-1/2 group ${isDragging ? "cursor-grabbing z-50" : "cursor-grab"}`}
                  style={{ left: `${node.x}%`, top: `${node.y}%`, zIndex: isSelected || isDragging ? 50 : 10 }}
                  onClick={(e) => handleNodeClick(e, node.id)}
                  onMouseDown={(e) => handleNodeMouseDown(e, node.id)}
                  onDoubleClick={(e) => { e.stopPropagation(); startEdit(node.id); }}
                >
                  <div
                    className={`flex items-center justify-center rounded-full transition-all ${
                      isSelected ? "ring-2 ring-yellow-400 scale-150" : isDragging ? "scale-150 ring-2 ring-white/50" : "hover:scale-125"
                    }`}
                    style={{
                      width: isCity ? "18px" : "14px",
                      height: isCity ? "18px" : "14px",
                      backgroundColor: isCity ? factionColor || "#666" : "rgba(0,0,0,0.8)",
                      border: `2px solid ${isCity ? "#fff" : factionColor || "#888"}`,
                    }}
                  >
                    <span style={{ fontSize: isCity ? "7px" : "6px" }}>{icon}</span>
                  </div>

                  {/* Tooltip on hover */}
                  <div className="absolute left-1/2 -translate-x-1/2 -top-5 bg-black/90 text-white text-[9px] px-1.5 py-0.5 rounded whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50">
                    {node.name} ({node.type})
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Sidebar */}
        <div className="w-64 bg-neutral-900 border-l border-white/10 overflow-y-auto flex-shrink-0 p-2 text-xs">
          {/* Palette — Cities */}
          <div className="mb-3">
            <p className="text-gray-400 font-medium mb-1.5">🏰 Города</p>
            <div className="grid grid-cols-2 gap-1">
              {FACTIONS.map((f) => (
                <button key={f.id} onClick={() => addNode("city", f.id)}
                  className="flex items-center gap-1.5 px-2 py-1.5 bg-neutral-800 rounded hover:bg-neutral-700 transition-colors">
                  <div className="w-3 h-3 rounded-full flex-shrink-0 border border-white/30" style={{ backgroundColor: FACTION_COLORS[f.id] }} />
                  <span className="text-gray-300 truncate">{f.name}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Palette — Other types */}
          <div className="mb-3">
            <p className="text-gray-400 font-medium mb-1.5">Элементы</p>
            <div className="grid grid-cols-2 gap-1">
              {ELEMENT_TYPES.map((el) => (
                <button key={el.type} onClick={() => addNode(el.type)}
                  className="flex items-center gap-1.5 px-2 py-1.5 bg-neutral-800 rounded hover:bg-neutral-700 transition-colors">
                  <span>{NODE_ICONS[el.type]}</span>
                  <span className="text-gray-300">{el.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Palette — Special locations (max 1 each) */}
          <div className="mb-3">
            <p className="text-gray-400 font-medium mb-1.5">⚡ Спецлокации</p>
            <div className="grid grid-cols-2 gap-1">
              {SPECIAL_TYPES.map((el) => {
                const exists = nodes.some((n) => n.type === el.type);
                return (
                  <button key={el.type} onClick={() => !exists && addNode(el.type)} disabled={exists}
                    className={`flex items-center gap-1.5 px-2 py-1.5 rounded transition-colors ${
                      exists ? "bg-neutral-800/40 opacity-40 cursor-not-allowed" : "bg-neutral-800 hover:bg-neutral-700"
                    }`}
                    title={exists ? "Уже размещён (макс. 1)" : `Добавить ${el.label}`}
                  >
                    <span>{NODE_ICONS[el.type]}</span>
                    <span className="text-gray-300 truncate">{el.label}</span>
                    {exists && <span className="text-[9px] text-green-400">✓</span>}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="border-t border-white/10 my-2" />

          {/* Draw mode info */}
          {drawMode && (
            <div className="mb-2 p-2 bg-amber-900/20 border border-amber-500/30 rounded">
              <p className="text-amber-400 font-medium">
                {drawMode === "path" ? "✏️ Путь (суша)" : "🌊 Путь (море)"}
              </p>
              <p className="text-gray-400 mt-0.5">
                {selectedNode ? `Выбрано: ${selectedNode}. Кликните вторую точку.` : "Кликните на первую точку."}
              </p>
            </div>
          )}

          {/* Selected node info */}
          {selectedNodeData && !drawMode && (
            <div className="mb-2 p-2 bg-neutral-800 rounded">
              <div className="flex items-center justify-between mb-1">
                <p className="text-white font-medium">{selectedNodeData.name}</p>
                <button onClick={() => deleteNode(selectedNodeData.id)}
                  className="text-red-400/60 hover:text-red-400 text-sm" title="Удалить">✕</button>
              </div>
              <p className="text-gray-500">ID: {selectedNodeData.id}</p>
              <p className="text-gray-500">Тип: {NODE_ICONS[selectedNodeData.type]} {selectedNodeData.type}</p>
              {selectedNodeData.faction && <p className="text-gray-500">Фракция: {selectedNodeData.faction}</p>}
              <p className="text-gray-500">Позиция: ({selectedNodeData.x}%, {selectedNodeData.y}%)</p>

              {/* Connections */}
              {edges.filter((e) => e.from === selectedNodeData.id || e.to === selectedNodeData.id).length > 0 && (
                <div className="mt-1.5">
                  <p className="text-gray-400">Связи:</p>
                  {edges
                    .filter((e) => e.from === selectedNodeData.id || e.to === selectedNodeData.id)
                    .map((e, i) => {
                      const otherId = e.from === selectedNodeData.id ? e.to : e.from;
                      const other = nodes.find((n) => n.id === otherId);
                      return (
                        <div key={i} className="flex items-center justify-between py-0.5">
                          <span className="text-gray-300">{other?.name || otherId}</span>
                          <span className={e.sea ? "text-sky-400" : "text-amber-400"}>
                            {e.sea ? "🌊" : "🏔️"}
                          </span>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          )}

          {/* Edit name modal */}
          {editingNode && (
            <div className="mb-2 p-2 bg-neutral-800 rounded border border-purple-500/30">
              <p className="text-purple-400 font-medium mb-1">Редактирование</p>
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && saveEdit()}
                className="w-full px-2 py-1 bg-neutral-700 text-white rounded border border-white/10 text-xs"
                autoFocus
              />
              <div className="flex gap-1 mt-1">
                <button onClick={saveEdit} className="flex-1 px-2 py-1 bg-purple-600 text-white rounded hover:bg-purple-500">Ок</button>
                <button onClick={() => setEditingNode(null)} className="flex-1 px-2 py-1 bg-neutral-700 text-gray-300 rounded hover:bg-neutral-600">Отмена</button>
              </div>
            </div>
          )}

          {/* Instructions */}
          <div className="p-2 bg-neutral-800 rounded text-gray-500 mt-1">
            <p className="text-gray-400 font-medium mb-0.5">Инструкция</p>
            <p>• Нажмите кнопку в палитре → элемент появится в центре</p>
            <p>• Перетащите его на нужное место</p>
            <p>• Включите &ldquo;Шаблон&rdquo; как подсказку</p>
            <p>• Двойной клик → редактирование имени</p>
            <p>• &ldquo;Путь&rdquo;/&ldquo;Море&rdquo; → кликните 2 точки</p>
            <p>• Не забудьте сохранить!</p>
          </div>

          {/* Stats */}
          <div className="p-2 bg-neutral-800 rounded mt-1 text-gray-500">
            <p className="text-gray-400 font-medium mb-0.5">Статистика</p>
            <p>Города: {nodes.filter((n) => n.type === "city").length}</p>
            <p>Битвы: {nodes.filter((n) => n.type === "battle").length}</p>
            <p>Порты: {nodes.filter((n) => n.type === "port").length}</p>
            <p>Алтари: {nodes.filter((n) => n.type === "shrine").length}</p>
            <p>Море: {nodes.filter((n) => n.type === "windrose").length}</p>
            <p>Пути суша: {edges.filter((e) => !e.sea).length}</p>
            <p>Пути море: {edges.filter((e) => e.sea).length}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
