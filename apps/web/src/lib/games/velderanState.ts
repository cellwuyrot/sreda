import { getActiveNodes, getNeighbors } from "./velderanMap";

export interface GameUnit {
  id: string;
  playerId: string; // GamePlayer.id
  type: "ARMY" | "GUARD";
  position: string; // MapNode.id
  movesLeft: number;
}

export interface CombatState {
  attackerUnitId: string;
  defenderUnitId: string;
  attackerPlayerId: string;
  defenderPlayerId: string;
  attackerCard?: number; // 1-5
  defenderCard?: number;
  attackerGuess?: number;
  defenderGuess?: number;
  nodeId: string;
  specialType?: "pirate" | "ghost" | "camp"; // remote combat from special location
  attackerUseDeck?: boolean; // use top deck card instead of hand
  defenderUseDeck?: boolean;
  safeLoser?: string; // playerId who doesn't lose unit on defeat
}

export interface GodCard {
  godId: number; // 3,5,6,7,9
  godName: string;
}

export interface SmugglerQueueEntry {
  playerId: string;
  unitId: string;
  targetPortId: string;
  roundQueued: number;
}

export interface SpecialLocationState {
  controllerId?: string;
  usesLeft: number;
}

export interface GodResult {
  roll: [number, number];
  total: number;
  godName: string;
  effect: string;
  playerId: string;
  shrineId: string;
}

export interface InventoryUnit {
  id: string;
  type: "ARMY" | "GUARD";
}

export interface BattleCardState {
  deck: number[];           // shared draw pile (values 1-5)
  hands: Record<string, number[]>; // playerId → cards in hand
  discard: number[];        // discard pile ("бито")
}

export interface CombatResult {
  winnerId: string;
  loserId: string;
  winnerCard: number;
  loserCard: number;
  reason: string; // "guess" | "proximity" | "both_guess"
  loserUnitDestroyed: boolean;
  converted?: boolean; // Шент'Ар conversion
}

export interface VelderanGameState {
  round: number;
  currentPlayerIndex: number;
  phase: "PLACEMENT" | "MOVE" | "COMBAT" | "GOD_SUMMON" | "GAME_OVER";
  units: GameUnit[];
  combat?: CombatState;
  lastCombatResult?: CombatResult;
  lastGodResult?: GodResult;
  battleCards?: BattleCardState;
  log: string[];
  turnOrder: string[]; // array of GamePlayer.id in turn order
  eliminatedPlayers: string[]; // GamePlayer.ids
  winner?: string; // GamePlayer.id
  reserve: Record<string, number>; // playerId → army count in reserve (legacy, kept for compat)
  inventory: Record<string, InventoryUnit[]>; // playerId → unplaced units
  cityOwners: Record<string, string>; // nodeId → playerId (captured cities)
  // ─── Этап 4-5: спецлокации + правила ───
  specialLocations?: Record<string, SpecialLocationState>; // nodeId → state
  godSummonCounts?: Record<string, Record<string, number>>; // unitId → { shrineId → count }
  godCards?: Record<string, GodCard[]>; // playerId → god cards in hand
  smugglerQueue?: SmugglerQueueEntry[]; // units queued for teleport
  skipTurnPlayers?: string[]; // players who skip their next turn (Ситас)
  divineProtection?: Record<string, number>; // playerId → count of Гиордг protections
  shentarActive?: Record<string, number>; // playerId → count of Шент'Ар conversions
}

const GODS: Record<number, { name: string; effect: string }> = {
  2: { name: "Джалайна", effect: "Воскрешает любой ваш отряд в любой точке карты" },
  3: { name: "Авалайс", effect: "Утопить любую армию противника на морских путях" },
  4: { name: "Стратос", effect: "Уничтожает ваш отряд на этом святилище" },
  5: { name: "Ситас", effect: "Пропустить ход любому игроку" },
  6: { name: "Шент'Ар", effect: "При победе побеждённый отряд становится союзным" },
  7: { name: "Гиордг", effect: "Божественная защита: при проигрыше переигровка" },
  8: { name: "Сихварис", effect: "Переносит ваш отряд в любую точку карты" },
  9: { name: "Вьеронх", effect: "Перенести армию соперника в любую точку карты" },
  10: { name: "Ангелона", effect: "Призывает к святилищу 2 вражеских отряда" },
  11: { name: "Антегриз", effect: "Уничтожить любой вражеский отряд на суше" },
  12: { name: "Выбор", effect: "Вы выбираете любое божество в помощь" },
};

const TOTAL_ARMIES = 8;
const TOTAL_GUARDS = 3;

/** Shuffle array in place (Fisher-Yates) */
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Create a deck of 100 battle cards: 20 each of values 1-5 */
function createDeck(): number[] {
  const deck: number[] = [];
  for (let v = 1; v <= 5; v++) {
    for (let i = 0; i < 20; i++) deck.push(v);
  }
  return shuffle(deck);
}

/** Draw N cards from deck; if deck is empty, reshuffle discard into deck */
function drawCards(bc: BattleCardState, count: number): number[] {
  const drawn: number[] = [];
  for (let i = 0; i < count; i++) {
    if (bc.deck.length === 0) {
      if (bc.discard.length === 0) break;
      bc.deck = shuffle([...bc.discard]);
      bc.discard = [];
    }
    drawn.push(bc.deck.pop()!);
  }
  return drawn;
}

export function createInitialState(
  players: { id: string; faction: string; turnOrder: number }[]
): VelderanGameState {
  const sorted = [...players].sort((a, b) => a.turnOrder - b.turnOrder);
  const units: GameUnit[] = [];
  const inventory: Record<string, InventoryUnit[]> = {};
  let unitCounter = 0;

  // Initialize city ownership
  const cityOwners: Record<string, string> = {};
  for (const player of sorted) {
    const factionCities = getActiveNodes().filter(
      (n) => n.type === "city" && n.faction === player.faction
    );
    for (const city of factionCities) {
      cityOwners[city.id] = player.id;
    }
  }

  // Each player gets 8 armies + 3 guards total
  // All start in inventory — player places them during PLACEMENT phase
  for (const player of sorted) {
    const inv: InventoryUnit[] = [];
    for (let i = 0; i < TOTAL_ARMIES; i++) {
      inv.push({ id: `u${unitCounter++}`, type: "ARMY" });
    }
    for (let i = 0; i < TOTAL_GUARDS; i++) {
      inv.push({ id: `u${unitCounter++}`, type: "GUARD" });
    }
    inventory[player.id] = inv;
  }

  const reserve: Record<string, number> = {};
  for (const player of sorted) {
    reserve[player.id] = 0;
  }

  // Random turn order
  const randomOrder = shuffle(sorted.map((p) => p.id));

  // Create battle cards deck and deal 5 to each player
  const deck = createDeck();
  const bc: BattleCardState = { deck, hands: {}, discard: [] };
  for (const pid of randomOrder) {
    bc.hands[pid] = drawCards(bc, 5);
  }

  return {
    round: 1,
    currentPlayerIndex: 0,
    phase: "PLACEMENT",
    units,
    battleCards: bc,
    log: ["Игра началась! Расставьте фишки из инвентаря на свои города (по 1 на город)."],
    turnOrder: randomOrder,
    eliminatedPlayers: [],
    reserve,
    inventory,
    cityOwners,
  };
}

