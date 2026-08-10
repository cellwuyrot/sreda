import { VelderanGameState, getCurrentPlayerId, moveUnit, endTurn, placeFromInventory, finishPlacement, canMoveUnit, rollDiceForGod, playCombatCard, specialAttack, smugglerTeleport, playGodCard, getSpecialAttackTargets } from "./velderanState";
import { getActiveNodes, getNeighbors } from "./velderanMap";

const BOT_USER_PREFIX = "bot-velderan-";

export function isBotPlayer(userId: string): boolean {
  return userId.startsWith(BOT_USER_PREFIX);
}

export function getBotUserId(index: number): string {
  return `${BOT_USER_PREFIX}${index}`;
}

export function getBotEmail(index: number): string {
  return `bot${index}@velderan.local`;
}

export function getBotUsername(index: number): string {
  return `velderan_bot_${index}`;
}

export function getBotName(index: number): string {
  const names = ["Страж", "Воин", "Мудрец", "Рыцарь", "Следопыт", "Берсерк", "Чародей", "Лорд", "Каратель", "Провидец"];
  return `Бот ${names[index % names.length]}`;
}

// ─── Strategy constants ───
const CHANCE_ATTACK_ENEMY = 0.45;     // 45% — go toward enemy
const CHANCE_SHRINE_GUARD = 0.25;     // 25% — guard heads to shrine
const CHANCE_CAPTURE_CITY = 0.65;     // 65% — try to capture undefended city
const CHANCE_STAY_DEFENSIVE = 0.15;   // 15% — stay and defend own city

/**
 * Execute bot turn(s) on the current game state.
 * Processes multiple consecutive bot turns until a human player is next.
 */
export function executeBotTurns(
  state: VelderanGameState,
  playerNames: Record<string, string>,
  botPlayerIds: Set<string>,
  maxIterations = 100
): VelderanGameState {
  let newState = structuredClone(state);
  let iterations = 0;

  while (iterations < maxIterations) {
    iterations++;
    if (newState.phase === "GAME_OVER") break;

    const currentId = getCurrentPlayerId(newState);

    // Handle combat where bot is a participant (even if not current player)
    if (newState.phase === "COMBAT" && newState.combat) {
      const { attackerPlayerId, defenderPlayerId } = newState.combat;
      const botInCombat =
        (botPlayerIds.has(attackerPlayerId) && newState.combat.attackerCard == null) ||
        (botPlayerIds.has(defenderPlayerId) && newState.combat.defenderCard == null);
      if (botInCombat) {
        const botCombatId = botPlayerIds.has(attackerPlayerId) && newState.combat.attackerCard == null
          ? attackerPlayerId
          : defenderPlayerId;
        newState = botCombat(newState, botCombatId, playerNames);
        continue;
      }
      if (!botPlayerIds.has(currentId)) break;
    }

    if (!botPlayerIds.has(currentId)) break;

    if (newState.phase === "PLACEMENT") {
      newState = botPlacement(newState, currentId, playerNames);
    } else if (newState.phase === "MOVE") {
      newState = botMove(newState, currentId, playerNames);
    } else if (newState.phase === "GOD_SUMMON") {
      newState = botGodSummon(newState, currentId, playerNames);
    } else {
      break;
    }
  }

  return newState;
}

// ─── PLACEMENT ───
function botPlacement(
  state: VelderanGameState,
  botId: string,
  playerNames: Record<string, string>
): VelderanGameState {
  let newState = structuredClone(state);
  if (!newState.inventory) newState.inventory = {};

  const maxPerCity = newState.round === 1 ? 1 : 2;
  const ownCities = Object.entries(newState.cityOwners)
    .filter(([, owner]) => owner === botId)
    .map(([nodeId]) => nodeId);

  // Sort cities by strategic value: border cities first (near enemies)
  const rankedCities = ownCities
    .map((cityId) => {
      const neighbors = getNeighbors(cityId);
      const nearbyEnemies = neighbors.filter((nId) => {
        const owner = newState.cityOwners[nId];
        return owner && owner !== botId;
      }).length;
      const unitsHere = newState.units.filter(
        (u) => u.position === cityId && u.playerId === botId
      ).length;
      return { cityId, nearbyEnemies, unitsHere };
    })
    .filter((c) => c.unitsHere < maxPerCity)
    .sort((a, b) => b.nearbyEnemies - a.nearbyEnemies);

  // Place guards first on strategic border cities, then armies
  for (const { cityId } of rankedCities) {
    const currentInv = newState.inventory[botId] || [];
    if (currentInv.length === 0) break;

    const unitsAtCity = newState.units.filter(
      (u) => u.position === cityId && u.playerId === botId
    );
    if (unitsAtCity.length >= maxPerCity) continue;

    // Prefer placing guards early (they go to shrines later)
    const guardIdx = currentInv.findIndex((u) => u.type === "GUARD");
    const armyIdx = currentInv.findIndex((u) => u.type === "ARMY");
    const unitToPlace = guardIdx >= 0 && unitsAtCity.length === 0
      ? currentInv[guardIdx]
      : armyIdx >= 0
        ? currentInv[armyIdx]
        : currentInv[0];

    newState = placeFromInventory(newState, botId, cityId, unitToPlace.id, playerNames);
  }

  return finishPlacement(newState, playerNames);
}

