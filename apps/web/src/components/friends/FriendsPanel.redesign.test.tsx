import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import FriendsPanel from './FriendsPanel';
vi.mock('socket.io-client', () => ({io: () => ({on:()=>{},disconnect:()=>{}})}));
vi.mock('@/components/ui/GlowAvatar', () => ({default: () => <span>avatar</span>}));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe('Друзья на телефоне', () => {
  it('ищет друзей и открывает переписку без промежуточной карточки', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({friends:[{id:'a',name:'Анна',username:'anna',avatar:null,friendshipId:'fa'},{id:'b',name:'Борис',username:'boris',avatar:null,friendshipId:'fb'}],pending:[],sent:[]}),{status:200})));
    const onMessage=vi.fn(); render(<FriendsPanel onMessageFriend={onMessage}/>);
    await screen.findByText('Анна'); fireEvent.change(screen.getByLabelText('Найти друга'),{target:{value:'anna'}});
    expect(screen.queryByText('Борис')).toBeNull();
    fireEvent.click(screen.getByLabelText('Написать Анна')); expect(onMessage).toHaveBeenCalledWith('a');
    fireEvent.click(screen.getByLabelText('Добавить друга')); expect(await screen.findByPlaceholderText('@username')).toBeTruthy();
  });
});
