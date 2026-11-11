import 'server-only';
import { ArchiveError } from './validation';
import type { ArchiveAsset, ArchiveConversation, ArchiveTurn } from './types';

export const BUCKET = 'chat-archive';
export const archiveConfigured = () => !!(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);
export async function supabase(path: string, init: RequestInit = {}): Promise<Response> {
  if (!archiveConfigured()) throw new ArchiveError('לא הצלחנו לשלוח, נסו שוב מאוחר יותר.',503);
  const headers = new Headers(init.headers);
  headers.set('apikey',process.env.SUPABASE_SECRET_KEY!);
  headers.set('User-Agent','ai-chat-server/1.0');
  const response = await fetch(`${process.env.SUPABASE_URL!.replace(/\/$/,'')}${path}`,{
    ...init, headers, cache:'no-store', signal:init.signal ?? AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    // Do not log bodies, credentials, filenames or user content.
    console.error('Archive storage request failed', response.status, path.split('?')[0].split('/').slice(0,3).join('/'));
    throw new ArchiveError('לא הצלחנו להשלים את הפעולה, נסו שוב.', response.status===409?409:503);
  }
  return response;
}
export async function db<T>(table: string, query='', method='GET', body?: unknown, prefer?: string): Promise<T> {
  const response = await supabase(`/rest/v1/${table}${query?'?'+query:''}`, {
    method, headers:{'Content-Type':'application/json', Prefer:prefer??'return=representation'},
    ...(body===undefined?{}:{body:JSON.stringify(body)}),
  });
  const text = await response.text();
  return (text?JSON.parse(text):null) as T;
}
export async function conversation(id:string, owner?: string): Promise<ArchiveConversation> {
  const rows = await db<ArchiveConversation[]>('archive_conversations',`id=eq.${id}${owner?`&owner=eq.${owner}`:''}&limit=1`);
  if (!rows[0]) throw new ArchiveError('השיחה לא נמצאה במכשיר הזה.',404);
  return rows[0];
}
async function allRows<T>(table:string,query:string):Promise<T[]> {
  const result:T[]=[];
  for(let offset=0;;offset+=200){
    const page=await db<T[]>(table,`${query}&limit=200&offset=${offset}`);
    result.push(...page);if(page.length<200)return result;
  }
}
export const turnsFor = (id:string) => allRows<ArchiveTurn>('archive_turns',`conversation_id=eq.${id}&order=sequence.asc`);
export const assetsFor = (id:string) => allRows<ArchiveAsset>('archive_assets',`conversation_id=eq.${id}&order=created_at.asc,id.asc`);
export const patchTurn = (id:string, fields: Partial<ArchiveTurn>) => db<ArchiveTurn[]>('archive_turns',`id=eq.${id}`,'PATCH',fields);
export const assetPath = (asset: Pick<ArchiveAsset,'id'|'conversation_id'>) => `${asset.conversation_id}/${asset.id}`;
export async function putAsset(asset: ArchiveAsset, bytes: Uint8Array) {
  // Immutable/deterministic IDs make repeated completion polls safe to replay.
  await supabase(`/storage/v1/object/${BUCKET}/${assetPath(asset)}`,{
    method:'POST', headers:{'Content-Type':asset.mime,'x-upsert':'true'}, body:Buffer.from(bytes),
  });
  try {
    await db('archive_assets','on_conflict=id','POST',asset,'resolution=merge-duplicates,return=minimal');
  } catch(error) {
    // An upload may have started before an owner deleted the conversation.
    // Record its late object in a fresh durable cleanup job; never discard paths.
    const deleted=await db<{id:string}[]>('archive_deleted_conversations',`id=eq.${asset.conversation_id}&limit=1`).catch(()=>[]);
    if(deleted.length)await db('archive_deletions','on_conflict=id','POST',{id:asset.id,paths:[assetPath(asset)]},'resolution=ignore-duplicates,return=minimal');
    throw error;
  }
}
export async function getAssetBytes(asset: ArchiveAsset): Promise<Buffer> {
  const response = await supabase(`/storage/v1/object/${BUCKET}/${assetPath(asset)}`);
  return Buffer.from(await response.arrayBuffer());
}