export function getCurrentPlayerId(state: VelderanGameState): string {
  return state.turnOrder[state.currentPlayerIndex];
}

export function getPlayerUnits(state: VelderanGameState, playerId: string): GameUnit[] {
  return state.units.filter((u) => u.playerId === playerId);
}

export function placeFromInventory(
  state: VelderanGameState,
  playerId: string,
  cityNodeId: string,
  inventoryUnitId: string,
  playerNames: Record<string, string>
): VelderanGameState {
  const newState = structuredClone(state);
  if (!newState.inventory) newState.inventory = {};
  const inv = newState.inventory[playerId] || [];
  const invIdx = inv.findIndex((u) => u.id === inventoryUnitId);
  if (invIdx < 0) return newState;

  const node = getActiveNodes().find((n) => n.id === cityNodeId);
  if (!node || node.type !== "city") return newState;

  // Can only place on own cities
  if (newState.cityOwners[cityNodeId] !== playerId) return newState;

  const unitsAtNode = newState.units.filter(
    (u) => u.position === cityNodeId && u.playerId === playerId
  );

  // Round 1: max 1 unit per city
  if (newState.round === 1 && unitsAtNode.length >= 1) return newState;
  // Round 2+: max 2 units per city
  if (newState.round > 1 && unitsAtNode.length >= 2) return newState;

  const invUnit = inv[invIdx];
  newState.units.push({
    id: invUnit.id,
    playerId,
    type: invUnit.type,
    position: cityNodeId,
    movesLeft: invUnit.type === "ARMY" ? 2 : 1,
  });
  newState.inventory[playerId] = inv.filter((_, i) => i !== invIdx);

  const playerName = playerNames[playerId] || "Игрок";
  const typeName = invUnit.type === "GUARD" ? "Гвардию" : "Отряд";
  newState.log.push(`${playerName} поставил ${typeName} в ${node.name}.`);

  return newState;
}

/** Undo a placement — move a unit from the map back to inventory */
export function undoPlacement(
  state: VelderanGameState,
  playerId: string,
  unitId: string,
  playerNames: Record<string, string>
): VelderanGameState {
  if (state.phase !== "PLACEMENT") return state;
  const newState = structuredClone(state);
  const unitIdx = newState.units.findIndex(
    (u) => u.id === unitId && u.playerId === playerId
  );
  if (unitIdx < 0) return newState;

  const unit = newState.units[unitIdx];
  if (!newState.inventory) newState.inventory = {};
  if (!newState.inventory[playerId]) newState.inventory[playerId] = [];
  newState.inventory[playerId].push({ id: unit.id, type: unit.type });
  newState.units.splice(unitIdx, 1);

  const playerName = playerNames[playerId] || "Игрок";
  const typeName = unit.type === "GUARD" ? "Гвардию" : "Отряд";
  newState.log.push(`${playerName} убрал ${typeName} обратно в инвентарь.`);

  return newState;
}

/** Legacy placeReserve — now places from inventory */
export function placeReserve(
  state: VelderanGameState,
  playerId: string,
  cityNodeId: string,
  playerNames: Record<string, string>
): VelderanGameState {
  const newState = structuredClone(state);
  if (!newState.inventory) newState.inventory = {};
  const inv = newState.inventory[playerId] || [];

  // Try to place first available army from inventory
  const armyIdx = inv.findIndex((u) => u.type === "ARMY");
  if (armyIdx < 0) {
    // Fallback: use reserve counter (legacy)
    const reserve = newState.reserve[playerId] || 0;
    if (reserve <= 0) return newState;

    const node = getActiveNodes().find((n) => n.id === cityNodeId);
    if (!node || node.type !== "city") return newState;
    if (newState.cityOwners[cityNodeId] !== playerId) return newState;

    const unitsAtNode = newState.units.filter(
      (u) => u.position === cityNodeId && u.playerId === playerId
    );
    if (newState.round === 1 && unitsAtNode.length >= 1) return newState;
    if (newState.round > 1 && unitsAtNode.length >= 2) return newState;

    const maxId = newState.units.reduce((max, u) => {
      const num = parseInt(u.id.replace("u", "")) || 0;
      return Math.max(max, num);
    }, 0);
    newState.units.push({
      id: `u${maxId + 1}`,
      playerId,
      type: "ARMY",
      position: cityNodeId,
      movesLeft: 2,
    });
    newState.reserve[playerId] = reserve - 1;
    const playerName = playerNames[playerId] || "Игрок";
    newState.log.push(`${playerName} выставил отряд из резерва в ${node.name}.`);
    return newState;
  }

  return placeFromInventory(newState, playerId, cityNodeId, inv[armyIdx].id, playerNames);
}

function hasPlaceableUnits(state: VelderanGameState, playerId: string): boolean {
  if (!state.inventory) return (state.reserve[playerId] || 0) > 0;
  const inv = state.inventory[playerId] || [];
  if (inv.length === 0 && (state.reserve[playerId] || 0) === 0) return false;

  // Check if there are any city slots available
  const maxPerCity = state.round === 1 ? 1 : 2;
  const ownCities = Object.entries(state.cityOwners || {})
    .filter(([, owner]) => owner === playerId)
    .map(([nodeId]) => nodeId);

  for (const cityId of ownCities) {
    const unitsAtCity = state.units.filter(
      (u) => u.position === cityId && u.playerId === playerId
    );
    if (unitsAtCity.length < maxPerCity) return true;
  }

  return false;
}

