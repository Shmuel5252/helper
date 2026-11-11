import type {ArchiveTurn,ArchiveAsset,TurnInput} from './archive/types';
export type RetryAttempt={sourceId:string;input:TurnInput};
export function canRetry(turn:ArchiveTurn){return ['failed','uncertain'].includes(turn.status)&&['account-image','account-video'].includes(turn.model_key);}
export function buildRetry(turn:ArchiveTurn,assets:ArchiveAsset[],previous:RetryAttempt|null=null,newId:()=>string=()=>crypto.randomUUID()):RetryAttempt{
  if(!canRetry(turn))throw new Error('אפשר לשלוח מחדש רק בקשה שנעצרה.');
  if(turn.assets.some(id=>!assets.some(a=>a.id===id&&a.conversation_id===turn.conversation_id)))throw new Error('אחד הקבצים המקוריים אינו זמין. צרפו אותו בבקשה חדשה.');
  if(previous?.sourceId===turn.id&&previous.input.conversationId===turn.conversation_id&&previous.input.modelKey===turn.model_key&&previous.input.text===turn.input&&JSON.stringify(previous.input.assets)===JSON.stringify(turn.assets))return previous;
  const id=newId();if(id===turn.id)throw new Error('נדרש מזהה חדש לשליחה חוזרת.');
  return {sourceId:turn.id,input:{id,conversationId:turn.conversation_id,modelKey:turn.model_key,text:turn.input,assets:[...turn.assets]}};
}
