import { ArchiveError } from './validation';
export const json = (body:unknown, status=200) => Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
export function failure(e:unknown) {
  if (e instanceof ArchiveError) return json({error:e.message},e.status);
  console.error('Archive request failed',e instanceof Error?e.name:'unknown');
  return json({error:'הפעולה לא הושלמה. נסו שוב בעוד רגע.'},500);
}
export async function smallJson(request:Request) {
  const raw=await request.text();
  if (raw.length>32_000) throw new ArchiveError('הבקשה גדולה מדי.',413);
  try { return JSON.parse(raw); } catch { throw new ArchiveError('בקשה לא תקינה.'); }
}