// ─── MOVE ───
function botMove(
  state: VelderanGameState,
  botId: string,
  playerNames: Record<string, string>
): VelderanGameState {
  let newState = structuredClone(state);

  // Process each unit with moves left
  const processUnits = () => {
    const myUnits = newState.units
      .filter((u) => u.playerId === botId && u.movesLeft > 0)
      .sort((a, b) => {
        // Process guards first (they might go to shrines)
        if (a.type === "GUARD" && b.type !== "GUARD") return -1;
        if (b.type === "GUARD" && a.type !== "GUARD") return 1;
        return 0;
      });

    for (const unit of myUnits) {
      if (newState.phase !== "MOVE") break;
      if (getCurrentPlayerId(newState) !== botId) break;

      // Refresh unit reference
      const currentUnit = newState.units.find((u) => u.id === unit.id);
      if (!currentUnit || currentUnit.movesLeft <= 0) continue;

      const neighbors = getNeighbors(currentUnit.position);
      if (neighbors.length === 0) continue;

      // Defensive: maybe stay on own city
      const currentNode = getActiveNodes().find((n) => n.id === currentUnit.position);
      if (currentNode?.type === "city" && newState.cityOwners[currentUnit.position] === botId) {
        if (Math.random() < CHANCE_STAY_DEFENSIVE) continue;
      }

      const validTargets: { nodeId: string; score: number; reason: string }[] = [];

      for (const neighborId of neighbors) {
        if (!canMoveUnit(newState, currentUnit.id, neighborId)) continue;
        const node = getActiveNodes().find((n) => n.id === neighborId);
        if (!node) continue;

        let score = 1 + Math.random() * 0.5; // base + small randomness

        // ── Capture undefended enemy city (highest value)
        if (node.type === "city") {
          const owner = newState.cityOwners[neighborId];
          if (owner && owner !== botId) {
            const defenders = newState.units.filter(
              (u) => u.position === neighborId && u.playerId !== botId
            );
            if (defenders.length === 0) {
              score = 12 * (Math.random() < CHANCE_CAPTURE_CITY ? 1 : 0.3);
            } else {
              score = Math.random() < CHANCE_ATTACK_ENEMY ? 7 : 2;
            }
          } else if (!owner) {
            score = 9; // neutral city
          }
        }

        // ── Attack enemy units on non-city nodes
        if (node.type !== "city") {
          const enemies = newState.units.filter(
            (u) => u.position === neighborId && u.playerId !== botId
          );
          if (enemies.length > 0) {
            score = Math.random() < CHANCE_ATTACK_ENEMY ? 6 : 1.5;
          }
        }

        // ── Guard → shrine (powerful god summon)
        if (node.type === "shrine" && currentUnit.type === "GUARD") {
          score = Math.random() < CHANCE_SHRINE_GUARD ? 8 : 3;
        }

        // ── Avoid moving into friendly-crowded nodes
        const friendlyAtNode = newState.units.filter(
          (u) => u.position === neighborId && u.playerId === botId
        );
        if (friendlyAtNode.length >= 1) {
          score *= 0.4;
        }

        // ── Prefer moving toward enemy territory (BFS heuristic)
        const enemyNearby = getNeighbors(neighborId).some((n2) => {
          const owner = newState.cityOwners[n2];
          return owner && owner !== botId;
        });
        if (enemyNearby && score < 5) {
          score += 2;
        }

        validTargets.push({ nodeId: neighborId, score, reason: node.type });
      }

      if (validTargets.length === 0) continue;

      // Sort by score, pick best
      validTargets.sort((a, b) => b.score - a.score);
      const best = validTargets[0];

      // Extra check before moving
      const refreshedUnit = newState.units.find((u) => u.id === currentUnit.id);
      if (!refreshedUnit || refreshedUnit.movesLeft <= 0) continue;
      if (getCurrentPlayerId(newState) !== botId || newState.phase !== "MOVE") break;

      newState = moveUnit(newState, currentUnit.id, best.nodeId, playerNames);

      // Handle combat if triggered
      if (newState.phase === "COMBAT") {
        newState = botCombat(newState, botId, playerNames);
      }

      // Handle god summon if triggered
      if (newState.phase === "GOD_SUMMON" && getCurrentPlayerId(newState) === botId) {
        newState = botGodSummon(newState, botId, playerNames);
      }
    }
  };

  processUnits();

  // ── Use special locations ──
  if (newState.phase === "MOVE" && getCurrentPlayerId(newState) === botId && newState.specialLocations) {
    for (const [locId, loc] of Object.entries(newState.specialLocations)) {
      if (loc.controllerId !== botId || loc.usesLeft <= 0) continue;
      const locNode = getActiveNodes().find((n) => n.id === locId);
      if (!locNode) continue;

      if (locNode.type === "smuggler") {
        // Smuggler: teleport unit to a random enemy port
        const ports = getActiveNodes().filter((n) => n.type === "port");
        if (ports.length > 0) {
          const target = ports[Math.floor(Math.random() * ports.length)];
          newState = smugglerTeleport(newState, botId, locId, target.id, playerNames);
        }
      } else {
        // Pirate/Ghost/Camp: attack random valid target
        const targets = getSpecialAttackTargets(newState, botId, locId);
        if (targets.length > 0) {
          const targetId = targets[Math.floor(Math.random() * targets.length)];
          newState = specialAttack(newState, botId, locId, targetId, playerNames);
          // Resolve combat if triggered
          if (newState.phase === "COMBAT") {
            newState = botCombat(newState, botId, playerNames);
          }
        }
      }
    }
  }

  // ── Use god cards ──
  if (newState.phase === "MOVE" && getCurrentPlayerId(newState) === botId && newState.godCards) {
    const cards = newState.godCards[botId] || [];
    if (cards.length > 0 && newState.phase === "MOVE" && getCurrentPlayerId(newState) === botId) {
      const card = cards[0];
      let targetId: string | undefined;
      if (card.godId === 3 || card.godId === 9) {
        const enemies = newState.units.filter((u) => u.playerId !== botId);
        targetId = enemies.length > 0 ? enemies[Math.floor(Math.random() * enemies.length)].id : undefined;
      } else if (card.godId === 5) {
        const enemyPlayers = newState.turnOrder.filter(
          (pid) => pid !== botId && !newState.eliminatedPlayers.includes(pid)
        );
        targetId = enemyPlayers.length > 0 ? enemyPlayers[Math.floor(Math.random() * enemyPlayers.length)] : undefined;
      } else if (card.godId === 8) {
        const myUnits = newState.units.filter((u) => u.playerId === botId && u.type === "ARMY");
        targetId = myUnits.length > 0 ? myUnits[Math.floor(Math.random() * myUnits.length)].id : undefined;
      }
      // godId 6 (Shent'Ar) and 7 (Giordg) don't need a target — they are passive
      newState = playGodCard(newState, botId, 0, targetId, playerNames);
    }
  }

  // End turn if still in MOVE phase
  if (newState.phase === "MOVE" && getCurrentPlayerId(newState) === botId) {
    newState = endTurn(newState, playerNames);
  }

  return newState;
}