export function finishPlacement(
  state: VelderanGameState,
  playerNames: Record<string, string>
): VelderanGameState {
  const newState = structuredClone(state);

  // Move to next player for placement or move to MOVE phase
  let nextIdx = newState.currentPlayerIndex;
  let allPlaced = true;

  // Check if any subsequent player still has placeable units
  for (let i = 0; i < newState.turnOrder.length; i++) {
    const idx = (newState.currentPlayerIndex + 1 + i) % newState.turnOrder.length;
    const pid = newState.turnOrder[idx];
    if (newState.eliminatedPlayers.includes(pid)) continue;
    if (hasPlaceableUnits(newState, pid)) {
      nextIdx = idx;
      allPlaced = false;
      break;
    }
  }

  const currentId = getCurrentPlayerId(newState);
  if (allPlaced || !hasPlaceableUnits(newState, currentId)) {
    // Check if any active player can still place
    const anyCanPlace = newState.turnOrder.some(
      (pid) => !newState.eliminatedPlayers.includes(pid) && hasPlaceableUnits(newState, pid)
    );
    if (!anyCanPlace) {
      newState.phase = "MOVE";
      newState.currentPlayerIndex = 0;
      // Skip eliminated
      while (newState.eliminatedPlayers.includes(newState.turnOrder[newState.currentPlayerIndex])) {
        newState.currentPlayerIndex = (newState.currentPlayerIndex + 1) % newState.turnOrder.length;
      }
      const nextName = playerNames[newState.turnOrder[newState.currentPlayerIndex]] || "Игрок";
      newState.log.push(`Фаза расстановки завершена. Ход ${nextName}.`);
      return newState;
    }
  }

  newState.currentPlayerIndex = nextIdx;
  const nextName = playerNames[newState.turnOrder[nextIdx]] || "Игрок";
  newState.log.push(`Расстановка: ход ${nextName}.`);
  return newState;
}

export function canMoveUnit(state: VelderanGameState, unitId: string, targetNodeId: string): boolean {
  const unit = state.units.find((u) => u.id === unitId);
  if (!unit || unit.movesLeft <= 0) return false;

  // Cannot leave Ghost Temple
  const fromNode = getActiveNodes().find((n) => n.id === unit.position);
  if (fromNode?.type === "ghost") return false;

  const neighbors = getNeighbors(unit.position);
  if (!neighbors.includes(targetNodeId)) return false;

  // Only guards can enter shrines
  const targetNode = getActiveNodes().find((n) => n.id === targetNodeId);
  if (targetNode?.type === "shrine" && unit.type !== "GUARD") return false;

  // Max 2 same-player units per node
  const unitsAtTarget = state.units.filter(
    (u) => u.position === targetNodeId && u.playerId === unit.playerId
  );
  if (unitsAtTarget.length >= 2) return false;

  return true;
}

export function moveUnit(
  state: VelderanGameState,
  unitId: string,
  targetNodeId: string,
  playerNames: Record<string, string>
): VelderanGameState {
  const newState = structuredClone(state);
  const unit = newState.units.find((u) => u.id === unitId);
  if (!unit) return newState;

  const fromNode = getActiveNodes().find((n) => n.id === unit.position);
  const toNode = getActiveNodes().find((n) => n.id === targetNodeId);
  unit.position = targetNodeId;
  unit.movesLeft--;

  const playerName = playerNames[unit.playerId] || "Игрок";
  newState.log.push(
    `${playerName}: ${unit.type === "GUARD" ? "Гвардия" : "Отряд"} ${fromNode?.name || ""} → ${toNode?.name || ""}`
  );

  // Check for enemy units at target — trigger combat
  const enemies = newState.units.filter(
    (u) => u.position === targetNodeId && u.playerId !== unit.playerId
  );
  if (enemies.length > 0) {
    newState.phase = "COMBAT";
    newState.combat = {
      attackerUnitId: unit.id,
      defenderUnitId: enemies[0].id,
      attackerPlayerId: unit.playerId,
      defenderPlayerId: enemies[0].playerId,
      nodeId: targetNodeId,
    };
    newState.log.push(`Сражение на ${toNode?.name || targetNodeId}!`);
  }

  // Capture city if undefended enemy city
  if (toNode?.type === "city" && !newState.combat) {
    const currentOwner = newState.cityOwners[targetNodeId];
    if (currentOwner && currentOwner !== unit.playerId) {
      newState.cityOwners[targetNodeId] = unit.playerId;
      const prevOwnerName = playerNames[currentOwner] || "Противник";
      newState.log.push(`${playerName} захватил город ${toNode.name} у ${prevOwnerName}!`);
    } else if (!currentOwner) {
      newState.cityOwners[targetNodeId] = unit.playerId;
      newState.log.push(`${playerName} занял нейтральный город ${toNode.name}.`);
    }
  }

  // Check if moved onto shrine with guard
  if (toNode?.type === "shrine" && unit.type === "GUARD" && !newState.combat) {
    newState.phase = "GOD_SUMMON";
    newState.log.push(`Гвардия на святилище ${toNode.name} — бросьте кубики!`);
  }

  // ─── Special location control ───
  if (toNode && ["pirate", "ghost", "camp", "smuggler"].includes(toNode.type) && !newState.combat) {
    if (!newState.specialLocations) newState.specialLocations = {};
    const usesCount = toNode.type === "smuggler" ? 1 : 2;
    newState.specialLocations[toNode.id] = {
      controllerId: unit.playerId,
      usesLeft: usesCount,
    };
    const locNames: Record<string, string> = {
      pirate: "Пиратскую бухту",
      ghost: "Призрачный храм",
      camp: "Лагерь наёмников",
      smuggler: "Логово контрабандистов",
    };
    newState.log.push(`${playerName} занял ${locNames[toNode.type]}!`);
  }

  return newState;
}

/** Check if a node requires dice to enter (Sands of Sikhvaris / Fortress of Giordta) */
function isDiceGateNode(nodeId: string): "even" | "odd" | null {
  const node = getActiveNodes().find((n) => n.id === nodeId);
  if (!node) return null;
  const nameLower = (node.name || "").toLowerCase();
  if (nameLower.includes("сихварис") || nameLower.includes("sikhvaris") || nameLower.includes("пески")) return "even";
  if (nameLower.includes("гиордт") || nameLower.includes("giordta") || nameLower.includes("твердь")) return "odd";
  return null;
}

/** Attempt dice-gated move: returns new state or null if blocked */
export function tryDiceGateMove(
  state: VelderanGameState,
  unitId: string,
  targetNodeId: string,
  playerNames: Record<string, string>
): { state: VelderanGameState; success: boolean } {
  const newState = structuredClone(state);
  const gate = isDiceGateNode(targetNodeId);
  if (!gate) return { state: moveUnit(state, unitId, targetNodeId, playerNames), success: true };

  const unit = newState.units.find((u) => u.id === unitId);
  if (!unit) return { state: newState, success: false };

  const d = Math.floor(Math.random() * 6) + 1;
  const pass = gate === "even" ? d % 2 === 0 : d % 2 !== 0;
  const playerName = playerNames[unit.playerId] || "Игрок";
  const targetNode = getActiveNodes().find((n) => n.id === targetNodeId);

  if (pass) {
    newState.log.push(`${playerName} бросил ${d} — проход в ${targetNode?.name || targetNodeId} разрешён!`);
    return { state: moveUnit(state, unitId, targetNodeId, playerNames), success: true };
  } else {
    unit.movesLeft = Math.max(0, unit.movesLeft - 1);
    newState.log.push(`${playerName} бросил ${d} — проход в ${targetNode?.name || targetNodeId} закрыт! Отряд остаётся.`);
    return { state: newState, success: false };
  }
}

