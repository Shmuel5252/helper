// Coalesce focus/visibility events during a request. Never overlap reads or retry submissions.
export function watchUpdates(load:()=>Promise<void>,win:EventTarget,doc:EventTarget&{visibilityState:string},interval=5000){
  let stopped=false,running=false,again=false;
  let timer:ReturnType<typeof setTimeout>|undefined;
  async function refresh(){
    if(stopped)return;
    if(running){again=true;return;}
    clearTimeout(timer);running=true;
    try{await load();}finally{
      running=false;
      if(!stopped){if(again){again=false;void refresh();}else timer=setTimeout(refresh,interval);}
    }
  }
  const wake=()=>{if(doc.visibilityState==='visible')void refresh();};
  win.addEventListener('focus',wake);doc.addEventListener('visibilitychange',wake);
  void refresh();
  return ()=>{stopped=true;clearTimeout(timer);win.removeEventListener('focus',wake);doc.removeEventListener('visibilitychange',wake);};
}
