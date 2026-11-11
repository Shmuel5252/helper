export type ArchiveModel = { key: string; label: string; model: string; kind: 'chat' | 'image' | 'video'; provider?: 'account'|'fal' };
export type ArchiveConversation = { id: string; owner: string; title: string; created_at: string; updated_at: string };
export type ArchiveAsset = { id: string; conversation_id: string; name: string; mime: string; size: number; extracted_text?: string | null };
export type ArchiveOutput = { type: 'text'; text: string } | { type: 'image' | 'video'; assetId: string };
export type ArchiveTurn = {
  id: string; conversation_id: string; sequence: number; model_key: string; input: string; assets: string[];
  status: 'starting' | 'running' | 'completed' | 'failed' | 'uncertain';
  provider_id: string | null; input_hash: string; output: ArchiveOutput[]; error: string | null;
  created_at: string; checked_at: string;
};
export type ArchiveTranscript = { conversation: Omit<ArchiveConversation, 'owner'>; turns: ArchiveTurn[]; assets: ArchiveAsset[] };
export type TurnInput = { id: string; conversationId: string; modelKey: string; text: string; assets: string[]; confirmed?: boolean };