/** Initiate remote combat from a special location (pirate/ghost/camp) */
export function specialAttack(
  state: VelderanGameState,
  playerId: string,
  locationNodeId: string,
  targetUnitId: string,
  playerNames: Record<string, string>
): VelderanGameState {
  const newState = structuredClone(state);
  if (!newState.specialLocations) return newState;
  const loc = newState.specialLocations[locationNodeId];
  if (!loc || loc.controllerId !== playerId || loc.usesLeft <= 0) return newState;

  const locationNode = getActiveNodes().find((n) => n.id === locationNodeId);
  if (!locationNode) return newState;

  const targetUnit = newState.units.find((u) => u.id === targetUnitId && u.playerId !== playerId);
  if (!targetUnit) return newState;

  const targetNode = getActiveNodes().find((n) => n.id === targetUnit.position);

  // Validate targets based on location type
  if (locationNode.type === "pirate") {
    // Pirates can attack units on sea/port nodes only
    if (!targetNode || !["port", "windrose"].includes(targetNode.type)) return newState;
  } else if (locationNode.type === "ghost") {
    // Ghosts can attack anyone except on shrines
    if (targetNode?.type === "shrine") return newState;
  } else if (locationNode.type === "camp") {
    // Camp can attack on land only, not shrines
    if (!targetNode || ["windrose", "port", "shrine"].includes(targetNode.type)) return newState;
  } else {
    return newState;
  }

  // Find attacker unit on this location
  const attackerUnit = newState.units.find(
    (u) => u.position === locationNodeId && u.playerId === playerId
  );
  if (!attackerUnit) return newState;

  loc.usesLeft--;

  const playerName = playerNames[playerId] || "Игрок";
  const targetName = playerNames[targetUnit.playerId] || "Противник";
  const locNames: Record<string, string> = {
    pirate: "пиратов", ghost: "призраков", camp: "наёмников",
  };

  newState.phase = "COMBAT";
  newState.combat = {
    attackerUnitId: attackerUnit.id,
    defenderUnitId: targetUnit.id,
    attackerPlayerId: playerId,
    defenderPlayerId: targetUnit.playerId,
    nodeId: targetUnit.position,
    specialType: locationNode.type as "pirate" | "ghost" | "camp",
    attackerUseDeck: true,
    safeLoser: playerId, // attacker doesn't lose unit on defeat
  };

  newState.log.push(`${playerName} атакует ${targetName} силой ${locNames[locationNode.type]}!`);

  // Check if uses exhausted
  if (loc.usesLeft <= 0) {
    if (locationNode.type === "ghost") {
      newState.log.push(`Дань смерти: после исчерпания карт отряд в Призрачном храме погибнет.`);
    }
  }

  return newState;
}

/** Smuggler teleport: queue unit for teleport to a port (arrives next round) */
export function smugglerTeleport(
  state: VelderanGameState,
  playerId: string,
  locationNodeId: string,
  targetPortId: string,
  playerNames: Record<string, string>
): VelderanGameState {
  const newState = structuredClone(state);
  if (!newState.specialLocations) return newState;
  const loc = newState.specialLocations[locationNodeId];
  if (!loc || loc.controllerId !== playerId || loc.usesLeft <= 0) return newState;

  const targetPort = getActiveNodes().find((n) => n.id === targetPortId && n.type === "port");
  if (!targetPort) return newState;

  const unit = newState.units.find(
    (u) => u.position === locationNodeId && u.playerId === playerId
  );
  if (!unit) return newState;

  // Remove unit from map, add to queue
  newState.units = newState.units.filter((u) => u.id !== unit.id);
  if (!newState.smugglerQueue) newState.smugglerQueue = [];
  newState.smugglerQueue.push({
    playerId,
    unitId: unit.id,
    targetPortId,
    roundQueued: newState.round,
  });

  loc.usesLeft--;
  const playerName = playerNames[playerId] || "Игрок";
  newState.log.push(`${playerName} отправил отряд контрабандистами в порт ${targetPort.name}. Прибудет в следующем раунде.`);

  return newState;
}

/** Process smuggler arrivals at round start */
function processSmuglerArrivals(state: VelderanGameState, playerNames: Record<string, string>): VelderanGameState {
  if (!state.smugglerQueue || state.smugglerQueue.length === 0) return state;

  const arrivals = state.smugglerQueue.filter((q) => q.roundQueued < state.round);
  const remaining = state.smugglerQueue.filter((q) => q.roundQueued >= state.round);
  state.smugglerQueue = remaining;

  let maxId = state.units.reduce((max, u) => Math.max(max, parseInt(u.id.replace("u", "")) || 0), 0);

  for (const arrival of arrivals) {
    maxId++;
    state.units.push({
      id: `u${maxId}`,
      playerId: arrival.playerId,
      type: "ARMY",
      position: arrival.targetPortId,
      movesLeft: 2,
    });
    const port = getActiveNodes().find((n) => n.id === arrival.targetPortId);
    const playerName = playerNames[arrival.playerId] || "Игрок";
    state.log.push(`${playerName}: отряд контрабандистов прибыл в ${port?.name || arrival.targetPortId}!`);
  }

  return state;
}

