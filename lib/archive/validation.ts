import type { ArchiveModel, TurnInput } from './types.ts';

export const ARCHIVE_MODELS: ArchiveModel[] = [
  {key:'account-image', label:'Gemini · יצירת תמונה', model:'website', kind:'image', provider:'account'},
  {key:'account-video', label:'Gemini · יצירת סרטון', model:'website', kind:'video', provider:'account'},
  {key:'fal-image-v1',label:'יצירת תמונה',model:'fal-ai/flux-2/klein/4b',kind:'image',provider:'fal'},
  {key:'fal-video-v1',label:'יצירת סרטון',model:'minimax/h3-max-turbo',kind:'video',provider:'fal'},
];
export const modelFor = (key: unknown) => ARCHIVE_MODELS.find(m => m.key === key);
export const uuid = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
export class ArchiveError extends Error {
  status: number;
  constructor(message: string, status=400) { super(message); this.status=status; }
}
export function parseTurn(value: unknown): TurnInput {
  const x = value as Partial<TurnInput> | null;
  const model = modelFor(x?.modelKey);
  if (!x || !uuid(x.id) || !uuid(x.conversationId) || !model || typeof x.text !== 'string' || x.text.length > 4000 ||
    !Array.isArray(x.assets) || x.assets.length > 4 || !x.assets.every(uuid) || new Set(x.assets).size !== x.assets.length ||
    (!x.text.trim() && !x.assets.length)) throw new ArchiveError('הבקשה אינה תקינה. בדקו את ההודעה והקבצים.');
  return {...x, text:x.text.trim()} as TurnInput;
}
