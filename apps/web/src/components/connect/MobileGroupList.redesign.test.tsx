import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import MobileGroupList from './MobileGroupList';
vi.mock('next/image', () => ({ default: ({src,alt}:{src:string,alt:string}) => <img src={src} alt={alt}/> }));
vi.mock('next/link', () => ({default: ({children,href}:{children:React.ReactNode,href:string}) => <a href={href}>{children}</a>}));
vi.mock('@/components/mobile/MobileNotificationBell', () => ({default: () => <button>Уведомления</button>}));
vi.mock('@/components/connect/PremiumMark', () => ({default: ({onClick}:{onClick:()=>void}) => <button onClick={onClick}>Premium</button>}));
afterEach(cleanup);
describe('Мобильные сообщества', () => {
  it('открывает сообщества, создание, вступление и поиск, не показывает название', () => {
    const select=vi.fn(),create=vi.fn(),join=vi.fn(),search=vi.fn(),premium=vi.fn();
    render(<MobileGroupList groups={[{id:'1',name:'Команда',icon:null,description:'',_count:{members:3,channels:2}}]} onSelectGroup={select} onCreateGroup={create} onJoinGroup={join} onOpenSearch={search} onOpenPremiumInfo={premium} groupUnread={{'1':{count:3,mention:false,channels:['общий']}}}/>);
    expect(screen.queryByText('TZ.Connect')).toBeNull(); expect(screen.getByText('3')).toBeTruthy();
    fireEvent.click(screen.getByText('Команда')); expect(select).toHaveBeenCalledWith('1');
    fireEvent.click(screen.getByText('＋ Создать сообщество')); expect(create).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByText('Присоединиться →')); expect(join).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByLabelText('Поиск в TZ.Connect')); expect(search).toHaveBeenCalledOnce();
    const mark=screen.getByText('Premium'); expect(mark.closest('[data-android-hide="true"]')).toBeTruthy();
    fireEvent.click(mark); expect(premium).toHaveBeenCalledOnce();
  });
});