/** Play a god card from inventory */
export function playGodCard(
  state: VelderanGameState,
  playerId: string,
  cardIndex: number,
  targetUnitId: string | undefined,
  playerNames: Record<string, string>
): VelderanGameState {
  const newState = structuredClone(state);
  if (!newState.godCards) return newState;
  const cards = newState.godCards[playerId] || [];
  if (cardIndex < 0 || cardIndex >= cards.length) return newState;

  const card = cards[cardIndex];
  const playerName = playerNames[playerId] || "Игрок";

  // Remove card
  cards.splice(cardIndex, 1);
  newState.godCards[playerId] = cards;

  switch (card.godId) {
    case 3: {
      // Avalais — drown enemy on sea
      if (!targetUnitId) break;
      const target = newState.units.find((u) => u.id === targetUnitId && u.playerId !== playerId);
      if (!target) break;
      const tNode = getActiveNodes().find((n) => n.id === target.position);
      if (!tNode || !["port", "windrose"].includes(tNode.type)) break;
      newState.units = newState.units.filter((u) => u.id !== targetUnitId);
      newState.log.push(`${playerName} использовал карту Авалайс — утопил отряд на ${tNode.name}!`);
      break;
    }
    case 5: {
      // Sitas — skip enemy turn
      if (!targetUnitId) break;
      const skipId = targetUnitId;
      if (!newState.skipTurnPlayers) newState.skipTurnPlayers = [];
      if (!newState.skipTurnPlayers.includes(skipId)) {
        newState.skipTurnPlayers.push(skipId);
      }
      newState.log.push(`${playerName} использовал карту Ситас — ${playerNames[skipId] || "Игрок"} пропускает ход!`);
      break;
    }
    case 6: {
      // Shent'Ar — activate conversion: next combat win converts enemy unit
      if (!newState.shentarActive) newState.shentarActive = {};
      newState.shentarActive[playerId] = (newState.shentarActive[playerId] || 0) + 1;
      newState.log.push(`${playerName} использовал карту Шент'Ар — при следующей победе вражеский отряд станет союзным!`);
      break;
    }
    case 7: {
      // Giordg — divine protection: re-battle on loss
      if (!newState.divineProtection) newState.divineProtection = {};
      newState.divineProtection[playerId] = (newState.divineProtection[playerId] || 0) + 1;
      newState.log.push(`${playerName} использовал карту Гиордг — божественная защита: при проигрыше будет переигровка!`);
      break;
    }
    case 8: {
      // Sikhvaris — teleport own unit to any non-shrine
      if (!targetUnitId) break;
      const ownUnit = newState.units.find((u) => u.id === targetUnitId && u.playerId === playerId);
      if (!ownUnit) break;
      const destNodes = getActiveNodes().filter((n) => n.type !== "shrine");
      if (destNodes.length > 0) {
        const rndNode = destNodes[Math.floor(Math.random() * destNodes.length)];
        ownUnit.position = rndNode.id;
        newState.log.push(`${playerName} использовал карту Сихварис — перенёс свой отряд в ${rndNode.name}!`);
      }
      break;
    }
    case 9: {
      // Vieronh — teleport enemy unit
      if (!targetUnitId) break;
      const target2 = newState.units.find((u) => u.id === targetUnitId && u.playerId !== playerId);
      if (!target2) break;
      // Move to random non-shrine node
      const nodes = getActiveNodes().filter((n) => n.type !== "shrine");
      if (nodes.length > 0) {
        const rnd = nodes[Math.floor(Math.random() * nodes.length)];
        target2.position = rnd.id;
        newState.log.push(`${playerName} использовал карту Вьеронх — перенёс вражеский отряд в ${rnd.name}!`);
      }
      break;
    }
  }

  checkElimination(newState, playerNames);
  return newState;
}

export function rollDiceForGod(
  state: VelderanGameState,
  playerId: string,
  shrineId: string,
  playerNames: Record<string, string>
): VelderanGameState {
  const newState = structuredClone(state);

  // Find the guard on this shrine
  const guard = newState.units.find(
    (u) => u.playerId === playerId && u.type === "GUARD" && u.position === shrineId
  );
  const guardId = guard?.id || "";

  // Track god summon count (max 2 per guard per shrine, 3rd = death)
  if (!newState.godSummonCounts) newState.godSummonCounts = {};
  if (!newState.godSummonCounts[guardId]) newState.godSummonCounts[guardId] = {};
  const prevCount = newState.godSummonCounts[guardId][shrineId] || 0;
  newState.godSummonCounts[guardId][shrineId] = prevCount + 1;
  const currentCount = prevCount + 1;

  const d1 = Math.floor(Math.random() * 6) + 1;
  const d2 = Math.floor(Math.random() * 6) + 1;
  const total = d1 + d2;
  const god = GODS[total];
  const playerName = playerNames[playerId] || "Игрок";

  newState.lastGodResult = {
    roll: [d1, d2],
    total,
    godName: god.name,
    effect: god.effect,
    playerId,
    shrineId,
  };

  newState.log.push(`${playerName} бросил ${d1}+${d2}=${total} — ${god.name}: ${god.effect}`);

  // Initialize god cards if needed
  if (!newState.godCards) newState.godCards = {};
  if (!newState.godCards[playerId]) newState.godCards[playerId] = [];

  // Apply god effects
  if (total === 2) {
    // Dzhalayna — resurrect own unit
    newState.log.push(`Джалайна: можно воскресить отряд в следующем раунде.`);
    // Auto: add 1 army to inventory
    if (!newState.inventory[playerId]) newState.inventory[playerId] = [];
    const maxId = newState.units.reduce((max, u) => Math.max(max, parseInt(u.id.replace("u", "")) || 0), 0);
    newState.inventory[playerId].push({ id: `u${maxId + 1}`, type: "ARMY" });
    newState.log.push(`${playerName} получил воскрешённый отряд в инвентарь.`);
  } else if (total === 3) {
    // Avalais — god card (drown sea unit)
    newState.godCards[playerId].push({ godId: 3, godName: "Авалайс" });
    newState.log.push(`${playerName} получил карту Авалайс.`);
  } else if (total === 4) {
    // Stratos — destroy own unit on shrine
    if (guard) {
      newState.units = newState.units.filter((u) => u.id !== guard.id);
      newState.log.push(`Стратос уничтожил гвардию ${playerName} на святилище!`);
    }
  } else if (total === 5) {
    // Sitas — god card (skip turn)
    newState.godCards[playerId].push({ godId: 5, godName: "Ситас" });
    newState.log.push(`${playerName} получил карту Ситас.`);
  } else if (total === 6) {
    // Shent'Ar — 2 god cards (convert defeated enemy)
    newState.godCards[playerId].push({ godId: 6, godName: "Шент'Ар" });
    newState.godCards[playerId].push({ godId: 6, godName: "Шент'Ар" });
    newState.log.push(`${playerName} получил 2 карты Шент'Ар.`);
  } else if (total === 7) {
    // Giordg — 2 god cards (divine protection)
    newState.godCards[playerId].push({ godId: 7, godName: "Гиордг" });
    newState.godCards[playerId].push({ godId: 7, godName: "Гиордг" });
    newState.log.push(`${playerName} получил 2 карты Гиордг.`);
  } else if (total === 8) {
    // Sikhvaris — give a god card to teleport own unit
    newState.godCards[playerId].push({ godId: 8, godName: "Сихварис" });
    newState.log.push(`${playerName} получил карту Сихварис — перенос своего отряда.`);
  } else if (total === 9) {
    // Vieronh — god card (teleport enemy)
    newState.godCards[playerId].push({ godId: 9, godName: "Вьеронх" });
    newState.log.push(`${playerName} получил карту Вьеронх.`);
  } else if (total === 10) {
    // Angelona — summon 2 enemy units to this shrine
    const enemies = newState.units.filter(
      (u) => u.playerId !== playerId
    );
    const toSummon = enemies.slice(0, Math.min(2, enemies.length));
    for (const e of toSummon) {
      e.position = shrineId;
      const eName = playerNames[e.playerId] || "Противник";
      newState.log.push(`Ангелона призвала отряд ${eName} к святилищу!`);
    }
  } else if (total === 11) {
    // Antegriz — destroy enemy army on land
    const landTypes = ["city", "battle", "camp", "pirate", "ghost", "smuggler"];
    const enemyArmies = newState.units.filter((u) => {
      if (u.playerId === playerId) return false;
      const node = getActiveNodes().find((n) => n.id === u.position);
      return node && landTypes.includes(node.type);
    });
    if (enemyArmies.length > 0) {
      const target = enemyArmies[Math.floor(Math.random() * enemyArmies.length)];
      const targetName = playerNames[target.playerId] || "Противник";
      const node = getActiveNodes().find((n) => n.id === target.position);
      newState.units = newState.units.filter((u) => u.id !== target.id);
      newState.log.push(`Антегриз уничтожил отряд ${targetName} в ${node?.name || ""}!`);
    }
  } else if (total === 12) {
    // Choice — player gets one god card of each type to choose from
    newState.log.push(`Выпало 12 — выбор любого божества! Выберите карту из полученных.`);
    const choiceGods = [
      { godId: 3, godName: "Авалайс" },
      { godId: 5, godName: "Ситас" },
      { godId: 6, godName: "Шент'Ар" },
      { godId: 7, godName: "Гиордг" },
      { godId: 8, godName: "Сихварис" },
      { godId: 9, godName: "Вьеронх" },
    ];
    for (const g of choiceGods) {
      newState.godCards[playerId].push(g);
    }
  }

  // 3rd summon on same shrine = guard dies
  if (currentCount >= 3 && guard) {
    const stillAlive = newState.units.find((u) => u.id === guard.id);
    if (stillAlive) {
      newState.units = newState.units.filter((u) => u.id !== guard.id);
      newState.log.push(`Третий призыв на этом святилище — гвардия ${playerName} погибла!`);
    }
  }

  checkElimination(newState, playerNames);
  newState.phase = "MOVE";
  return newState;
}

