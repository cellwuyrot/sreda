import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
const m=vi.hoisted(()=>({call: {} as Record<string, unknown>}));
vi.mock('@/components/call/CallProvider',()=>({useCall:()=>m.call}));
import CallWindow from './CallWindow';
afterEach(cleanup);
describe('Личный звонок',()=>{
  it('управляет входящим вызовом и разговором прежними обработчиками',()=>{
    const accept=vi.fn(),decline=vi.fn(),hangup=vi.fn(),toggleMic=vi.fn(),toggleCamera=vi.fn();
    m.call={state:{phase:'incoming',video:false,peer:{userName:'Анна',avatar:null}},accept,decline,hangup,micMuted:false,toggleMic,cameraOn:false,toggleCamera,flipCamera:vi.fn(),facing:'user',localStream:null,remoteStream:null,peerMuted:false,peerVideo:false};
    const view=render(<CallWindow/>); fireEvent.click(screen.getByLabelText('Ответить')); expect(accept).toHaveBeenCalledOnce();
    m.call={...m.call,state:{phase:'active',peer:{userName:'Анна',avatar:null},startedAt:Date.now()}};view.rerender(<CallWindow/>);
    fireEvent.click(screen.getByLabelText('Выключить микрофон')); expect(toggleMic).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByLabelText('Включить камеру')); expect(toggleCamera).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByLabelText('Завершить звонок'));expect(hangup).toHaveBeenCalledOnce();
  });
});
