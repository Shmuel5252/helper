import {APIConnectionError} from 'openai';
import type {ModelEntry} from './models.ts';

type PlannerFailure={modelKey:string;status?:number;error:string;willRetry:boolean};

function failureInfo(model:ModelEntry,error:unknown,willRetry:boolean):PlannerFailure{
  const rawStatus=error&&typeof error==='object'&&'status' in error?error.status:undefined;
  const status=typeof rawStatus==='number'&&Number.isInteger(rawStatus)?rawStatus:undefined;
  const name=error instanceof Error&&/^[A-Za-z0-9_]{1,64}$/.test(error.name)?error.name:'Unknown';
  return {modelKey:model.key,...(status===undefined?{}:{status}),error:name,willRetry};
}

// Automatic planning is independent of a browser's saved chat-model selection.
// The caller enforces each timeout and validates the returned plan before enqueueing.
export async function requestAutomaticImagePlan<T>(
  models:ModelEntry[],
  request:(model:ModelEntry,timeoutMs:number)=>Promise<T>,
  onFailure?:(info:PlannerFailure)=>void,
):Promise<T>{
  const first=models[0];
  if(!first)throw new Error('Image planner model is not configured');
  const alternate=models.find(model=>model.model!==first.model);
  const deadline=Date.now()+45_000;
  try{
    return await request(first,20_000);
  }catch(error){
    const info=failureInfo(first,error,false);
    const temporary=info.status===undefined?error instanceof APIConnectionError:
      info.status===408||info.status===429||info.status>=500;
    const willRetry=!!alternate&&temporary&&Date.now()<deadline;
    onFailure?.({...info,willRetry});
    if(!willRetry||!alternate)throw error;
    const timeout=Math.min(25_000,deadline-Date.now());
    if(timeout<=0)throw error;
    try{
      return await request(alternate,timeout);
    }catch(alternateError){
      onFailure?.(failureInfo(alternate,alternateError,false));
      throw alternateError;
    }
  }
}
