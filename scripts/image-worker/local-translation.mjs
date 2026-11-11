import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {normalizeSettings,directImagePrompt} from '../../lib/realistic-image.ts';

export function translateLocally(text){
  return new Promise((resolve,reject)=>{
    const python=process.env.IMAGE_TRANSLATION_PYTHON;
    if(!python){reject(Error('Local translator is not configured'));return;}
    const child=spawn(python,[fileURLToPath(new URL('./translate-local.py',import.meta.url))],{
      stdio:['pipe','pipe','ignore'],windowsHide:true,
      // The translator needs OS paths, not the worker's cloud credentials.
      env:{...Object.fromEntries(Object.entries(process.env).filter(([key])=>[
        'PATH','SYSTEMROOT','WINDIR','TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA','PROGRAMFILES','PROGRAMFILES(X86)','COMMONPROGRAMFILES','COMSPEC',
      ].includes(key.toUpperCase()))),PYTHONIOENCODING:'utf-8'},
    });
    let output='';
    const timer=setTimeout(()=>{child.kill();reject(Error('Local translation timed out'));},90000);
    child.on('error',()=>{clearTimeout(timer);reject(Error('Local translator could not start'));});
    child.stdin.on('error',()=>{});
    child.stdout.on('data',chunk=>{output+=chunk.toString('utf8');if(output.length>20000){child.kill();}});
    child.on('close',code=>{
      clearTimeout(timer);
      try{
        if(code!==0)throw Error();
        const result=JSON.parse(output);
        if(result.offline!==true||result.network_attempts!==0||typeof result.text!=='string')throw Error();
        resolve(result.text);
      }catch{reject(Error('Local translation failed; no cloud fallback'));}
    });
    child.stdin.end(JSON.stringify({text}));
  });
}

export async function prepareImageSettings(raw,translate=translateLocally){
  const settings=normalizeSettings(raw);
  if(settings.promptMode!=='local-translate')return settings;
  const source=settings.prompt;
  const text=/[\u0590-\u05ff]/u.test(source)?await translate(source):source;
  if(typeof text!=='string'||!text.trim()||/[\u0590-\u05ff]/u.test(text))throw Error('Invalid local translation');
  return normalizeSettings({...settings,prompt:directImagePrompt(text,source+' '+text)});
}
