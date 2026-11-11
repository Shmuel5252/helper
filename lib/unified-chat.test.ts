import {test} from 'node:test';
import assert from 'node:assert/strict';
import { archiveId, mediaPatch, transcriptConversation, removeLocalChat, isAnswerArchived } from './unified-chat.ts';
import type {ArchiveTurn, ArchiveTranscript} from './archive/types.ts';

test('archive identifiers are stable UUIDs for old local chats and message positions',async()=>{
  const a=await archiveId('old-local-id');
  assert.match(a,/^[a-f0-9-]{14}5[a-f0-9-]{21}$/);
  assert.equal(a,await archiveId('old-local-id'));
  assert.notEqual(a,await archiveId('old-local-id:2'));
});
const turn={id:'turn',conversation_id:'chat',model_key:'account-video',input:'a video',assets:[],status:'failed',output:[{type:'text',text:'Cannot create this video'}],error:null,sequence:1,provider_id:null,input_hash:'',created_at:'',checked_at:''} as ArchiveTurn;
test('deletion cannot discard an answer when only its request or partial text was archived',()=>{
  const saved={...turn,model_key:'chat:fast',status:'running' as const,output:[]};
  const answer={role:'assistant' as const,content:'complete answer'};
  assert.equal(isAnswerArchived(saved,answer),false);
  assert.equal(isAnswerArchived({...saved,output:[{type:'text',text:'complete'}]},answer),false);
  assert.equal(isAnswerArchived({...saved,status:'completed',output:[{type:'text',text:'complete answer'}]},answer),true);
});
test('provider refusal stops the media card and preserves the actual answer',()=>{
  assert.deepEqual(mediaPatch(turn),{status:'failed',error:'Cannot create this video'});
  assert.equal(mediaPatch({...turn,status:'completed',output:[{type:'video',assetId:'asset'}]}).url,'/api/gemini/assets/asset');
  assert.equal(mediaPatch({...turn,status:'running',output:[]}).status,'pending');
});
test('existing archived chat imports user text, answer and media without generating',()=>{
  const c=transcriptConversation({conversation:{id:'chat',title:'saved',created_at:new Date(0).toISOString(),updated_at:new Date(1).toISOString()},assets:[],turns:[turn]} as ArchiveTranscript);
  assert.equal(c.messages[0].content,'a video');
  assert.equal(c.messages[1].media?.error,'Cannot create this video');
  assert.equal(c.messages[1].media?.provider,'account');
});
test('local deletion does not alter the retained conversation or archive identifiers',()=>{
  const c=transcriptConversation({conversation:{id:'chat',title:'saved',created_at:new Date(0).toISOString(),updated_at:new Date(1).toISOString()},assets:[],turns:[turn]} as ArchiveTranscript);
  const original=JSON.stringify(c);
  assert.deepEqual(removeLocalChat([c],'chat'),[]);
  assert.equal(JSON.stringify(c),original);
});

test('fal archive imports retain their provider and media without changing old Gemini turns',()=>{
  for(const kind of ['image','video']){
    const saved={...turn,model_key:`fal-${kind}-v1`,status:'completed',output:[{type:kind,assetId:'saved-asset'}]} as ArchiveTurn;
    const data={conversation:{id:'chat',title:'saved',created_at:new Date(0).toISOString(),updated_at:new Date(1).toISOString()},assets:[],turns:[turn,saved]} as ArchiveTranscript;
    const before=JSON.stringify(data);const c=transcriptConversation(data);
    assert.equal(c.messages[1].media?.provider,'account');
    assert.equal(c.messages[3].media?.provider,'fal');assert.equal(c.messages[3].media?.kind,kind);
    assert.equal(c.messages[3].media?.url,'/api/gemini/assets/saved-asset');
    assert.equal(JSON.stringify(data),before);
  }
});
