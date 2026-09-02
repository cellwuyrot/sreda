"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startActivityWatcher = startActivityWatcher;
exports.stopActivityWatcher = stopActivityWatcher;
exports.resendActivity = resendActivity;
/**
 * FIX-ACT: «Активность» — вариант А (сканирование процессов).
 *
 * Раз в 30 секунд снимаем список запущенных процессов и сверяем его со
 * словарём известных приложений. Готовая фраза статуса (например
 * «Играет в Dota 2») отправляется в renderer (IPC.ACTIVITY_CHANGED).
 * Веб-приложение само решает, слать ли её на сервер — это контролирует
 * чекбокс «Показывать мою активность» в настройках профиля.
 *
 * FIX-ACT2: приоритет — ПОСЛЕДНЕЕ начатое действие, а не порядок словаря.
 * Мы запоминаем, когда каждый известный процесс впервые появился в скане
 * (firstSeen). Статусом становится самое свежее совпадение: слушал музыку,
 * потом запустил игру → покажем игру; поверх игры включил Spotify → покажем
 * музыку. Для процессов, которые уже работали на момент запуска приложения
 * (первый скан), время старта неизвестно — они считаются «давними» и
 * при равенстве побеждает порядок словаря (игры → творчество → музыка →
 * видео → общение → платформы).
 *
 * Приватность: никаких заголовков окон и названий треков — только имена
 * процессов, сверенные с фиксированным словарём.
 */
const child_process_1 = require("child_process");
const constants_1 = require("../shared/constants");
const mainWindow_1 = require("./mainWindow");
/**
 * Имя процесса (Windows, lowercase) → фраза статуса.
 * FIX-ACT2: порядок = только тай-брейк при одинаковом времени запуска.
 * Словарь легко расширять — просто добавьте строку.
 */
