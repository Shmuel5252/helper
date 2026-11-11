import 'server-only';
import { assetsFor, conversation, db, turnsFor } from './store';
import { ArchiveError, modelFor } from './validation';
import type { ArchiveTurn, TurnInput } from './types';
import { enqueueBrowser, refreshBrowser } from './browser-jobs';
import {falSelected,startFal,refreshFal} from './fal-jobs';

export async function findTurn(id:string) {
  const rows=await db<ArchiveTurn[]>('archive_turns',`id=eq.${id}&limit=1`);
  if(!rows[0])throw new ArchiveError('הבקשה לא נמצאה.',404);
  return rows[0];
}
export async function refreshTurn(turn:ArchiveTurn):Promise<ArchiveTurn> {
  if(turn.model_key.startsWith('chat:'))return turn;
  if(modelFor(turn.model_key)?.provider==='fal')return refreshFal(turn);
  if(modelFor(turn.model_key)?.provider==='account')return refreshBrowser(turn);
  if(!['starting','running'].includes(turn.status))return turn;
  // Retire legacy API polling locally. Preserve history and never contact Google.
  const rows=await db<ArchiveTurn[]>('archive_turns',`id=eq.${turn.id}&status=in.(starting,running)`,'PATCH',{
    status:'failed',checked_at:new Date().toISOString(),
  });
  return rows[0]??await findTurn(turn.id);
}
export async function startTurn(owner:string,input:TurnInput):Promise<ArchiveTurn> {
  if(modelFor(input.modelKey)?.provider==='fal'){
    await conversation(input.conversationId,owner);
    return startFal(owner,input);
  }
  if(falSelected())throw new ArchiveError('שירות היצירה עודכן. רעננו את הדף לפני שליחה.',409);
  if(modelFor(input.modelKey)?.provider!=='account')throw new ArchiveError('האפשרות הזו אינה זמינה. בחרו יצירה דרך חשבון Gemini.');
  await conversation(input.conversationId,owner);
  return enqueueBrowser(owner,input);
}

export async function transcript(id:string,owner?:string) {
  const c=await conversation(id,owner);
  const turns=await turnsFor(id);
  const assets=await assetsFor(id);
  const {owner:ignored,...publicConversation}=c; void ignored;
  return {conversation:publicConversation,turns:turns.map(t=>({...t,provider_id:null,input_hash:''})),assets:assets.map(a=>({...a,extracted_text:undefined}))};
}
