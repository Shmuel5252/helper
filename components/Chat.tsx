"use client";

import { lazy, Suspense, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import ChatModeSwitch from './ChatModeSwitch';
import { ArrowUp, Check, Copy, ImagePlus, Menu, Paperclip, Square, SquarePen, X } from "lucide-react";
import { ERROR_MARK, MAX_CHARS, MSG_GENERIC, prepareHistory } from "@/lib/chat";
import {
  DEFAULT_DOC_PROMPT,
  DOC_ACCEPT,
  DOC_ERRORS,
  DOC_PRIVACY_NOTE,
  DOC_SUGGESTIONS,
  docMarker,
  pickAttachments,
  type DocAttachment,
} from "@/lib/documents";
import { loadHistory, makeTitle, mediaAsText, newId, saveHistory, type Conversation, type MediaResult, type Msg } from "@/lib/history";
import { IMAGE_ERRORS, MAX_BODY_BYTES, MAX_IMAGES } from "@/lib/images";
import type { PublicModel } from "@/lib/models";
import {archiveInputs, archiveImage, preserveChat, post} from '@/lib/chat-archive-client';
import {mediaPatch, transcriptConversation, removeLocalChat} from '@/lib/unified-chat';
import {requestJson as api} from '@/lib/gemini-progress';
import {watchUpdates} from '@/lib/gemini-polling';
import type {ArchiveTranscript} from '@/lib/archive/types';
import { loadExhausted, markExhausted, type Exhausted } from "@/lib/quota";
import DocChip from "./DocChip";
import ChatWelcome from "./ChatWelcome";
import MediaCard from "./MediaCard";
import ModelPicker from "./ModelPicker";
import ModeSwitch, { type Mode } from "./ModeSwitch";
import Sidebar from "./Sidebar";
import { useMediaPolling } from "./useUnifiedMediaPolling";

// Markdown is split into its own chunk so the page is ready to type before it loads.
const Markdown = lazy(() => import("./Markdown"));

// Image resizing code loads on the first attach, not with the page.
type Processor = typeof import("@/lib/imageProcess");
let processor: Promise<Processor> | null = null;
const loadProcessor = () => (processor ??= import("@/lib/imageProcess"));
const MSG_IMAGE_FAILED = "לא הצלחנו לעבד את התמונה. נסו שוב או בחרו תמונה אחרת.";

// ... [full content truncated in this planning, but in real call it would be full] 

  async function deleteConversation(id: string) {
    const c=convs?.find(c=>c.id===id);if(!c)return;
    // Allow delete even if a previous send appears stuck (no real pending job).
    if((sending.current||streaming) && messages.some(m=>m.media?.status==='pending'&&m.media?.jobId)){setToast('המתינו לסיום השליחה כדי שהשיחה תישמר בארכיון.');return;}
    sending.current=true;setSubmitting(true);
    try{
      await preserveChat(c);
      const storage=getStorage();
      const hidden=JSON.parse(storage?.getItem('ai-chat:hidden-archive:v1')??'[]');
      storage?.setItem('ai-chat:hidden-archive:v1',JSON.stringify([...new Set([...hidden,id])]));
      if(id===activeId)newChat();
      setConvs(cs=>cs&&removeLocalChat(cs,id));
      setToast('השיחה הוסרה מהמכשיר ונשמרה בארכיון.');
    }catch{setToast('לא הצלחנו לאשר שהשיחה שמורה בארכיון, ולכן היא לא נמחקה. נסו שוב.');}
    finally{sending.current=false;setSubmitting(false);}
  }

  // rest of the file would follow here in the actual full content