const KNOWN_APPS = [
    // —— Игры ——
    ["cs2.exe", "Играет в Counter-Strike 2"],
    ["dota2.exe", "Играет в Dota 2"],
    ["valorant-win64-shipping.exe", "Играет в Valorant"],
    ["fortniteclient-win64-shipping.exe", "Играет в Fortnite"],
    ["leagueoflegends.exe", "Играет в League of Legends"],
    ["league of legends.exe", "Играет в League of Legends"],
    ["gta5.exe", "Играет в GTA V"],
    ["gta5_enhanced.exe", "Играет в GTA V"],
    ["rdr2.exe", "Играет в Red Dead Redemption 2"],
    ["rustclient.exe", "Играет в Rust"],
    ["rocketleague.exe", "Играет в Rocket League"],
    ["minecraft.windows.exe", "Играет в Minecraft"],
    ["minecraft.exe", "Играет в Minecraft"],
    ["wow.exe", "Играет в World of Warcraft"],
    ["overwatch.exe", "Играет в Overwatch 2"],
    ["hearthstone.exe", "Играет в Hearthstone"],
    ["r5apex.exe", "Играет в Apex Legends"],
    ["tslgame.exe", "Играет в PUBG"],
    ["aces.exe", "Играет в War Thunder"],
    ["worldoftanks.exe", "Играет в Мир танков"],
    ["genshinimpact.exe", "Играет в Genshin Impact"],
    ["starrail.exe", "Играет в Honkai: Star Rail"],
    ["robloxplayerbeta.exe", "Играет в Roblox"],
    ["eldenring.exe", "Играет в Elden Ring"],
    ["bg3.exe", "Играет в Baldur's Gate 3"],
    ["bg3_dx11.exe", "Играет в Baldur's Gate 3"],
    ["cyberpunk2077.exe", "Играет в Cyberpunk 2077"],
    ["witcher3.exe", "Играет в The Witcher 3"],
    ["ts4_x64.exe", "Играет в The Sims 4"],
    ["amongus.exe", "Играет в Among Us"],
    ["terraria.exe", "Играет в Terraria"],
    ["stardewvalley.exe", "Играет в Stardew Valley"],
    ["factorio.exe", "Играет в Factorio"],
    ["destiny2.exe", "Играет в Destiny 2"],
    ["escapefromtarkov.exe", "Играет в Escape from Tarkov"],
    ["pathofexile.exe", "Играет в Path of Exile"],
    ["pathofexilesteam.exe", "Играет в Path of Exile"],
    ["deadbydaylight-win64-shipping.exe", "Играет в Dead by Daylight"],
    ["rainbowsix.exe", "Играет в Rainbow Six Siege"],
    ["cod.exe", "Играет в Call of Duty"],
    // —— Творчество / работа ——
    ["photoshop.exe", "Работает в Photoshop"],
    ["illustrator.exe", "Работает в Illustrator"],
    ["afterfx.exe", "Работает в After Effects"],
    ["adobe premiere pro.exe", "Монтирует в Premiere Pro"],
    ["lightroom.exe", "Обрабатывает фото в Lightroom"],
    ["resolve.exe", "Монтирует в DaVinci Resolve"],
    ["capcut.exe", "Монтирует в CapCut"],
    ["figma.exe", "Проектирует в Figma"],
    ["blender.exe", "Работает в Blender"],
    ["3dsmax.exe", "Работает в 3ds Max"],
    ["maya.exe", "Работает в Maya"],
    ["cinema 4d.exe", "Работает в Cinema 4D"],
    ["zbrush.exe", "Лепит в ZBrush"],
    ["unity.exe", "Делает игру в Unity"],
    ["unrealeditor.exe", "Делает игру в Unreal Engine"],
    ["fl64.exe", "Пишет музыку в FL Studio"],
    ["fl.exe", "Пишет музыку в FL Studio"],
    ["reaper.exe", "Пишет музыку в REAPER"],
    ["audacity.exe", "Работает со звуком в Audacity"],
    ["obs64.exe", "Стримит в OBS"],
    ["obs32.exe", "Стримит в OBS"],
    ["code.exe", "Работает в VS Code"],
    ["devenv.exe", "Работает в Visual Studio"],
    ["idea64.exe", "Пишет код в IntelliJ IDEA"],
    ["pycharm64.exe", "Пишет код в PyCharm"],
    ["webstorm64.exe", "Пишет код в WebStorm"],
    ["rider64.exe", "Пишет код в Rider"],
    ["studio64.exe", "Пишет код в Android Studio"],
    ["sublime_text.exe", "Пишет код в Sublime Text"],
    ["notepad++.exe", "Редактирует текст в Notepad++"],
    ["winword.exe", "Пишет документ в Word"],
    ["excel.exe", "Считает в Excel"],
    ["powerpnt.exe", "Готовит презентацию в PowerPoint"],
    ["obsidian.exe", "Ведёт заметки в Obsidian"],
    ["notion.exe", "Работает в Notion"],
    // —— Музыка ——
    ["spotify.exe", "Слушает музыку в Spotify"],
    ["yandexmusic.exe", "Слушает Яндекс Музыку"],
    ["applemusic.exe", "Слушает Apple Music"],
    ["itunes.exe", "Слушает музыку в iTunes"],
    ["deezer.exe", "Слушает музыку в Deezer"],
    ["tidal.exe", "Слушает музыку в TIDAL"],
    ["aimp.exe", "Слушает музыку в AIMP"],
    ["winamp.exe", "Слушает музыку в Winamp"],
    ["foobar2000.exe", "Слушает музыку в foobar2000"],
    // —— Видео ——
    ["vlc.exe", "Смотрит видео в VLC"],
    ["mpc-hc64.exe", "Смотрит видео в MPC-HC"],
    ["potplayermini64.exe", "Смотрит видео в PotPlayer"],
    ["plex.exe", "Смотрит Plex"],
    // —— Общение ——
    ["zoom.exe", "На созвоне в Zoom"],
    ["teams.exe", "На созвоне в Microsoft Teams"],
    ["ms-teams.exe", "На созвоне в Microsoft Teams"],
    ["discord.exe", "Общается в Discord"],
    ["telegram.exe", "Сидит в Telegram"],
    ["whatsapp.exe", "Общается в WhatsApp"],
    // —— Игровые платформы (низший приоритет: сама игра всегда важнее) ——
    ["steam.exe", "Сидит в Steam"],
    ["epicgameslauncher.exe", "Сидит в Epic Games"],
    ["battle.net.exe", "Сидит в Battle.net"],
];
const SCAN_INTERVAL_MS = 30_000;
let timer = null;
let last = null;
// FIX-ACT2: когда каждый известный процесс впервые замечен (0 = был до старта)
const firstSeen = new Map();
let bootScan = true;
/** Ключ процесса для текущей ОС (на macOS/Linux — без .exe). */
function platformKey(proc) {
    return process.platform === "win32" ? proc : proc.replace(/\.exe$/, "");
}
/** Снять список имён процессов (lowercase; на Windows — с .exe). */
function listProcesses() {
    return new Promise((resolve) => {
        const cmd = process.platform === "win32" ? "tasklist /fo csv /nh" : "ps -axo comm=";
        (0, child_process_1.exec)(cmd, { maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (err, stdout) => {
            if (err || !stdout)
                return resolve(new Set());
            const names = new Set();
            for (const raw of stdout.split("\n")) {
                let name = raw.trim();
                if (!name)
                    continue;
                if (process.platform === "win32") {
                    // Формат CSV: "процесс.exe","PID",...
                    const m = name.match(/^"([^"]+)"/);
                    if (!m)
                        continue;
                    name = m[1];
                }
                else {
                    name = name.split("/").pop() ?? name;
                }
                names.add(name.toLowerCase());
            }
            resolve(names);
        });
    });
}
function push(label) {
    (0, mainWindow_1.getMainWindow)()?.webContents.send(constants_1.IPC.ACTIVITY_CHANGED, label);
}
async function scan() {
    const procs = await listProcesses();
    if (procs.size === 0)
        return; // сбой снятия списка — не сбрасываем статус
    const now = Date.now();
    // FIX-ACT2: обновляем время первого появления каждого известного процесса.
    for (const [proc] of KNOWN_APPS) {
        const key = platformKey(proc);
        if (procs.has(key)) {
            if (!firstSeen.has(key))
                firstSeen.set(key, bootScan ? 0 : now);
        }
        else {
            firstSeen.delete(key); // процесс закрыт — забываем
        }
    }
    bootScan = false;
    // FIX-ACT2: побеждает самое свежее действие; при равенстве — порядок словаря
    // (строгое «>» сохраняет более раннюю — более приоритетную — запись).
    let label = null;
    let best = -1;
    for (const [proc, text] of KNOWN_APPS) {
        const seen = firstSeen.get(platformKey(proc));
        if (seen === undefined)
            continue;
        if (seen > best) {
            best = seen;
            label = text;
        }
    }
    if (label !== last) {
        last = label;
        push(label);
    }
}
/** Запустить периодическое сканирование (идемпотентно). */
function startActivityWatcher() {
    if (timer)
        return;
    void scan();
    timer = setInterval(() => void scan(), SCAN_INTERVAL_MS);
}
/** Остановить сканирование (перед выходом из приложения). */
function stopActivityWatcher() {
    if (timer) {
        clearInterval(timer);
        timer = null;
    }
    last = null;
    firstSeen.clear(); // FIX-ACT2
    bootScan = true;
}
/** Повторно отправить текущую активность (после перезагрузки страницы). */
function resendActivity() {
    push(last);
}
//# sourceMappingURL=activity.js.map