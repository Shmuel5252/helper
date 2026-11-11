import { randomUUID } from 'node:crypto';
import { deviceOwner, sameOrigin } from '@/lib/archive/identity';
import { conversation, putAsset } from '@/lib/archive/store';
import { failure, json } from '@/lib/archive/http';
import { ArchiveError, uuid } from '@/lib/archive/validation';
import { docType } from '@/lib/documents';
import { parseDocument, ParseError } from '@/lib/parseDocument';
import type { ArchiveAsset } from '@/lib/archive/types';
export const maxDuration=60;
const DOC_MIME={pdf:'application/pdf',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',txt:'text/plain',md:'text/markdown',csv:'text/csv'};
export async function POST(request:Request) {
  try {
    sameOrigin(request);
    if(Number(request.headers.get('content-length'))>4_100_000)throw new ArchiveError('אפשר לצרף קובץ של עד 4MB.',413);
    const form=await request.formData(); const file=form.get('file'); const id=form.get('conversationId');
    if(!uuid(id)||!(file instanceof File)||!file.size||file.size>4_000_000)throw new ArchiveError('בחרו קובץ תקין של עד 4MB.');
    await conversation(id,await deviceOwner());
    const bytes=Buffer.from(await file.arrayBuffer());
    let mime=''; let text:string|undefined;
    if(bytes[0]===0xff && bytes[1]===0xd8 && bytes[2]===0xff)mime='image/jpeg';
    else if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))mime='image/png';
    else if(bytes.toString('ascii',0,4)==='RIFF' && bytes.toString('ascii',8,12)==='WEBP')mime='image/webp';
    else if(bytes.length>12&&bytes.toString('ascii',4,8)==='ftyp')mime='video/mp4';
    else {
      const type=docType(file.name,file.type);
      if(!type)throw new ArchiveError('אפשר לצרף JPEG, PNG, WebP, PDF, DOCX או מסמך טקסט.');
      try {text=(await parseDocument(type,bytes)).text;}catch(e){throw new ArchiveError(e instanceof ParseError?e.message:'לא הצלחנו לקרוא את המסמך.');}
      mime=DOC_MIME[type];
    }
    const asset:ArchiveAsset={id:randomUUID(),conversation_id:id,name:file.name.replace(/[\r\n\u0000]/g,'').slice(0,200)||'file',mime,size:bytes.length,...(text?{extracted_text:text}:{})};
    await putAsset(asset,bytes);
    return json({...asset,extracted_text:undefined});
  }catch(e){return failure(e);}
}
