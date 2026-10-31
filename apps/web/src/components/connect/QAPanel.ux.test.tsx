import React from 'react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
vi.mock('@/components/connect/ModuleSettingsModal',()=>({ModuleSettingsButton:()=>null}));
vi.mock('./messageFormat',()=>({renderContent:(text:string)=>text}));
import QAPanel from './QAPanel';
const props={channelId:'qa',channelName:'Вопросы и ответы',currentUserId:'u',canModerate:false};
beforeEach(()=>vi.stubGlobal('fetch',vi.fn()));afterEach(()=>{cleanup();vi.unstubAllGlobals()});
it.each([403,500])('does not claim empty state on HTTP %s and allows retry',async status=>{
 vi.mocked(fetch).mockResolvedValueOnce(new Response('{"error":"offline"}',{status})).mockResolvedValueOnce(new Response('{"threads":[]}'));
 render(<QAPanel {...props}/>);await screen.findByRole('alert');expect(screen.queryByText('Пока нет вопросов. Будьте первым!')).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Повторить загрузку'}));await screen.findByText('Пока нет вопросов. Будьте первым!');
});
it('reports network error without a fictional zero count',async()=>{vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch'));render(<QAPanel {...props}/>);await screen.findByRole('alert');expect(screen.getByText('Количество неизвестно')).toBeInTheDocument();});
it('labels the dialog, puts focus inside, closes on Escape and returns focus',async()=>{
 vi.mocked(fetch).mockResolvedValue(new Response('{"threads":[]}'));render(<QAPanel {...props}/>);await screen.findByText('Пока нет вопросов. Будьте первым!');
 const trigger=screen.getByRole('button',{name:'Задать вопрос'});trigger.focus();fireEvent.click(trigger);
 expect(screen.getByRole('dialog',{name:'Новый вопрос'})).toBeInTheDocument();expect(screen.getByLabelText('Заголовок вопроса')).toHaveFocus();
 fireEvent.keyDown(document,{key:'Escape'});await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());expect(trigger).toHaveFocus();
});
