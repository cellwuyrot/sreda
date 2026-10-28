import ServiceHubConsole from "@/components/services/ServiceHubConsole";
import Link from "next/link";
export default function Page() { return <main><div className="max-w-5xl mx-auto px-4 pt-6"><Link href="/tz-id" className="underline inline-flex min-h-[44px] items-center">← Мой TZ ID</Link></div><ServiceHubConsole /></main>; }
