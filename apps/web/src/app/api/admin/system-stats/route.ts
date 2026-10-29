import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import {systemMonitorSummary} from "@/lib/projectMonitorSummary";
export async function GET(){const session=await getServerSession(authOptions);if(session?.user?.role!=="ADMIN")return NextResponse.json({error:"Forbidden"},{status:403});const dayAgo=new Date(Date.now()-86400000);
 const results=await Promise.allSettled([prisma.user.count({where:{lastSeen:{gte:new Date(Date.now()-60000)}}}),prisma.message.count({where:{createdAt:{gte:dayAgo}}}),prisma.directMessage.count({where:{createdAt:{gte:dayAgo}}}),prisma.user.count(),prisma.group.count(),prisma.channel.count(),prisma.article.count(),prisma.service.count(),prisma.service.count({where:{active:true}}),prisma.serverNode.count(),prisma.gameEntry.count()]);
 const n=(i:number)=>results[i].status==="fulfilled"?(results[i] as PromiseFulfilledResult<number>).value:null;
 let monitoring;try{monitoring=await systemMonitorSummary();}catch{monitoring={activeProjects:null,storageUsage:null,serverLoad:null,unavailable:true};}
 return NextResponse.json({onlineNow:n(0),messages24h:n(1)==null||n(2)==null?null:n(1)!+n(2)!,counts:{users:n(3),groups:n(4),channels:n(5),articles:n(6),services:n(7),activeServices:n(8),serverNodes:n(9),games:n(10)},...monitoring,partial:results.some(r=>r.status==="rejected"),refreshedAt:new Date().toISOString()},{headers:{"Cache-Control":"no-store"}});
}
