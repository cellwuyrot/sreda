import {createHash,createHmac,timingSafeEqual} from "node:crypto";
import prisma from "./prisma";
import {decryptTzData} from "./tzIdCrypto";
import {liveSession} from "./tzIdSessions";
import {hubSignatureText} from "./serviceHubPolicy";
import {monitorProjects} from "./projectMonitor";
import {readReport} from "./projectMonitorPolicy";
export async function monitorBridge(headers:Headers,raw:string,input:Record<string,unknown>){
 const clientId=headers.get("x-service-client")||"",stamp=headers.get("x-service-time")||"",nonce=headers.get("x-service-nonce")||"",sig=headers.get("x-service-signature")||"";
 if(!process.env.MONITOR_BUSINESS_CLIENT_ID||clientId!==process.env.MONITOR_BUSINESS_CLIENT_ID||!/^\d{13}$/.test(stamp)||Math.abs(Date.now()-Number(stamp))>60000||!/^[a-f0-9-]{36}$/.test(nonce)||!/^[a-f0-9]{64}$/.test(sig))throw Error("Недопустимый запрос");
 const client=await prisma.tzIdClient.findFirst({where:{id:clientId,enabled:true}});if(!client)throw Error("Приложение отключено");
 const meta=decryptTzData<{client_secret?:string;token_endpoint_auth_method:string}>(client.metadata);if(!meta.client_secret||meta.token_endpoint_auth_method==="none")throw Error("Нет серверного клиента");
 const expected=createHmac("sha256",meta.client_secret).update(hubSignatureText(clientId,stamp,nonce,raw)).digest();if(!timingSafeEqual(expected,Buffer.from(sig,"hex")))throw Error("Неверная подпись");
 await prisma.tzBridgeNonce.create({data:{id:`monitor:${clientId}:${nonce}`,expiresAt:new Date(Date.now()+120000)}});
 const proof=headers.get("x-service-actor-token")||"";if(!proof||proof.length>4096)throw Error("Нужен вход");
 const artifact=await prisma.tzIdArtifact.findUnique({where:{key:createHash("sha256").update(`AccessToken:${proof}`).digest("hex")}});if(!artifact||artifact.expiresAt<=new Date())throw Error("Сеанс истёк");
 const token=decryptTzData<{accountId:string;clientId:string;grantId:string}>(artifact.payload);const grant=await prisma.tzIdAuthorization.findUnique({where:{id:token.grantId}});
 if(token.clientId!==clientId||!grant||grant.revokedAt||grant.clientId!==clientId||grant.userId!==token.accountId||!await liveSession(grant.userId,grant.sessionId))throw Error("Сеанс отозван");
 const actor=await prisma.user.findFirst({where:{id:token.accountId,isDeleted:false},select:{role:true,banned:true,bannedUntil:true}});if(!actor||(actor.banned&&(!actor.bannedUntil||actor.bannedUntil>new Date())))throw Error("Нет доступа");
 const role=actor.role==="CONSULTANT"?"CONSULTANT":"CLIENT";
 if(input.action==="identity")return {sub:token.accountId,role};
 if(role!=="CONSULTANT")throw Error("Кабинет мониторинга доступен партнёру");
 if(input.action==="projects")return {sub:token.accountId,role,projects:await monitorProjects(token.accountId),refreshedAt:new Date().toISOString()};
 if(input.action==="history"){
 const project=await prisma.partnerProject.findFirst({where:{id:String(input.projectId),ownerId:token.accountId},select:{deployments:{select:{id:true,nodeId:true}}}});if(!project)throw Error("Проект не найден");
 const samples=await prisma.monitorSample.findMany({where:{nodeId:{in:project.deployments.map(d=>d.nodeId)},receivedAt:{gte:new Date(Date.now()-86400000)}},orderBy:{sampledAt:"desc"},take:48});
 const ids=new Set(project.deployments.map(d=>d.id));return {history:samples.map(s=>({sampledAt:s.sampledAt,apps:(readReport(s.payload)?.apps||[]).filter(a=>ids.has(a.deploymentId))}))};
 }
 throw Error("Неизвестное действие");
}
