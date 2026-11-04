import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import DMConversationList from './DMConversationList';
vi.mock('@/components/ui/GlowAvatar',()=>({default:()=> <span>avatar</span>}));
const user=(id:string,name:string)=>({id,name,username:name.toLowerCase(),avatar:null,role:'USER',lastSeen:null,customStatus:null,statusEmoji:null,avatarGlowEnabled:false,avatarGlowColors:null});
const conv=(id:string,name:string,unread:number)=>({id,other:user(id,name),lastMessage:null,lastMessageAt:null,unread});
afterEach(()=>{cleanup();vi.unstubAllGlobals();localStorage.clear();});
describe('Мобильные диалоги',()=>{
 it('фильтрует непрочитанные, находит собеседника и открывает действия',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({folders:[]}),{status:200})));
  const select=vi.fn();render(<DMConversationList conversations={[conv('a','Анна',2),conv('b','Борис',0)]} selectedConv={null} currentUserId="me" onSelect={select}/>);
  await screen.findByText('Анна'); fireEvent.click(screen.getByText('Непрочитанные'));expect(screen.queryByText('Борис')).toBeNull();
  fireEvent.click(screen.getByText('Все'));fireEvent.change(screen.getByLabelText('Поиск диалогов'),{target:{value:'борис'}});expect(screen.queryByText('Анна')).toBeNull();
  fireEvent.click(screen.getByText('Борис'));expect(select).toHaveBeenCalledWith('b');
  fireEvent.click(screen.getByLabelText('Действия: Борис'));await waitFor(()=>expect(screen.getByRole('menu')).toBeTruthy());expect(screen.getByText('В избранное')).toBeTruthy();
 });
});
