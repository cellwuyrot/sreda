import {beforeEach,expect,it,vi} from "vitest";
import {prismaMock,row} from "@/test/prismaMock";
vi.mock('@/lib/prisma',()=>({default:prismaMock}));
vi.mock('next-auth',()=>({getServerSession:vi.fn()}));
vi.mock('@/lib/auth',()=>({authOptions:{}}));
import {getServerSession} from 'next-auth';
import {PATCH,GET} from './route';
const request=(body:unknown)=>new Request('http://localhost/api/profile/privacy',{method:'PATCH',body:JSON.stringify(body)});
beforeEach(()=>vi.mocked(getServerSession).mockResolvedValue(row({user:{id:'u'}})));
it('atomically saves master switch and privacy fields in one update',async()=>{
 const data={showOnline:false,privacyOnline:'nobody',privacyFriends:'friends',privacyEmail:false};
 prismaMock.user.update.mockResolvedValue(row(data));
 const response=await PATCH(request(data));expect(response.status).toBe(200);expect(await response.json()).toEqual(data);
 expect(prismaMock.user.update).toHaveBeenCalledTimes(1);expect(prismaMock.user.update).toHaveBeenCalledWith(expect.objectContaining({where:{id:'u'},data}));
});
it.each([{privacyOnline:'bad'},{showOnline:'false'},{}])('rejects invalid settings before any update',async data=>{expect((await PATCH(request(data))).status).toBe(400);expect(prismaMock.user.update).not.toHaveBeenCalled();});
it('requires authentication',async()=>{vi.mocked(getServerSession).mockResolvedValue(null);expect((await PATCH(request({showOnline:false}))).status).toBe(401);expect((await GET()).status).toBe(401);});
it('does not return success after database failure',async()=>{prismaMock.user.update.mockRejectedValue(new Error('offline'));await expect(PATCH(request({showOnline:false}))).rejects.toThrow('offline');});
