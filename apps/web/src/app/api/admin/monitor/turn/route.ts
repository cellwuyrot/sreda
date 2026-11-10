import {NextResponse} from 'next/server';
import {getServerSession} from 'next-auth';
import {authOptions} from '@/lib/auth';
import prisma from '@/lib/prisma';
import {turnMonitorView} from '@/lib/turnMonitor';
export async function GET(){
 const session=await getServerSession(authOptions);
 if(session?.user?.role!=='ADMIN')return NextResponse.json({error:'Нет доступа'},{status:403,headers:{'Cache-Control':'no-store'}});
 try{
  const nodes=await prisma.serverNode.findMany({where:{kind:'MEDIA'},orderBy:{name:'asc'},select:{id:true,name:true,enabled:true,lastSeenAt:true,lastReport:true}});
  return NextResponse.json({nodes:nodes.map(n=>turnMonitorView(n)),refreshedAt:new Date().toISOString()},{headers:{'Cache-Control':'no-store'}});
 }catch{return NextResponse.json({error:'Мониторинг TURN временно недоступен'},{status:503,headers:{'Cache-Control':'no-store'}});}
}
