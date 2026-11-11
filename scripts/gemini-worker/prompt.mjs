const videoInstruction='Create a video using the video generation tool. Follow the description below:\n\n';

// Keep the archived/user-visible input untouched. An explicit tool instruction
// makes Hebrew descriptions route to video generation in the connected account.
export function generationPrompt(job){
  const text=job.text || (job.kind==='video'?'Create a video from the attached image.':'ערוך את התמונה המצורפת.');
  if(job.kind==='video'&&/[\u0590-\u05ff]/u.test(text)&&!text.startsWith(videoInstruction))return videoInstruction+text;
  return text;
}
