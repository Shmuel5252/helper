type Compressor=(file:File)=>Promise<{full:string;thumb:string}>;
export async function prepareAttachment(file:File,compress:Compressor=async f=>(await import('./imageProcess')).prepareImage(f)):Promise<File>{
  const image=file.type.startsWith('image/')||/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name);
  const heic=/hei[cf]/i.test(file.type)||/\.hei[cf]$/i.test(file.name);
  if(file.size>30*1024*1024)throw new Error('התמונה גדולה מדי. אפשר לבחור תמונה עד 30MB.');
  if(file.size<=4_000_000&&!heic)return file;
  if(!image)throw new Error(`הקובץ "${file.name}" גדול מ־4 מגה־בייט. בחרו גרסה קטנה יותר.`);
  const {full}=await compress(file);
  const blob=await (await fetch(full)).blob();
  if(!blob.size||blob.size>4_000_000||blob.type!=='image/jpeg')throw new Error('לא הצלחנו להקטין את התמונה. בחרו תמונה אחרת.');
  return new File([blob],file.name.replace(/\.[^.]+$/,'')+'.jpg',{type:'image/jpeg',lastModified:file.lastModified});
}