/** Check for eliminated players and game over */
function checkElimination(state: VelderanGameState, playerNames: Record<string, string>) {
  for (const pid of state.turnOrder) {
    if (state.eliminatedPlayers.includes(pid)) continue;
    const remaining = state.units.filter((u) => u.playerId === pid);
    const invRemaining = state.inventory?.[pid]?.length || 0;
    if (remaining.length === 0 && invRemaining === 0) {
      state.eliminatedPlayers.push(pid);
      const name = playerNames[pid] || "Игрок";
      state.log.push(`${name} выбыл из игры!`);
    }
  }

  const activePlayers = state.turnOrder.filter(
    (pid) => !state.eliminatedPlayers.includes(pid)
  );
  if (activePlayers.length <= 1 && activePlayers.length > 0) {
    state.winner = activePlayers[0];
    state.phase = "GAME_OVER";
    state.log.push(`Победа! Игра окончена.`);
  }
}

/** Check if a unit can leave ghost temple */
export function canLeaveNode(state: VelderanGameState, unitId: string): boolean {
  const unit = state.units.find((u) => u.id === unitId);
  if (!unit) return false;
  const node = getActiveNodes().find((n) => n.id === unit.position);
  if (!node) return true;
  // Cannot leave Ghost Temple
  if (node.type === "ghost") return false;
  return true;
}

/** Play a combat card from hand (one side at a time) */
export function playCombatCard(
  state: VelderanGameState,
  playerId: string,
  card: number,
  guess: number,
): VelderanGameState {
  const newState = structuredClone(state);
  if (!newState.combat || !newState.battleCards) return newState;

  const { attackerPlayerId, defenderPlayerId } = newState.combat;
  const isAttacker = playerId === attackerPlayerId;
  const isDefender = playerId === defenderPlayerId;
  if (!isAttacker && !isDefender) return newState;

  // Deck-based card (special combat: pirate/ghost/camp)
  const useDeck = (isAttacker && newState.combat.attackerUseDeck) ||
                  (isDefender && newState.combat.defenderUseDeck);

  if (useDeck) {
    // Draw from deck instead of using hand card
    const drawn = drawCards(newState.battleCards, 1);
    const deckCard = drawn.length > 0 ? drawn[0] : Math.floor(Math.random() * 5) + 1;
    if (isAttacker) {
      newState.combat.attackerCard = deckCard;
      newState.combat.attackerGuess = guess;
    } else {
      newState.combat.defenderCard = deckCard;
      newState.combat.defenderGuess = guess;
    }
  } else {
    // Remove card from hand
    const hand = newState.battleCards.hands[playerId] || [];
    const cardIdx = hand.indexOf(card);
    if (cardIdx < 0) return newState; // card not in hand
    hand.splice(cardIdx, 1);
    newState.battleCards.hands[playerId] = hand;

    if (isAttacker) {
      newState.combat.attackerCard = card;
      newState.combat.attackerGuess = guess;
    } else {
      newState.combat.defenderCard = card;
      newState.combat.defenderGuess = guess;
    }
  }

  // If both have played, resolve
  if (newState.combat.attackerCard != null && newState.combat.defenderCard != null) {
    return resolveCombat(newState);
  }

  return newState;
}

