// Playwright assigns popup downloads to their opener. Correlate that page-scoped
// event with browser download GUIDs; a popup's frame ID is not the main frame ID.
export function captureDownload(cdp,page,button,timeout=120000){
 return new Promise((resolve,reject)=>{
  let expected;
  const downloads=new Map();
  const cleanup=()=>{clearTimeout(timer);page.off('download',fromPage);cdp.off('Browser.downloadWillBegin',begin);cdp.off('Browser.downloadProgress',progress);};
  const check=()=>{
   if(!expected)return;
   const matches=[...downloads.values()].filter(d=>d.url===expected.url()&&d.suggestedFilename===expected.suggestedFilename());
   if(matches.length>1){cleanup();reject(Error('ambiguous-download'));return;}
   const match=matches[0];
   if(match?.state==='completed'){cleanup();resolve(match.guid);}
   else if(match?.state==='canceled'){cleanup();reject(Error('download-canceled'));}
  };
  const fromPage=d=>{if(!expected)expected=d;check();};
  const begin=e=>{downloads.set(e.guid,e);check();};
  const progress=e=>{const d=downloads.get(e.guid);if(d){d.state=e.state;check();}};
  const timer=setTimeout(()=>{cleanup();reject(Error('download-timeout'));},timeout);
  page.on('download',fromPage);cdp.on('Browser.downloadWillBegin',begin);cdp.on('Browser.downloadProgress',progress);
  button.click().catch(e=>{cleanup();reject(e);});
 });
}
