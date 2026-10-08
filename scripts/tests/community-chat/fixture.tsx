import React, { useState, useRef, useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { useMessageWindow } from '@/hooks/useMessageWindow';
import { captureMessageAnchor } from '@/lib/chatHistory';
function Fixture() {
 const [ids,setIds]=useState(Array.from({length:1000},(_,i)=>`m${i}`));
 const [expanded,setExpanded]=useState('');
 const scroll=useRef<HTMLDivElement>(null);
 const win=useMessageWindow(ids.length,scroll,ids);
 useLayoutEffect(()=>{ (window as unknown as {qa:object}).qa={
   prepend:()=>{win.capture();setIds(old=>Array.from({length:50},(_,i)=>`old${i}`).concat(old));},
   append:()=>{win.capture();setIds(old=>old.concat('new1'));},
   expand:(id:string)=>{win.capture();setExpanded(id);},
   resize:(id:string)=>{setExpanded(id);},
   reveal:(i:number)=>win.reveal(i),
   tail:()=>{win.revealTail();requestAnimationFrame(()=>{scroll.current!.scrollTop=scroll.current!.scrollHeight;});},
   capture:()=>captureMessageAnchor(scroll.current!),
   info:()=>({start:win.start,end:win.end,padTop:win.padTop,padBottom:win.padBottom,count:ids.length}),
   threshold:()=>{win.reset();setIds(Array.from({length:200},(_,i)=>`m${i}`));},
 }; });
 return <div id="scroller" ref={scroll} onScroll={()=>{win.capture();win.sync();}} style={{height:600,width:600,overflowY:'auto',overflowAnchor:'none',border:'1px solid black'}}>
 <div style={{height:win.padTop}}/>
 {ids.slice(win.start,win.end).map(id=><div key={id} data-message-id={id} style={{display:'flow-root',boxSizing:'border-box',height:id===expanded?700:40+Number(id.replace(/\D/g,''))%5*40,borderBottom:'1px solid gray'}}>{id} variable-height message</div>)}
 <div style={{height:win.padBottom}}/>
 </div>
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
