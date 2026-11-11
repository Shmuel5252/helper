import { MessageCircle } from 'lucide-react';

export default function ChatModeSwitch({active}:{active:'free'|'gemini'}){
  void active;
  return <div className="flex items-center gap-2 px-3 text-[15px]"><MessageCircle size={16} aria-hidden/><span>צ׳אט</span></div>;
}