// ─── COMBAT ───
function botCombat(
  state: VelderanGameState,
  botId: string,
  _playerNames: Record<string, string>
): VelderanGameState {
  let newState = structuredClone(state);
  if (!newState.combat) return newState;

  const combat = newState.combat;
  const isAttacker = combat.attackerPlayerId === botId;
  const isDefender = combat.defenderPlayerId === botId;
  if (!isAttacker && !isDefender) return newState;

  const shouldPlay = (isAttacker && combat.attackerCard == null) || (isDefender && combat.defenderCard == null);
  if (!shouldPlay) return newState;

  const hand = newState.battleCards?.hands[botId] || [];

  // Smart card selection:
  // - Play the highest card (better chance of winning on higher number)
  // - But occasionally play a low card to bluff (15% chance)
  let card: number;
  if (hand.length > 0) {
    const sorted = [...hand].sort((a, b) => b - a);
    if (Math.random() < 0.15 && sorted.length > 1) {
      // Bluff: play a low card
      card = sorted[sorted.length - 1];
    } else {
      // Play highest card
      card = sorted[0];
    }
  } else {
    card = Math.floor(Math.random() * 5) + 1;
  }

  // Smart guess: weighted toward middle values (3 is most common play)
  // Distribution: 1→8%, 2→18%, 3→35%, 4→25%, 5→14%
  const guessWeights = [8, 18, 35, 25, 14];
  const totalWeight = guessWeights.reduce((a, b) => a + b, 0);
  let roll = Math.random() * totalWeight;
  let guess = 3;
  for (let i = 0; i < guessWeights.length; i++) {
    roll -= guessWeights[i];
    if (roll <= 0) {
      guess = i + 1;
      break;
    }
  }

  newState = playCombatCard(newState, botId, card, guess);
  return newState;
}

// ─── GOD SUMMON ───
function botGodSummon(
  state: VelderanGameState,
  botId: string,
  playerNames: Record<string, string>
): VelderanGameState {
  const guard = state.units.find(
    (u) => u.playerId === botId && u.type === "GUARD" &&
    getActiveNodes().find((n) => n.id === u.position)?.type === "shrine"
  );
  const shrineId = guard?.position || "";
  return rollDiceForGod(state, botId, shrineId, playerNames);
}