function resolveCombat(
  newState: VelderanGameState,
): VelderanGameState {
  if (!newState.combat) return newState;

  const {
    attackerUnitId, defenderUnitId, attackerPlayerId, defenderPlayerId,
    nodeId, attackerCard, defenderCard, attackerGuess, defenderGuess,
  } = newState.combat;
  if (attackerCard == null || defenderCard == null || attackerGuess == null || defenderGuess == null) return newState;

  const node = getActiveNodes().find((n) => n.id === nodeId);

  // Discard played cards
  if (newState.battleCards) {
    newState.battleCards.discard.push(attackerCard, defenderCard);
  }

  // Exact guess wins
  const attackerGuessedRight = attackerGuess === defenderCard;
  const defenderGuessedRight = defenderGuess === attackerCard;

  let winnerId: string | null = null;
  let loserId: string | null = null;

  if (attackerGuessedRight && !defenderGuessedRight) {
    winnerId = attackerPlayerId;
    loserId = defenderPlayerId;
    newState.log.push(`Атакующий угадал карту ${defenderCard}! Победа.`);
  } else if (defenderGuessedRight && !attackerGuessedRight) {
    winnerId = defenderPlayerId;
    loserId = attackerPlayerId;
    newState.log.push(`Защитник угадал карту ${attackerCard}! Победа.`);
  } else if (attackerGuessedRight && defenderGuessedRight) {
    if (attackerCard > defenderCard) {
      winnerId = attackerPlayerId;
      loserId = defenderPlayerId;
    } else if (defenderCard > attackerCard) {
      winnerId = defenderPlayerId;
      loserId = attackerPlayerId;
    }
    newState.log.push(`Оба угадали! Карта ${attackerCard} vs ${defenderCard}.`);
  } else {
    // Neither guessed exactly — check proximity rule
    const attackerNear = Math.abs(attackerGuess - defenderCard) <= 1;
    const defenderNear = Math.abs(defenderGuess - attackerCard) <= 1;

    if (attackerCard > defenderCard && attackerNear) {
      winnerId = attackerPlayerId;
      loserId = defenderPlayerId;
      newState.log.push(`Карта ${attackerCard} > ${defenderCard} (±1). Победа атакующего.`);
    } else if (defenderCard > attackerCard && defenderNear) {
      winnerId = defenderPlayerId;
      loserId = attackerPlayerId;
      newState.log.push(`Карта ${defenderCard} > ${attackerCard} (±1). Победа защитника.`);
    } else {
      // Draw — replay (keep combat but reset cards)
      newState.log.push(`Ничья (${attackerCard} vs ${defenderCard}). Переигровка!`);
      newState.combat.attackerCard = undefined;
      newState.combat.defenderCard = undefined;
      newState.combat.attackerGuess = undefined;
      newState.combat.defenderGuess = undefined;
      // Draw replacement cards
      if (newState.battleCards) {
        const atkNew = drawCards(newState.battleCards, 1);
        const defNew = drawCards(newState.battleCards, 1);
        if (atkNew.length > 0) newState.battleCards.hands[attackerPlayerId].push(...atkNew);
        if (defNew.length > 0) newState.battleCards.hands[defenderPlayerId].push(...defNew);
      }
      return newState;
    }
  }

  if (loserId && winnerId) {
    const loserUnitId = loserId === attackerPlayerId ? attackerUnitId : defenderUnitId;

    // Check Гиордг divine protection — loser gets a re-battle
    if (newState.divineProtection && newState.divineProtection[loserId] > 0) {
      newState.divineProtection[loserId]--;
      newState.log.push(`Божественная защита Гиордга! Переигровка.`);
      newState.combat.attackerCard = undefined;
      newState.combat.defenderCard = undefined;
      newState.combat.attackerGuess = undefined;
      newState.combat.defenderGuess = undefined;
      if (newState.battleCards) {
        const atkNew = drawCards(newState.battleCards, 1);
        const defNew = drawCards(newState.battleCards, 1);
        if (atkNew.length > 0) newState.battleCards.hands[attackerPlayerId].push(...atkNew);
        if (defNew.length > 0) newState.battleCards.hands[defenderPlayerId].push(...defNew);
      }
      return newState;
    }

    // Check if the loser is protected (pirate/ghost/camp: safe loser doesn't lose unit)
    const isSafe = newState.combat.safeLoser === loserId;
    let unitDestroyed = false;
    let converted = false;

    // Check Шент'Ар conversion — winner converts loser's unit
    if (newState.shentarActive && newState.shentarActive[winnerId] > 0 && !isSafe) {
      newState.shentarActive[winnerId]--;
      const loserUnit = newState.units.find((u) => u.id === loserUnitId);
      if (loserUnit) {
        loserUnit.playerId = winnerId;
        loserUnit.movesLeft = 0;
        newState.log.push(`Шент'Ар: побеждённый отряд перешёл на сторону победителя!`);
        converted = true;
      }
    } else if (!isSafe) {
      newState.units = newState.units.filter((u) => u.id !== loserUnitId);
      newState.log.push(`Проигравший отряд уничтожен.`);
      unitDestroyed = true;
    } else {
      newState.log.push(`Проигрыш, но отряд защищён (спецлокация).`);
    }

    // After combat, loser's unit is gone — move winner away if they're on same node
    // (Units can't coexist with enemies, so winner stays and loser is removed)

    const reasonMap: Record<string, string> = {
      [attackerPlayerId]: attackerGuessedRight ? "guess" : "proximity",
      [defenderPlayerId]: defenderGuessedRight ? "guess" : "proximity",
    };

    newState.lastCombatResult = {
      winnerId,
      loserId,
      winnerCard: winnerId === attackerPlayerId ? attackerCard : defenderCard,
      loserCard: loserId === attackerPlayerId ? attackerCard : defenderCard,
      reason: (attackerGuessedRight && defenderGuessedRight) ? "both_guess" : reasonMap[winnerId],
      loserUnitDestroyed: unitDestroyed,
      converted,
    };

    // Capture city if attacker won and city belongs to defender
    if (!newState.cityOwners) newState.cityOwners = {};
    if (node?.type === "city" && winnerId === attackerPlayerId && !isSafe) {
      const prevOwner = newState.cityOwners[nodeId];
      if (prevOwner && prevOwner !== winnerId) {
        newState.cityOwners[nodeId] = winnerId;
        newState.log.push(`Город ${node.name} захвачен!`);
      }
    }
  }

  // Handle post-special-combat effects
  const specialType = newState.combat.specialType;

  // Ghost temple: if uses exhausted, kill the unit on the temple
  if (specialType === "ghost" && newState.specialLocations) {
    for (const [locId, loc] of Object.entries(newState.specialLocations)) {
      const locNode = getActiveNodes().find((n) => n.id === locId);
      if (locNode?.type === "ghost" && loc.controllerId === attackerPlayerId && loc.usesLeft <= 0) {
        const ghostUnit = newState.units.find(
          (u) => u.position === locId && u.playerId === attackerPlayerId
        );
        if (ghostUnit) {
          newState.units = newState.units.filter((u) => u.id !== ghostUnit.id);
          newState.log.push(`Дань смерти: отряд в Призрачном храме погиб.`);
        }
      }
    }
  }

  // Draw replacement cards (each player draws 1 to replace the played card, only if they used hand card)
  if (newState.battleCards) {
    if (!newState.combat.attackerUseDeck) {
      const atkNew = drawCards(newState.battleCards, 1);
      if (atkNew.length > 0) newState.battleCards.hands[attackerPlayerId].push(...atkNew);
    }
    if (!newState.combat.defenderUseDeck) {
      const defNew = drawCards(newState.battleCards, 1);
      if (defNew.length > 0) newState.battleCards.hands[defenderPlayerId].push(...defNew);
    }
  }

  checkElimination(newState, {} as Record<string, string>);
  newState.combat = undefined;
  newState.phase = "MOVE";

  // Check win condition
  const activePlayers = newState.turnOrder.filter(
    (pid) => !newState.eliminatedPlayers.includes(pid)
  );
  if (activePlayers.length <= 1 && activePlayers.length > 0) {
    newState.winner = activePlayers[0];
    newState.phase = "GAME_OVER";
    newState.log.push(`Победа! Игра окончена.`);
  }

  return newState;
}

