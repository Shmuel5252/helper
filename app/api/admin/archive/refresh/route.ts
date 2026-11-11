import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/openart/admin';
import { sameOrigin } from '@/lib/archive/identity';
import { turnsFor } from '@/lib/archive/store';
import { refreshTurn } from '@/lib/archive/service';
import { ArchiveError, uuid } from '@/lib/archive/validation';
import { failure } from '@/lib/archive/http';
export const maxDuration=60;
export async function POST(request:Request){
  const denied=await requireAdmin();if(denied)return denied;
  try {
    sameOrigin(request);const form=await request.formData();const id=form.get('id');
    if(!uuid(id))throw new ArchiveError('שיחה לא נמצאה.',404);
    const pending=(await turnsFor(id)).filter(t=>['starting','running'].includes(t.status));
    await Promise.all(pending.map(refreshTurn));
    return NextResponse.redirect(new URL(`/admin/archive?id=${id}`,request.url),303);
  }catch(e){return failure(e);}
}
