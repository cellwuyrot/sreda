import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import {
  VelderanGameState,
  getCurrentPlayerId,
  moveUnit,
  canMoveUnit,
  endTurn,
  playCombatCard,
  rollDiceForGod,
  placeReserve,
  placeFromInventory,
  finishPlacement,
  specialAttack,
  smugglerTeleport,
  playGodCard,
  getSpecialAttackTargets,
} from "@/lib/games/velderanState";
import { executeBotTurns, isBotPlayer } from "@/lib/games/velderanBot";
import { loadMapConfigFromFiles } from "@/lib/games/velderanMapServer";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = (session.user as { id: string }).id;
  const { id } = await params;

  const room = await prisma.gameRoom.findUnique({
    where: { id },
    include: {
      players: {
        include: { user: { select: { id: true, name: true } } },
      },
    },
  });

  if (!room || room.status !== "PLAYING") {
    return NextResponse.json({ error: "Игра не найдена или не начата" }, { status: 400 });
  }

  const player = room.players.find((p) => p.userId === userId);
  if (!player) {
    return NextResponse.json({ error: "Вы не в этой игре" }, { status: 403 });
  }

  loadMapConfigFromFiles();
  const state: VelderanGameState = JSON.parse(room.gameState || "{}");
  if (!state.turnOrder) {
    return NextResponse.json({ error: "Состояние игры повреждено" }, { status: 500 });
  }

  const body = await req.json();
  const { action } = body;

  // Build player names map
  const playerNames: Record<string, string> = {};
  for (const p of room.players) {
    playerNames[p.id] = p.user.name;
  }

  let newState = state;

  if (action === "move") {
    const currentId = getCurrentPlayerId(state);
    if (player.id !== currentId) {
      return NextResponse.json({ error: "Не ваш ход" }, { status: 400 });
    }
    if (state.phase !== "MOVE") {
      return NextResponse.json({ error: "Сейчас нельзя двигаться" }, { status: 400 });
    }

    const { unitId, targetNodeId } = body;
    if (!canMoveUnit(state, unitId, targetNodeId)) {
      return NextResponse.json({ error: "Невозможный ход" }, { status: 400 });
    }

    const unit = state.units.find((u) => u.id === unitId);
    if (!unit || unit.playerId !== player.id) {
      return NextResponse.json({ error: "Это не ваш отряд" }, { status: 400 });
    }

    newState = moveUnit(state, unitId, targetNodeId, playerNames);
  } else if (action === "end_turn") {
    const currentId = getCurrentPlayerId(state);
    if (player.id !== currentId) {
      return NextResponse.json({ error: "Не ваш ход" }, { status: 400 });
    }
    if (state.phase === "COMBAT") {
      return NextResponse.json({ error: "Завершите сражение" }, { status: 400 });
    }
    if (state.phase === "PLACEMENT") {
      return NextResponse.json({ error: "Завершите расстановку" }, { status: 400 });
    }
    newState = endTurn(state, playerNames);
  } else if (action === "combat_card") {
    if (state.phase !== "COMBAT" || !state.combat) {
      return NextResponse.json({ error: "Нет активного сражения" }, { status: 400 });
    }
    const { card, guess } = body;
    if (!card || !guess || card < 1 || card > 5 || guess < 1 || guess > 5) {
      return NextResponse.json({ error: "Карта и предположение 1-5" }, { status: 400 });
    }

    const combat = state.combat;
    const isAttacker = player.id === combat.attackerPlayerId;
    const isDefender = player.id === combat.defenderPlayerId;

    if (!isAttacker && !isDefender) {
      return NextResponse.json({ error: "Вы не участвуете в сражении" }, { status: 400 });
    }

    // Check player hasn't already played
    if (isAttacker && combat.attackerCard != null) {
      return NextResponse.json({ error: "Вы уже выложили карту" }, { status: 400 });
    }
    if (isDefender && combat.defenderCard != null) {
      return NextResponse.json({ error: "Вы уже выложили карту" }, { status: 400 });
    }

    newState = playCombatCard(state, player.id, card, guess);
  } else if (action === "roll_god") {
    if (state.phase !== "GOD_SUMMON") {
      return NextResponse.json({ error: "Нет вызова божества" }, { status: 400 });
    }
    const currentId = getCurrentPlayerId(state);
    if (player.id !== currentId) {
      return NextResponse.json({ error: "Не ваш ход" }, { status: 400 });
    }

    const guard = state.units.find(
      (u) => u.playerId === player.id && u.type === "GUARD"
    );
    const shrineId = guard?.position || "";

    newState = rollDiceForGod(state, player.id, shrineId, playerNames);
  } else if (action === "place_reserve") {
    if (state.phase !== "PLACEMENT") {
      return NextResponse.json({ error: "Сейчас не фаза расстановки" }, { status: 400 });
    }
    const currentId = getCurrentPlayerId(state);
    if (player.id !== currentId) {
      return NextResponse.json({ error: "Не ваш ход" }, { status: 400 });
    }
    const { cityNodeId } = body;
    if (!cityNodeId) {
      return NextResponse.json({ error: "Укажите город" }, { status: 400 });
    }
    newState = placeReserve(state, player.id, cityNodeId, playerNames);
  } else if (action === "place_inventory") {
    if (state.phase !== "PLACEMENT") {
      return NextResponse.json({ error: "Сейчас не фаза расстановки" }, { status: 400 });
    }
    const currentId = getCurrentPlayerId(state);
    if (player.id !== currentId) {
      return NextResponse.json({ error: "Не ваш ход" }, { status: 400 });
    }
    const { cityNodeId, inventoryUnitId } = body;
    if (!cityNodeId || !inventoryUnitId) {
      return NextResponse.json({ error: "Укажите город и фишку" }, { status: 400 });
    }
    newState = placeFromInventory(state, player.id, cityNodeId, inventoryUnitId, playerNames);
  } else if (action === "undo_placement") {
    return NextResponse.json({ error: "Отмена расстановки запрещена" }, { status: 400 });
  } else if (action === "finish_placement") {
    if (state.phase !== "PLACEMENT") {
      return NextResponse.json({ error: "Сейчас не фаза расстановки" }, { status: 400 });
    }
    const currentId = getCurrentPlayerId(state);
    if (player.id !== currentId) {
      return NextResponse.json({ error: "Не ваш ход" }, { status: 400 });
    }
    newState = finishPlacement(state, playerNames);
  } else if (action === "special_attack") {
    // Remote attack from pirate/ghost/camp
    if (state.phase !== "MOVE") {
      return NextResponse.json({ error: "Сейчас нельзя атаковать" }, { status: 400 });
    }
    const currentId = getCurrentPlayerId(state);
    if (player.id !== currentId) {
      return NextResponse.json({ error: "Не ваш ход" }, { status: 400 });
    }
    const { locationNodeId, targetUnitId } = body;
    if (!locationNodeId || !targetUnitId) {
      return NextResponse.json({ error: "Укажите локацию и цель" }, { status: 400 });
    }
    const validTargets = getSpecialAttackTargets(state, player.id, locationNodeId);
    if (!validTargets.includes(targetUnitId)) {
      return NextResponse.json({ error: "Недопустимая цель" }, { status: 400 });
    }
    newState = specialAttack(state, player.id, locationNodeId, targetUnitId, playerNames);
  } else if (action === "smuggler_teleport") {
    // Smuggler teleport
    if (state.phase !== "MOVE") {
      return NextResponse.json({ error: "Сейчас нельзя телепортировать" }, { status: 400 });
    }
    const currentId = getCurrentPlayerId(state);
    if (player.id !== currentId) {
      return NextResponse.json({ error: "Не ваш ход" }, { status: 400 });
    }
    const { locationNodeId, targetPortId } = body;
    if (!locationNodeId || !targetPortId) {
      return NextResponse.json({ error: "Укажите локацию и порт" }, { status: 400 });
    }
    newState = smugglerTeleport(state, player.id, locationNodeId, targetPortId, playerNames);
  } else if (action === "use_god_card") {
    // Use a god card from inventory
    if (state.phase !== "MOVE") {
      return NextResponse.json({ error: "Можно использовать карты только в фазе хода" }, { status: 400 });
    }
    const currentId = getCurrentPlayerId(state);
    if (player.id !== currentId) {
      return NextResponse.json({ error: "Не ваш ход" }, { status: 400 });
    }
    const { cardIndex, targetUnitId } = body;
    if (cardIndex == null || cardIndex < 0) {
      return NextResponse.json({ error: "Укажите карту" }, { status: 400 });
    }
    newState = playGodCard(state, player.id, cardIndex, targetUnitId, playerNames);
  } else {
    return NextResponse.json({ error: "Неизвестное действие" }, { status: 400 });
  }

  // Auto-play bot turns if the next player is a bot
  if (newState.phase !== "GAME_OVER") {
    const botPlayerIds = new Set(
      room.players.filter((p) => isBotPlayer(p.userId)).map((p) => p.id)
    );
    if (botPlayerIds.size > 0) {
      const nextId = getCurrentPlayerId(newState);
      // Also handle combat where bot is a participant
      const needsBotAction =
        botPlayerIds.has(nextId) ||
        (newState.phase === "COMBAT" &&
          newState.combat &&
          (botPlayerIds.has(newState.combat.attackerPlayerId) ||
            botPlayerIds.has(newState.combat.defenderPlayerId)));
      if (needsBotAction) {
        newState = executeBotTurns(newState, playerNames, botPlayerIds);
      }
    }
  }

  // Check game over
  if (newState.phase === "GAME_OVER" && newState.winner) {
    await prisma.gameRoom.update({
      where: { id },
      data: {
        gameState: JSON.stringify(newState),
        status: "FINISHED",
      },
    });
  } else {
    await prisma.gameRoom.update({
      where: { id },
      data: { gameState: JSON.stringify(newState) },
    });
  }

  return NextResponse.json(newState);
}
