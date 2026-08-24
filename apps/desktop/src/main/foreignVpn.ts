/* ══════════════════════════════════════════════════════════════════════════
   FIX-FOREIGNVPN: сторонние VPN блокируют включение нашего туннеля
   ══════════════════════════════════════════════════════════════════════════

   Два full-tunnel VPN на одной машине делят один маршрут по умолчанию. Кто
   поднялся позже — тот и забирает трафик, причём молча: наш туннель в
   интерфейсе выглядит включённым, а выходной адрес при этом чужой. Именно
   это и стоило нам целой серии ложных диагнозов — поэтому проверка живёт в
   коде, а не в памяти пользователя.

   Важное различие: блокируем только туннели, которые могут увести весь
   трафик. Локальные сети вроде Radmin VPN, Hamachi, Hyper-V, VirtualBox и WSL живут
   у людей постоянно и к выходу в интернет отношения не имеют; запрет из-за них
   был бы просто неработающей кнопкой. */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { TUNNEL_NAME } from "../shared/vpnPlan";

const run = promisify(execFile);

export interface ForeignTunnel {
	/** Имя сетевого адаптера, как его видит человек в «Сетевых подключениях». */
	name: string;
	/** Описание устройства — по нему чаще всего и опознаётся клиент. */
	description: string;
	/** Узнаваемое название продукта, если его удалось опознать. */
	vendor: string | null;
	ifIndex: number;
}

/* Семейства клиентов, которые умеют забирать весь трафик. Порядок важен: первое
   совпадение и идёт в текст сообщения. */
const VENDORS: { label: string; re: RegExp }[] = [
	{ label: "AmneziaVPN", re: /amnezia/i },
	{ label: "WireGuard", re: /wireguard|wg-?tunnel|wintun/i },
	{ label: "OpenVPN", re: /openvpn|tap-windows|tap-win32/i },
	{ label: "Outline", re: /outline/i },
	{ label: "Cloudflare WARP", re: /cloudflare|warp/i },
	{ label: "Tailscale", re: /tailscale/i },
	{ label: "ZeroTier", re: /zerotier/i },
	{ label: "NordVPN", re: /nord(lynx|vpn)/i },
	{ label: "ProtonVPN", re: /proton/i },
	{ label: "Mullvad", re: /mullvad/i },
	{ label: "ExpressVPN", re: /express\s*vpn|expressvpn/i },
	{ label: "Surfshark", re: /surfshark/i },
	{ label: "Windscribe", re: /windscribe/i },
	{ label: "AdGuard VPN", re: /adguard/i },
	{ label: "Kaspersky VPN", re: /kaspersky/i },
	{ label: "Xray / V2Ray / sing-box", re: /xray|v2ray|sing-?box|nekoray|hiddify|clash/i },
	{ label: "SoftEther", re: /softether|se-?vpn/i },
	{ label: "Cisco AnyConnect", re: /anyconnect|cisco\s*secure\s*client/i },
	{ label: "FortiClient", re: /forti/i },
	{ label: "Check Point", re: /check\s*point/i },
	{ label: "VPN-туннель", re: /\bvpn\b|\btun\b|\btap\b|pptp|l2tp|sstp|ikev2|агент впн/i },
];

/* Адаптеры, которые называются «VPN», но весь трафик не забирают. Здесь же виртуальные
   мосты гипервизоров — без них проверка срабатывала бы почти на любом ПК с Docker. */
const ALLOWED = [
	/radmin/i,
	/hamachi|logmein/i,
	/vethernet|hyper-?v|default switch/i,
	/virtualbox|vmware|parallels/i,
	/loopback|npcap|teredo|isatap|6to4/i,
	/bluetooth|wi-?fi direct|microsoft (kernel|wi-?fi)/i,
];

function vendorOf(text: string): string | null {
	for (const v of VENDORS) if (v.re.test(text)) return v.label;
	return null;
}

interface RawAdapter {
	Name?: unknown;
	InterfaceDescription?: unknown;
	InterfaceIndex?: unknown;
	Status?: unknown;
}

