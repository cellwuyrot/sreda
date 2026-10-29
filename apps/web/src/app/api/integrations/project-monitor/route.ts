import {NextResponse} from "next/server";
import {monitorBridge} from "@/lib/projectMonitorBridge";
export const runtime="nodejs";
export async function POST(req:Request){try{const raw=await req.text();if(raw.length>8192)return NextResponse.json({error:"Too large"},{status:413});const input=JSON.parse(raw);if(!input||typeof input!=="object"||Array.isArray(input))throw Error();return NextResponse.json(await monitorBridge(req.headers,raw,input),{headers:{"Cache-Control":"no-store"}});}catch{return NextResponse.json({error:"Мониторинг недоступен: проверьте вход, роль партнёра и разрешённое приложение Business"},{status:403});}}