export function endTurn(
  state: VelderanGameState,
  playerNames: Record<string, string>
): VelderanGameState {
  const newState = structuredClone(state);
  // Ensure reserve/cityOwners/inventory exist (backward compat)
  if (!newState.reserve) newState.reserve = {};
  if (!newState.cityOwners) newState.cityOwners = {};
  if (!newState.inventory) newState.inventory = {};

  // Find next active player (skip eliminated + Ситас-skipped)
  let nextIdx = newState.currentPlayerIndex;
  let roundEnd = false;
  do {
    nextIdx = (nextIdx + 1) % newState.turnOrder.length;
    if (nextIdx === 0) roundEnd = true;
  } while (newState.eliminatedPlayers.includes(newState.turnOrder[nextIdx]));

  // Check if next player is Ситас-skipped
  const nextPlayerId = newState.turnOrder[nextIdx];
  if (newState.skipTurnPlayers && newState.skipTurnPlayers.includes(nextPlayerId)) {
    newState.skipTurnPlayers = newState.skipTurnPlayers.filter((p) => p !== nextPlayerId);
    const skipName = playerNames[nextPlayerId] || "Игрок";
    newState.log.push(`${skipName} пропускает ход (Ситас)!`);
    // Advance to next non-skipped, non-eliminated player
    do {
      nextIdx = (nextIdx + 1) % newState.turnOrder.length;
      if (nextIdx === 0) roundEnd = true;
    } while (
      newState.eliminatedPlayers.includes(newState.turnOrder[nextIdx]) ||
      (newState.skipTurnPlayers && newState.skipTurnPlayers.includes(newState.turnOrder[nextIdx]))
    );
  }

  if (roundEnd) {
    newState.round++;
    // Reset moves for all units
    for (const unit of newState.units) {
      unit.movesLeft = unit.type === "ARMY" ? 2 : 1;
    }

    // Process smuggler arrivals
    processSmuglerArrivals(newState, playerNames);

    // Reinforcements: +2 armies to inventory per player (per rules: 2 фишки за круг)
    // Only give reinforcements if player has units on the board
    const maxId = newState.units.reduce((max, u) => {
      const num = parseInt(u.id.replace("u", "")) || 0;
      return Math.max(max, num);
    }, 0);
    let nextUnitId = maxId + 1;

    for (const pid of newState.turnOrder) {
      if (newState.eliminatedPlayers.includes(pid)) continue;
      const unitsOnBoard = newState.units.filter((u) => u.playerId === pid);
      if (unitsOnBoard.length === 0) continue; // no units on board → no reinforcements
      const ownCities = Object.entries(newState.cityOwners).filter(
        ([, owner]) => owner === pid
      );
      if (ownCities.length === 0) continue;
      const reinforcements = 2;
      if (!newState.inventory[pid]) newState.inventory[pid] = [];
      for (let i = 0; i < reinforcements; i++) {
        newState.inventory[pid].push({ id: `u${nextUnitId++}`, type: "ARMY" });
      }
      const pName = playerNames[pid] || "Игрок";
      newState.log.push(`${pName} получил +${reinforcements} отрядов в инвентарь.`);
    }

    newState.log.push(`Раунд ${newState.round}. Расставьте подкрепления.`);

    // Enter PLACEMENT if any player has units to place and cities with open slots
    const anyCanPlace = newState.turnOrder.some(
      (pid) => !newState.eliminatedPlayers.includes(pid) && hasPlaceableUnits(newState, pid)
    );
    if (anyCanPlace) {
      newState.phase = "PLACEMENT";
    }

    // Check if any guard is already on a shrine → GOD_SUMMON for current player
    const nextPid = newState.turnOrder[nextIdx];
    const guardOnShrine = newState.units.find((u) => {
      if (u.playerId !== nextPid || u.type !== "GUARD") return false;
      const node = getActiveNodes().find((n) => n.id === u.position);
      return node?.type === "shrine";
    });
    if (guardOnShrine && newState.phase !== "PLACEMENT") {
      // Check if can still roll (max 2 per guard per shrine, 3rd = death)
      if (!newState.godSummonCounts) newState.godSummonCounts = {};
      const guardCounts = newState.godSummonCounts[guardOnShrine.id] || {};
      const shrineNode = getActiveNodes().find((n) => n.id === guardOnShrine.position);
      const rollCount = guardCounts[guardOnShrine.position] || 0;
      if (rollCount < 2) {
        newState.phase = "GOD_SUMMON";
        newState.log.push(`Гвардия на святилище ${shrineNode?.name || ""} — можно бросить кубики!`);
      } else if (rollCount === 2) {
        // 3rd roll = death, but player can choose to roll or not
        newState.phase = "GOD_SUMMON";
        newState.log.push(`Внимание: третий бросок на ${shrineNode?.name || ""} — гвардия погибнет!`);
      }
    }
  }

  newState.currentPlayerIndex = nextIdx;
  const nextName = playerNames[newState.turnOrder[nextIdx]] || "Игрок";
  newState.log.push(`Ход ${nextName}.`);

  return newState;
}

/** Check if player's unit is on a special location with pirate betrayal trigger */
export function checkPirateBetrayal(
  state: VelderanGameState,
  unitId: string,
  playerNames: Record<string, string>
): VelderanGameState {
  const newState = structuredClone(state);
  const unit = newState.units.find((u) => u.id === unitId);
  if (!unit) return newState;

  const node = getActiveNodes().find((n) => n.id === unit.position);
  if (!node || node.type !== "pirate") return newState;

  if (!newState.specialLocations) return newState;
  const loc = newState.specialLocations[node.id];
  if (!loc || loc.controllerId !== unit.playerId) return newState;

  // Betrayal triggers when uses are exhausted and player tries to leave
  if (loc.usesLeft <= 0) {
    const playerName = playerNames[unit.playerId] || "Игрок";
    newState.log.push(`Предательство пиратов! Пираты нападают на ${playerName} при уходе.`);
    // Create a special combat where pirates attack the leaving player
    // The unit fights with a deck card (pirate rules)
    newState.phase = "COMBAT";
    newState.combat = {
      attackerUnitId: unit.id,
      defenderUnitId: unit.id, // fighting "pirates" — will resolve specially
      attackerPlayerId: unit.playerId,
      defenderPlayerId: unit.playerId, // self-combat with deck
      nodeId: unit.position,
      specialType: "pirate",
      attackerUseDeck: true,
      defenderUseDeck: true,
      safeLoser: unit.playerId, // even on loss, pirate betrayal doesn't kill (same pirate rules)
    };
  }
  return newState;
}

/** Get valid targets for special location attacks */
export function getSpecialAttackTargets(
  state: VelderanGameState,
  playerId: string,
  locationNodeId: string
): string[] {
  if (!state.specialLocations) return [];
  const loc = state.specialLocations[locationNodeId];
  if (!loc || loc.controllerId !== playerId || loc.usesLeft <= 0) return [];

  const locationNode = getActiveNodes().find((n) => n.id === locationNodeId);
  if (!locationNode) return [];

  return state.units
    .filter((u) => {
      if (u.playerId === playerId) return false;
      const targetNode = getActiveNodes().find((n) => n.id === u.position);
      if (!targetNode) return false;
      if (locationNode.type === "pirate") return ["port", "windrose"].includes(targetNode.type);
      if (locationNode.type === "ghost") return targetNode.type !== "shrine";
      if (locationNode.type === "camp") return !["windrose", "port", "shrine"].includes(targetNode.type);
      return false;
    })
    .map((u) => u.id);
}