function parseAdapters(stdout: string): RawAdapter[] {
	const text = stdout.trim();
	if (!text) return [];
	try {
		const parsed: unknown = JSON.parse(text);
		if (Array.isArray(parsed)) return parsed as RawAdapter[];
		if (parsed && typeof parsed === "object") return [parsed as RawAdapter];
		return [];
	} catch {
		/* Неразборный ответ — не повод запретить включение. */
		return [];
	}
}

/**
 * Найти включённые сторонние VPN-адаптеры.
 *
 * Собственный адаптер (`trioz`) из списка исключён: его остаток после
 * предыдущего сеанса не должен запрещать повторное включение.
 *
 * Ошибка проверки всегда трактуется как «чужих нет»: проверка страхует от
 * путаницы, но не имеет права оставить человека без VPN из-за своего сбоя.
 */
export async function detectForeignTunnels(): Promise<ForeignTunnel[]> {
	if (process.platform !== "win32") return detectForeignTunnelsUnix();

	try {
		const { stdout } = await run(
			"powershell.exe",
			[
				"-NoProfile",
				"-NonInteractive",
				"-ExecutionPolicy",
				"Bypass",
				"-Command",
				"Get-NetAdapter | Where-Object { $_.Status -eq 'Up' } | Select-Object Name,InterfaceDescription,InterfaceIndex | ConvertTo-Json -Compress",
			],
			{ timeout: 8000, windowsHide: true, maxBuffer: 1024 * 1024 },
		);
		return filterForeign(parseAdapters(stdout));
	} catch {
		return [];
	}
}

/* Linux/macOS: там тоже бывают чужие туннели, но списка адаптеров с описаниями
   нет — ориентируемся на имена интерфейсов. */
async function detectForeignTunnelsUnix(): Promise<ForeignTunnel[]> {
	try {
		const { stdout } = await run("ip", ["-o", "link", "show", "up"], { timeout: 5000, maxBuffer: 512 * 1024 });
		const out: ForeignTunnel[] = [];
		for (const line of stdout.split("\n")) {
			const m = /^\d+:\s+([^:@]+)/.exec(line.trim());
			if (!m) continue;
			const name = m[1].trim();
			if (name === TUNNEL_NAME || name === "lo") continue;
			if (!/^(wg|tun|tap|awg|nordlynx|proton|utun|ppp)\d*/i.test(name)) continue;
			out.push({ name, description: name, vendor: vendorOf(name), ifIndex: 0 });
		}
		return out;
	} catch {
		return [];
	}
}

function filterForeign(rows: RawAdapter[]): ForeignTunnel[] {
	const out: ForeignTunnel[] = [];
	for (const row of rows) {
		const name = typeof row.Name === "string" ? row.Name : "";
		const description = typeof row.InterfaceDescription === "string" ? row.InterfaceDescription : "";
		const ifIndex = typeof row.InterfaceIndex === "number" ? row.InterfaceIndex : 0;
		if (!name && !description) continue;

		/* Свой туннель и его адаптеры-призраки (`trioz`, `trioz 2`) не считаются чужими. */
		if (new RegExp(`^${TUNNEL_NAME}(\\s|$)`, "i").test(name)) continue;

		const haystack = `${name} ${description}`;
		if (ALLOWED.some((re) => re.test(haystack))) continue;
		const vendor = vendorOf(haystack);
		if (!vendor) continue;
		out.push({ name, description, vendor, ifIndex });
	}
	return out;
}

/** Текст для окна: кто мешает и что с этим делать. */
export function foreignTunnelMessage(list: ForeignTunnel[]): string {
	if (list.length === 0) return "";
	const names = Array.from(new Set(list.map((t) => t.vendor || t.name))).slice(0, 3).join(", ");
	return `Сначала выключите сторонний VPN: ${names}. Два VPN сразу делят один маршрут, и трафик уйдёт не туда, куда показывает приложение.`;
}
