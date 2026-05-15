"use client"

import React, { useEffect, useMemo, useState } from 'react';
import { Search, Info, Send, Paperclip, AlignLeft, Bold, Italic, Smile, X, Play, Loader2, Image as ImageIcon, ChevronLeft, MessageSquare } from 'lucide-react';
import axios from 'axios';
import Image from 'next/image';
import api from '@/src/lib/api';
import toast from 'react-hot-toast';
import DashboardSidebar from '@/src/components/UserDashboard/DashboardSidebar';
import MessageBubble from '@/src/components/UserDashboard/Messages/MessageBubble';
import { ReportModal } from '@/Moderation/components/ReportModal';
import type { Status as MessageStatusType } from '@/src/components/UserDashboard/Messages/MessageStatus';
import { useConversationKey } from '@/src/hooks/useConversationKey';
import { encryptMessage, decryptMessage } from '@/src/lib/encryption';
import { useAuthStore } from '@/src/store/useAuthStore';
import { useIsMounted } from '@/src/hooks/useIsMounted';
import Lightbox from 'yet-another-react-lightbox';
import Video from 'yet-another-react-lightbox/plugins/video';
import 'yet-another-react-lightbox/styles.css';

const DEFAULT_AVATAR = '/assets/dashboard/avatar1.png';
const EMOJI_PICKER_OPTIONS = [
  '😀', '😁', '😂', '🤣', '😊', '😍', '😘', '😎',
  '🤔', '😴', '🥳', '😇', '😭', '😡', '👍', '👎',
  '👏', '🙌', '🙏', '💪', '🔥', '✨', '🎉', '❤️',
  '💛', '💚', '💙', '💜', '🤍', '🖤', '💯', '✅'
];

const getAvatarUrl = (profile: any) => profile?.avatar || DEFAULT_AVATAR;

const getLastMessagePreview = (message: any) => {
  if (!message) return 'No messages yet';
  if (message.isDeleted) return 'This message was deleted';
  if (message.text) return stripHtmlToPlainText(message.text);
  if (message.isEncrypted) return 'Encrypted message';
  return 'Media message';
};

const stripHtmlToPlainText = (value: string) => value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

const getParticipantId = (participant: any): string => {
  if (!participant) return '';
  if (typeof participant === 'string') return participant;
  if (participant._id) return participant._id.toString();
  return '';
};

type ReplyingToState = {
  messageId: string;
  text: string;
  senderName: string;
  mediaType?: string;
  mediaUrl?: string;
};

export default function UserMessagesPage() {
  const isMounted = useIsMounted();
  const [conversations, setConversations] = useState<any[]>([]);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [isBlocked, setIsBlocked] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [hasContent, setHasContent] = useState(false);
  const [isBoldActive, setIsBoldActive] = useState(false);
  const [isItalicActive, setIsItalicActive] = useState(false);
  const [messageStatuses, setMessageStatuses] = useState<Record<string, MessageStatusType>>({});
  const [replyingTo, setReplyingTo] = useState<ReplyingToState | null>(null);
  const [mediaPreview, setMediaPreview] = useState<{
    file: File;
    previewUrl: string;
    type: 'image' | 'video';
  } | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxSlides, setLightboxSlides] = useState<any[]>([]);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [reportTargetMessageId, setReportTargetMessageId] = useState<string | null>(null);
  const [messagingEnabled, setMessagingEnabled] = useState<boolean | null>(null);
  const token = useAuthStore((state) => state.token);

  const convKey = useConversationKey(selectedChatId);

  const markConversationSeen = async (conversationId: string) => {
    if (!conversationId) {
      return;
    }

    try {
      await api.put(`/user/messages/seen/${conversationId}`);
    } catch {
      // Avoid noisy console errors for transient seen-state failures.
    }
  };

  const fetchMessages = async () => {
    if (typeof window === 'undefined') {
      return;
    }

    const storedToken = localStorage.getItem('token');
    if (!token && !storedToken) {
      setConversations([]);
      setMessages([]);
      setSelectedChatId(null);
      setCurrentUser(null);
      return;
    }

    try {
      const [messagesRes, userRes] = await Promise.all([
        api.get('/user/messages'),
        api.get('/auth/profile')
      ]);
      
      const currentUserId = userRes.data._id;
      setCurrentUser(userRes.data);
      
      const grouped = messagesRes.data.reduce((acc: any, msg: any) => {
        if (!acc[msg.conversationId]) acc[msg.conversationId] = [];
        acc[msg.conversationId].push(msg);
        return acc;
      }, {});

      const participantId = (party: any) => {
        if (!party) return '';
        if (typeof party === 'string') return party;
        return String(party._id || party.id || '');
      };

      const chatList = Object.keys(grouped).map((id) => {
          const firstMsg = grouped[id][0];
          const senderId = participantId(firstMsg.sender);
          const isSenderMe = senderId === String(currentUserId);
          const participant = isSenderMe ? firstMsg.recipient : firstMsg.sender;
          return { id, messages: grouped[id], lastMessage: firstMsg, participant };
      });

      setConversations(chatList);
      const nextSelectedChatId = selectedChatId && chatList.some((chat: any) => chat.id === selectedChatId)
        ? selectedChatId
        : (chatList[0]?.id || null);

      setSelectedChatId(nextSelectedChatId);
      if (nextSelectedChatId) {
        const activeChat = chatList.find((chat: any) => chat.id === nextSelectedChatId);
        setMessages(activeChat ? activeChat.messages : []);
        void markConversationSeen(nextSelectedChatId);
      } else {
        setMessages([]);
      }
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 401) {
        setConversations([]);
        setMessages([]);
        setSelectedChatId(null);
        setCurrentUser(null);
        return;
      }

      console.error("Error fetching messages:", err);
    }
  };

  useEffect(() => {
    let mounted = true;

    api.get('/user/features')
      .then((res) => {
        if (!mounted) return;
        setMessagingEnabled(res?.data?.toggles?.messaging !== false);
      })
      .catch(() => {
        if (mounted) setMessagingEnabled(true);
      });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (messagingEnabled === true) {
      fetchMessages();
    }
  }, [token, messagingEnabled]);

  const activeConversation = useMemo(
    () => conversations.find((c: any) => c.id === selectedChatId),
    [conversations, selectedChatId]
  );

  useEffect(() => {
    setReplyingTo(null);
    setMediaPreview((prev) => {
      if (prev) {
        URL.revokeObjectURL(prev.previewUrl);
      }
      return null;
    });
  }, [selectedChatId]);

  useEffect(() => {
    if (!activeConversation?.participant?._id) {
      setIsBlocked(false);
      return;
    }

    api.get(`/user/block/${activeConversation.participant._id}`)
      .then((res) => setIsBlocked(res.data.isBlocked))
      .catch(() => setIsBlocked(false));
  }, [activeConversation?.participant?._id]);

  const handleSendMessage = async (
    retryText?: string | any,
    retryReplyTo?: ReplyingToState | null,
    retryMedia?: { mediaUrl?: string; mediaType?: 'image' | 'video'; thumbnailUrl?: string } | null
  ) => {
    const editorText = editorRef.current?.innerText.trim() || '';
    const editorHtml = editorRef.current?.innerHTML || '';
    const actualRetryText = typeof retryText === 'string' ? retryText : undefined;
    const text = (actualRetryText ?? editorHtml).trim();
    const hasTextContent = actualRetryText !== undefined
      ? Boolean(actualRetryText.trim())
      : Boolean(editorText);
    if ((!hasTextContent && !mediaPreview && !retryMedia?.mediaUrl) || !selectedChatId || isBlocked) return;
    const activeReply = retryReplyTo ?? replyingTo;

    const currentChat = conversations.find((c: any) => c.id === selectedChatId);
    if (!currentChat) return;

    const participantId = getParticipantId(currentChat.participant);
    const currentUserId = currentUser?._id?.toString() || '';
    let fallbackRecipientFromMessages = '';

    for (const msg of currentChat.messages || []) {
      const senderId = getParticipantId(msg.sender);
      const recipientFromMsg = getParticipantId(msg.recipient);

      if (currentUserId && senderId === currentUserId && recipientFromMsg) {
        fallbackRecipientFromMessages = recipientFromMsg;
        break;
      }

      if (currentUserId && recipientFromMsg === currentUserId && senderId) {
        fallbackRecipientFromMessages = senderId;
        break;
      }
    }

    const fallbackRecipientId = selectedChatId
      .split('_')
      .find((id: string) => id && id !== currentUserId) || '';
    const recipientId = participantId || fallbackRecipientFromMessages || fallbackRecipientId;

    if (!recipientId) {
      toast.error('Unable to resolve recipient for this conversation');
      return;
    }

    let mediaUrl = retryMedia?.mediaUrl || '';
    let mediaType = retryMedia?.mediaType || '';
    let thumbnailUrl = retryMedia?.thumbnailUrl || '';

    // Upload media first if present
    if (mediaPreview && !retryMedia?.mediaUrl) {
      setIsUploading(true);
      try {
        const formData = new FormData();
        formData.append('media', mediaPreview.file);

        const uploadRes = await api.post('/user/messages/upload-media', formData, {
          headers: { 'Content-Type': 'multipart/form-data' }
        });

        mediaUrl = uploadRes.data.mediaUrl;
        mediaType = uploadRes.data.mediaType;
        thumbnailUrl = uploadRes.data.thumbnailUrl || '';
      } catch {
        toast.error('Failed to upload media');
        setIsUploading(false);
        return;
      } finally {
        setIsUploading(false);
      }
    }

    const tempId = `temp_${Date.now()}`;
    const optimisticMessage = {
      _id: tempId,
      conversationId: selectedChatId,
      sender: { _id: currentUser?._id, name: currentUser?.name, avatar: currentUser?.avatar },
      recipient: recipientId,
      text,
      mediaUrl,
      mediaType,
      thumbnailUrl,
      ...(activeReply ? { replyTo: activeReply } : {}),
      createdAt: new Date().toISOString(),
      status: 'sending' as MessageStatusType,
      isOptimistic: true,
      reactions: []
    };

    setMessages((prev) => [optimisticMessage, ...prev]);
    setMessageStatuses((prev) => ({ ...prev, [tempId]: 'sending' }));

    if (!retryText) {
      if (editorRef.current) {
        editorRef.current.innerHTML = '';
      }
      setNewMessage('');
      setHasContent(false);
      setIsBoldActive(false);
      setIsItalicActive(false);
    }

    if (mediaPreview && !retryMedia?.mediaUrl) {
      URL.revokeObjectURL(mediaPreview.previewUrl);
      setMediaPreview(null);
    }

    setShowEmojiPicker(false);

    try {
      let payload: any = {
        recipientId,
        text,
        ...(mediaUrl ? { mediaUrl } : {}),
        ...(mediaType ? { mediaType } : {}),
        ...(thumbnailUrl ? { thumbnailUrl } : {}),
        ...(activeReply ? { replyTo: activeReply } : {})
      };

      if (convKey && text) {
        try {
          const { encryptedText, nonce } = encryptMessage(text, convKey);
          payload = {
            ...payload,
            text: '',
            encryptedText,
            nonce,
            isEncrypted: true
          };
        } catch (encryptionError) {
          console.error('Encryption failed, sending plaintext fallback', encryptionError);
        }
      }

      const res = await api.post('/user/messages', payload);
      setMessages((prev) => prev.map((message) => (
        (message._id || message.id) === tempId
          ? {
              ...res.data,
              sender: res.data.sender || currentUser?._id,
              recipient: res.data.recipient || recipientId,
              reactions: res.data.reactions || []
            }
          : message
      )));
      setMessageStatuses((prev) => {
        const next = { ...prev };
        delete next[tempId];
        return next;
      });
      setReplyingTo(null);
      fetchMessages();
    } catch (err: any) {
      setMessageStatuses((prev) => ({ ...prev, [tempId]: 'failed' }));
      setMessages((prev) => prev.map((message) => (
        (message._id || message.id) === tempId
          ? { ...message, status: 'failed' as MessageStatusType }
          : message
      )));
      toast.error(err?.response?.data?.error || err?.response?.data?.message || err?.message || 'Failed to send');
    }
  };

  const retrySend = (message: any) => {
    const retryValue = (message?.text || '').trim();
    const hasMedia = Boolean(message?.mediaUrl);
    const retryId = message?._id || message?.id;

    if ((!retryValue && !hasMedia) || !retryId) {
      return;
    }

    setMessages((prev) => prev.filter((m) => (m._id || m.id) !== retryId));
    setMessageStatuses((prev) => {
      const next = { ...prev };
      delete next[retryId];
      return next;
    });

    const retryReply = message?.replyTo
      ? {
          messageId: message.replyTo.messageId,
          text: message.replyTo.text,
          senderName: message.replyTo.senderName,
          mediaType: message.replyTo.mediaType,
          mediaUrl: message.replyTo.mediaUrl
        }
      : null;

    const retryMedia = hasMedia
      ? {
          mediaUrl: message.mediaUrl,
          mediaType: message.mediaType,
          thumbnailUrl: message.thumbnailUrl || ''
        }
      : null;

    void handleSendMessage(retryValue, retryReply, retryMedia);
  };

  const handleDeleteMessage = async (id: string, deleteType: 'for_me' | 'for_everyone') => {
    try {
      await api.put(`/user/messages/${id}/delete`, { deleteType });

      if (deleteType === 'for_everyone') {
        setMessages((prev) => prev.map((m) => (
          m._id === id ? { ...m, isDeleted: true, text: '', encryptedText: '' } : m
        )));
      }

      if (deleteType === 'for_me') {
        setMessages((prev) => prev.filter((m) => m._id !== id));
        setMessageStatuses((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
      }

      toast.success(deleteType === 'for_everyone' ? 'Message deleted for everyone' : 'Message deleted for you');
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to delete message');
    }
  };

  const handleStartEdit = (id: string, currentText: string) => {
    setEditingMessageId(id);
    setEditText(currentText);
  };

  const handleEditMessage = async (id: string, newTextValue: string) => {
    if (!newTextValue.trim()) {
      toast.error('Message cannot be empty');
      return;
    }

    try {
      await api.put(`/user/messages/${id}/edit`, { text: newTextValue });
      setMessages((prev) => prev.map((m) => (
        m._id === id ? { ...m, text: newTextValue, isEdited: true } : m
      )));
      setEditingMessageId(null);
      setEditText('');
      toast.success('Message updated');
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to edit message');
    }
  };

  const handleReact = async (id: string, emoji: string) => {
    const currentUserId = currentUser?._id?.toString();
    if (!currentUserId) return;

    setMessages((prev) => prev.map((m) => {
      if (m._id !== id) return m;

      const reactions = Array.isArray(m.reactions) ? m.reactions : [];
      const existingUserReaction = reactions.find((reaction: any) => {
        const reactionUserId = typeof reaction.userId === 'object'
          ? reaction.userId?._id
          : reaction.userId;
        return reactionUserId?.toString() === currentUserId;
      });

      const nextReactions = existingUserReaction?.emoji === emoji
        ? reactions.filter((reaction: any) => {
            const reactionUserId = typeof reaction.userId === 'object'
              ? reaction.userId?._id
              : reaction.userId;
            return reactionUserId?.toString() !== currentUserId;
          })
        : [
            ...reactions.filter((reaction: any) => {
              const reactionUserId = typeof reaction.userId === 'object'
                ? reaction.userId?._id
                : reaction.userId;
              return reactionUserId?.toString() !== currentUserId;
            }),
            { userId: currentUserId, emoji }
          ];

      return { ...m, reactions: nextReactions };
    }));

    try {
      const res = await api.post(`/user/messages/${id}/react`, { emoji });
      setMessages((prev) => prev.map((m) => (
        m._id === id ? { ...m, reactions: res.data.reactions } : m
      )));
    } catch (err: any) {
      fetchMessages();
      toast.error(err?.response?.data?.error || 'Failed to react to message');
    }
  };

  const handleBlock = async (userId: string) => {
    if (!userId) return;

    try {
      const res = await api.post(`/user/block/${userId}`);
      setIsBlocked(res.data.blocked);
      toast.success(res.data.blocked ? 'User blocked' : 'User unblocked');

      if (res.data.blocked) {
        setConversations((prev) => prev.filter((c) => c.participant?._id !== userId));
        setSelectedChatId(null);
        setMessages([]);
      } else {
        fetchMessages();
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to update block status');
    }
  };

  const handleReplyStart = (message: any) => {
    const messageId = message?._id || message?.id;
    if (!messageId) {
      return;
    }

    const resolvedDisplayText = stripHtmlToPlainText(message?.text || '');
    const senderName = message?.sender?.name
      || (message?.isSender ? (currentUser?.name || 'You') : (activeConversation?.participant?.name || 'Unknown'));

    setReplyingTo({
      messageId,
      text: resolvedDisplayText || '',
      senderName,
      mediaType: message?.mediaType,
      mediaUrl: message?.mediaUrl
    });
    editorRef.current?.focus();
  };

  const scrollToMessage = (messageId: string) => {
    const element = messageRefs.current[messageId];
    if (!element) return;

    const bubble = element.querySelector('[data-message-highlight="true"]') as HTMLElement | null;
    const target = bubble || element;

    target.scrollIntoView({ behavior: 'smooth', block: 'center' });

    const previousTransition = target.style.transition;
    const previousBoxShadow = target.style.boxShadow;

    target.style.transition = 'box-shadow 180ms ease';
    target.style.boxShadow = '0 0 0 2px rgba(249, 92, 75, 0.35)';

    setTimeout(() => {
      target.style.boxShadow = previousBoxShadow;
      target.style.transition = previousTransition;
    }, 1200);
  };

  const handleOpenLightbox = (slides: any[], index: number) => {
    setLightboxSlides(slides);
    setLightboxIndex(index);
    setLightboxOpen(true);
  };

  const handleSelectConversation = (chat: any) => {
    setSelectedChatId(chat.id);
    setMessages(chat.messages);
    setEditingMessageId(null);
    setEditText('');
    void markConversationSeen(chat.id);
  };

  const editorRef = React.useRef<HTMLDivElement>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const emojiPickerRef = React.useRef<HTMLDivElement>(null);
  const emojiButtonRef = React.useRef<HTMLButtonElement>(null);
  const messageRefs = React.useRef<Record<string, HTMLDivElement | null>>({});

  const syncFormattingState = () => {
    if (!editorRef.current) return;

    try {
      setIsBoldActive(Boolean(document.queryCommandState('bold')));
      setIsItalicActive(Boolean(document.queryCommandState('italic')));
    } catch {
      setIsBoldActive(false);
      setIsItalicActive(false);
    }
  };

  const applyFormat = (command: 'insertUnorderedList' | 'italic' | 'bold') => {
    if (document.activeElement !== editorRef.current) {
      editorRef.current?.focus();
    }
    document.execCommand(command);
    const html = editorRef.current?.innerHTML || '';
    const text = editorRef.current?.innerText.trim() || '';
    setNewMessage(html);
    setHasContent(Boolean(text));
    syncFormattingState();
  };

  const insertEmoji = (emoji: string) => {
    editorRef.current?.focus();
    document.execCommand('insertText', false, emoji);
    const html = editorRef.current?.innerHTML || '';
    const text = editorRef.current?.innerText.trim() || '';
    setNewMessage(html);
    setHasContent(Boolean(text));
  };

  const handleEditorInput = () => {
    const html = editorRef.current?.innerHTML || '';
    const text = editorRef.current?.innerText.trim() || '';
    setNewMessage(html);
    setHasContent(Boolean(text));
    syncFormattingState();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape' && replyingTo) {
      e.preventDefault();
      e.stopPropagation();
      setReplyingTo(null);
      return;
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  useEffect(() => {
    if (!showEmojiPicker) {
      return;
    }

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (emojiPickerRef.current?.contains(target) || emojiButtonRef.current?.contains(target)) {
        return;
      }
      setShowEmojiPicker(false);
    };

    const handleEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowEmojiPicker(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEsc);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [showEmojiPicker]);

  const handleAttachmentClick = () => fileInputRef.current?.click();
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const isVideo = file.type.startsWith('video/');
    const isImage = file.type.startsWith('image/');

    if (!isVideo && !isImage) {
      toast.error('Only image and video files are supported');
      return;
    }

    const maxSize = isVideo ? 50 * 1024 * 1024 : 10 * 1024 * 1024;
    if (file.size > maxSize) {
      toast.error(`File too large. Max: ${isVideo ? '50MB' : '10MB'}`);
      return;
    }

    const previewUrl = URL.createObjectURL(file);
    setMediaPreview({
      file,
      previewUrl,
      type: isVideo ? 'video' : 'image'
    });

    // Reset file input so same file can be selected again
    e.target.value = '';
  };

  if (messagingEnabled === null) {
    return (
      <div className="flex h-screen bg-[#f6f4f1] overflow-hidden">
        <DashboardSidebar />
        <main className="flex-1 md:ml-60 pt-20 md:pt-0 flex items-center justify-center">
          <p className="text-[#aaa] animate-pulse">Loading...</p>
        </main>
      </div>
    );
  }

  if (messagingEnabled === false) {
    return (
      <div className="flex h-screen bg-[#f6f4f1] overflow-hidden">
        <DashboardSidebar />
        <main className="flex-1 md:ml-60 pt-20 md:pt-0 flex items-center justify-center">
          <div className="text-center px-6">
            <div className="w-16 h-16 rounded-full bg-[#f0ede9] flex items-center justify-center mx-auto mb-4">
              <MessageSquare className="w-6 h-6 text-[#aaa]" />
            </div>
            <h3 className="font-semibold text-[#1a1a1a] text-lg mb-1">Messaging Unavailable</h3>
            <p className="text-[#aaa] text-sm">Direct messaging has been disabled by the platform.</p>
          </div>
        </main>
      </div>
    );
  }

    return (
     <>
     <div className="flex h-screen bg-[#f6f4f1] overflow-hidden">
      <DashboardSidebar />
      <main className="flex-1 md:ml-60 pt-20 md:pt-0 flex overflow-hidden">
        
        {/* Sidebar - Conversation List */}
        <div className={`w-full md:w-[304px] border-r border-[#e4ded2] bg-[#faf8f5] flex flex-col h-full shrink-0 z-10 ${activeConversation ? 'hidden md:flex' : 'flex'}`}>
          <div className="px-6 pt-6 pb-4">
            <h1 className="font-[family-name:var(--font-fjalla)] text-[28px] text-[#1a1a1a] leading-none">Messages</h1>
            <div className="relative mt-4 mx-[-8px]">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[#aaa]" />
              <input type="text" placeholder="Search conversation" className="w-full bg-white border border-[#e4ded2] rounded-[20px] pl-11 pr-4 py-2 font-[family-name:var(--font-figtree)] text-[13px] text-[#5a5a5a] placeholder:text-[#aaa] focus:outline-none" />
              </div>
           </div>
           <div className="flex-1 overflow-y-auto w-full">
              {conversations.map((chat: any) => (
                <div 
                  key={chat.id} 
                  onClick={() => handleSelectConversation(chat)}
                  className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors border-b border-[#e4ded2]/60 ${selectedChatId === chat.id ? 'bg-white border-l-4 border-l-[#f95c4b]' : 'hover:bg-[#faf8f5]'}`}
                >
                   <div className="relative shrink-0 w-11 h-11 rounded-full border border-[#e4ded2] bg-[#f95c4b]/10 shadow-sm overflow-hidden">
                     <Image
                      src={getAvatarUrl(chat.participant)}
                      alt={chat.participant?.name || 'Profile'}
                      fill
                      className="object-cover"
                     />
                   </div>
                   <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-center mb-0.5">
                         <h3 className="font-[family-name:var(--font-figtree)] text-[15px] font-semibold text-[#1a1a1a] truncate">{chat.participant?.name || 'Creator'}</h3>
                         <span className="font-[family-name:var(--font-figtree)] text-[11px] text-[#aaa]">
                           {isMounted ? new Date(chat.lastMessage.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                         </span>
                      </div>
                     <p className="font-[family-name:var(--font-figtree)] text-[13px] text-[#5a5a5a] truncate">{getLastMessagePreview(chat.lastMessage)}</p>
                   </div>
                </div>
              ))}
              {conversations.length === 0 && <div className="p-10 text-center font-[family-name:var(--font-figtree)] text-[#aaa] text-[13px]">No messages yet</div>}
           </div>
        </div>

        {/* Main Chat Area */}
        <div className={`flex-1 flex-col h-full bg-[#f6f4f1] relative overflow-x-hidden ${activeConversation ? 'flex' : 'hidden md:flex'}`}>
           {activeConversation ? (
             <>
               <header className="h-[68px] bg-[#faf8f5] border-b border-[#e4ded2] flex items-center justify-between px-6 shrink-0">
                   <div className="flex items-center gap-4">
                     <button
                       onClick={() => setSelectedChatId(null)}
                       className="md:hidden w-8 h-8 rounded-full border border-[#e4ded2] bg-white text-[#5a5a5a] flex items-center justify-center"
                       aria-label="Back to conversations"
                     >
                       <ChevronLeft className="w-4 h-4" />
                     </button>
                     <div className="relative w-10 h-10 rounded-full border border-[#e4ded2] bg-[#f95c4b]/10 shadow-sm overflow-hidden">
                       <Image
                         src={getAvatarUrl(activeConversation.participant)}
                         alt={activeConversation.participant?.name || 'Profile'}
                         fill
                         className="object-cover"
                       />
                     </div>
                     <div>
                         <h2 className="font-[family-name:var(--font-fjalla)] text-[18px] text-[#1a1a1a] leading-none">{activeConversation.participant?.name}</h2>
                         <div className="flex items-center gap-1.5 mt-0.5">
                           <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div>
                           <span className="font-[family-name:var(--font-figtree)] text-[12px] text-[#5a5a5a]">Active</span>
                         </div>
                     </div>
                   </div>
                   <button className="w-9 h-9 rounded-full border border-[#e4ded2] bg-white flex items-center justify-center text-[#5a5a5a] hover:text-[#f95c4b] hover:bg-[#faf8f5] shadow-sm transition-colors">
                     <Info className="w-[18px] h-[18px]" />
                   </button>
               </header>

               {/* E2E notice - fixed below header, above message scroll area */}
               <div className="flex justify-center pt-5 pb-2 bg-[#f6f4f1] shrink-0">
                 <div className="flex items-center gap-2 bg-[#f0ede9] border border-[#e4ded2] rounded-full px-4 py-1.5 max-w-[380px]">
                   <svg
                     xmlns="http://www.w3.org/2000/svg"
                     className="w-3 h-3 text-[#5a5a5a] shrink-0"
                     viewBox="0 0 24 24"
                     fill="none"
                     stroke="currentColor"
                     strokeWidth="2.5"
                     strokeLinecap="round"
                     strokeLinejoin="round"
                   >
                     <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                     <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                   </svg>
                   <p className="text-[11px] text-[#5a5a5a] font-[family-name:var(--font-figtree)] text-center leading-snug">
                     Messages are end-to-end encrypted. Only you and{' '}
                     <span className="font-semibold">
                       {activeConversation?.participant?.name || 'this person'}
                     </span>{' '}
                     can read them.
                   </p>
                 </div>
               </div>

               <div data-messages-scroll-container className="flex-1 overflow-y-auto overflow-x-hidden p-6 space-y-4 flex flex-col-reverse">
                   {messages.map((msg: any) => {
                     const senderId = typeof msg.sender === 'object' ? msg.sender?._id : msg.sender;
                     const isMine = senderId?.toString() === currentUser?._id?.toString();

                     const displayText = msg.isEncrypted && convKey && msg.encryptedText
                       ? decryptMessage(msg.encryptedText, msg.nonce || '', convKey)
                       : (msg.text || '');

                     const messageId = msg._id || msg.id;
                     const avatarSource = isMine
                       ? getAvatarUrl(currentUser)
                       : getAvatarUrl(activeConversation?.participant);
                     const resolvedStatus = (msg.status || messageStatuses[messageId] || 'sent') as MessageStatusType;

                     if (editingMessageId === messageId && !msg.isDeleted) {
                       return (
                         <div
                           key={messageId}
                           ref={(el) => { messageRefs.current[messageId] = el; }}
                           className="transition-colors rounded-xl"
                         >
                           <div className={`flex items-end gap-2 max-w-[72%] ${isMine ? 'ml-auto flex-row-reverse' : ''}`}>
                             <div className="relative w-7 h-7 rounded-full border border-[#e4ded2] bg-[#f95c4b]/10 shadow-sm overflow-hidden shrink-0 mb-1">
                               <Image
                                 src={avatarSource}
                                 alt="Avatar"
                                 fill
                                 className="object-cover"
                               />
                             </div>
                             <div className="w-full max-w-[72%]">
                               <input
                                 type="text"
                                 value={editText}
                                 onChange={(e) => setEditText(e.target.value)}
                                 className="w-full bg-white border border-[#f95c4b]/40 rounded-xl px-4 py-2 font-[family-name:var(--font-figtree)] text-[15px] text-[#1a1a1a] focus:outline-none"
                               />
                               <div className="flex items-center justify-end gap-2 mt-2">
                                 <button
                                   type="button"
                                   onClick={() => {
                                     setEditingMessageId(null);
                                     setEditText('');
                                   }}
                                   className="text-[13px] font-[family-name:var(--font-figtree)] text-[#aaa] underline"
                                 >
                                   Cancel
                                 </button>
                                 <button
                                   type="button"
                                   onClick={() => handleEditMessage(messageId, editText)}
                                   className="bg-[#f95c4b] text-white rounded-full px-4 py-1 text-[13px] font-[family-name:var(--font-figtree)] hover:bg-[#ff6a5a]"
                                 >
                                   Save
                                 </button>
                               </div>
                             </div>
                           </div>
                         </div>
                       );
                     }

                     return (
                       <div
                         key={messageId}
                         ref={(el) => { messageRefs.current[messageId] = el; }}
                         className="transition-colors rounded-xl"
                       >
                         <MessageBubble
                           message={{
                             ...msg,
                             _id: messageId,
                             text: displayText,
                             isSender: isMine,
                             status: isMine ? resolvedStatus : undefined,
                             avatar: avatarSource,
                              mediaUrl: msg.mediaUrl,
                              mediaType: msg.mediaType,
                              thumbnailUrl: msg.thumbnailUrl,
                             reactions: msg.reactions || []
                           }}
                           onDelete={handleDeleteMessage}
                           onEdit={handleStartEdit}
                           onReact={handleReact}
                           onBlock={handleBlock}
                           currentUserId={currentUser?._id?.toString() || ''}
                           onRetry={isMine ? retrySend : undefined}
                           onReply={handleReplyStart}
                           onScrollToMessage={scrollToMessage}
                           onOpenLightbox={handleOpenLightbox}
                           onReport={(message) => setReportTargetMessageId(message._id || message.id || null)}
                         />
                       </div>
                     );
                   })}
               </div>

               <div className="p-4 bg-[#faf8f5] border-t border-[#e4ded2] shrink-0 relative">
                   {isBlocked && (
                     <div className="mx-4 mb-3 rounded-xl border border-[#f95c4b]/30 bg-[#fff3f2] px-4 py-3 text-[13px] text-[#f95c4b] font-[family-name:var(--font-figtree)] font-medium">
                       You have blocked this user. Unblock to send messages.
                     </div>
                   )}
                   {showEmojiPicker && (
                     <div
                       ref={emojiPickerRef}
                       className="absolute bottom-[72px] left-4 z-50 rounded-2xl overflow-hidden shadow-xl border border-[#e4ded2]"
                       style={{ width: '352px' }}
                     >
                       <div className="bg-white p-3">
                         <div className="grid grid-cols-8 gap-1">
                           {EMOJI_PICKER_OPTIONS.map((emoji) => (
                             <button
                               key={emoji}
                               type="button"
                               onClick={() => {
                                 insertEmoji(emoji);
                                 setShowEmojiPicker(false);
                               }}
                               className="h-9 w-9 rounded-lg text-[22px] leading-none hover:bg-[#f6f4f1]"
                             >
                               {emoji}
                             </button>
                           ))}
                         </div>
                       </div>
                     </div>
                   )}
                   {mediaPreview && (
                     <div className="mx-4 mb-0 px-4 py-3 bg-white border border-[#e4ded2] border-b-0 rounded-t-2xl flex items-center gap-3">
                       {/* Thumbnail preview */}
                       <div className="relative w-16 h-16 rounded-xl overflow-hidden border border-[#e4ded2] shrink-0 bg-[#f6f4f1]">
                         {mediaPreview.type === 'image' ? (
                           <img
                             src={mediaPreview.previewUrl}
                             alt="Preview"
                             className="w-full h-full object-cover"
                           />
                         ) : (
                           <video
                             src={mediaPreview.previewUrl}
                             className="w-full h-full object-cover"
                           />
                         )}
                         {/* Video play indicator */}
                         {mediaPreview.type === 'video' && (
                           <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                             <div className="w-6 h-6 rounded-full bg-white/80 flex items-center justify-center">
                               <Play className="w-3 h-3 text-[#1a1a1a] fill-[#1a1a1a]" />
                             </div>
                           </div>
                         )}
                       </div>

                       {/* File info */}
                       <div className="flex-1 min-w-0">
                         <p className="text-[13px] font-semibold text-[#1a1a1a] truncate">
                           {mediaPreview.file.name}
                         </p>
                         <p className="text-[11px] text-[#aaa] mt-0.5">
                           {mediaPreview.type === 'image' ? 'Image' : 'Video'} · {(mediaPreview.file.size / (1024 * 1024)).toFixed(1)}MB
                         </p>
                       </div>

                       {/* Remove preview */}
                       <button
                         onClick={() => {
                           URL.revokeObjectURL(mediaPreview.previewUrl);
                           setMediaPreview(null);
                         }}
                         className="text-[#aaa] hover:text-[#5a5a5a] shrink-0"
                       >
                         <X className="w-4 h-4" />
                       </button>
                     </div>
                   )}
                   {replyingTo && (
                     <div className="mx-4 mb-0 px-4 py-3 bg-white border border-[#e4ded2] border-b-0 rounded-t-2xl flex items-start justify-between gap-3">
                       <div className="flex items-start gap-3 min-w-0">
                         <div className="w-[3px] rounded-full bg-[#f95c4b] self-stretch shrink-0" />
                         <div className="flex flex-col min-w-0">
                           <span className="text-[12px] font-semibold text-[#f95c4b] mb-0.5 truncate">
                             {replyingTo.senderName}
                           </span>
                           <span className="text-[13px] text-[#5a5a5a] truncate max-w-[400px] italic flex items-center gap-1">
                             {replyingTo.mediaType === 'image' && <ImageIcon className="w-3 h-3" />}
                             {replyingTo.mediaType === 'video' && <Play className="w-3 h-3" />}
                             {replyingTo.text || (replyingTo.mediaType === 'image' ? 'Photo' : replyingTo.mediaType === 'video' ? 'Video' : '')}
                           </span>
                         </div>
                       </div>
                       <button
                         type="button"
                         onClick={() => setReplyingTo(null)}
                         className="text-[#aaa] hover:text-[#5a5a5a] shrink-0 mt-0.5"
                       >
                         <X className="w-4 h-4" />
                       </button>
                     </div>
                   )}
                   <div className={`flex flex-col bg-white rounded-2xl border border-[#e4ded2] overflow-hidden shadow-sm ${replyingTo || mediaPreview ? 'rounded-t-none' : ''}`}>
                     <div className="px-4 pt-3 pb-2">
                      <div className="relative">
                        {!hasContent && (
                          <span className="absolute left-0 top-0 font-[family-name:var(--font-figtree)] text-[15px] text-[#aaa] pointer-events-none">
                            Write your message here
                          </span>
                        )}
                        <div
                          ref={editorRef}
                          contentEditable={true}
                          suppressContentEditableWarning={true}
                          onInput={handleEditorInput}
                          onKeyDown={handleKeyDown}
                          onKeyUp={syncFormattingState}
                          onMouseUp={syncFormattingState}
                          onFocus={syncFormattingState}
                          className="w-full bg-transparent border-none focus:ring-0 font-[family-name:var(--font-figtree)] text-[15px] text-[#1a1a1a] placeholder:text-[#aaa] resize-none min-h-[52px] max-h-[140px] outline-none overflow-y-auto"
                        />
                      </div>
                     </div>
                      <div className="px-4 pb-3 flex justify-between items-center relative">
                         <div className="flex items-center gap-4 text-[#aaa]">
                           <AlignLeft
                             className="w-4 h-4 cursor-pointer hover:text-[#5a5a5a] transition-colors"
                             onMouseDown={(e) => {
                               e.preventDefault();
                               applyFormat('insertUnorderedList');
                             }}
                           />
                           <button
                             type="button"
                             onMouseDown={(e) => {
                               e.preventDefault();
                               applyFormat('italic');
                             }}
                             className={`rounded-full p-1 transition-colors ${isItalicActive ? 'bg-[#f0ede9] text-[#5a5a5a]' : 'text-[#aaa] hover:text-[#5a5a5a]'}`}
                             aria-pressed={isItalicActive}
                             aria-label="Italic"
                           >
                             <Italic className="w-4 h-4" strokeWidth={isItalicActive ? 2.5 : 2} />
                           </button>
                           <button
                             type="button"
                             onMouseDown={(e) => {
                               e.preventDefault();
                               applyFormat('bold');
                             }}
                             className={`rounded-full p-1 transition-colors ${isBoldActive ? 'bg-[#f0ede9] text-[#5a5a5a]' : 'text-[#aaa] hover:text-[#5a5a5a]'}`}
                             aria-pressed={isBoldActive}
                             aria-label="Bold"
                           >
                             <Bold className="w-4 h-4" strokeWidth={isBoldActive ? 2.6 : 2} />
                           </button>
                           <button
                             type="button"
                             ref={emojiButtonRef}
                             onClick={() => setShowEmojiPicker((prev) => !prev)}
                             className="text-[#aaa] hover:text-[#5a5a5a] transition-colors"
                             aria-label="Toggle emoji picker"
                           >
                             <Smile className="w-4 h-4" />
                           </button>
                           <Paperclip className="w-4 h-4 cursor-pointer hover:text-[#5a5a5a] transition-colors" onClick={handleAttachmentClick} />
                           <input 
                             type="file" 
                             ref={fileInputRef} 
                             className="hidden" 
                             accept="image/*,video/*"
                             onChange={handleFileChange}
                           />
                         </div>
                         <button 
                           onClick={handleSendMessage}
                           disabled={isUploading || isBlocked}
                           className="bg-[#f95c4b] text-white rounded-full px-6 py-2 font-medium text-[14px] hover:bg-[#ff6a5a] active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-2"
                         >
                           {isUploading ? (
                             <>
                               <Loader2 className="w-4 h-4 animate-spin" />
                               Uploading...
                             </>
                           ) : 'Send'}
                         </button>
                      </div>
                   </div>
               </div>
             </>
           ) : (
             <div className="flex-1 flex flex-col items-center justify-center bg-[#f6f4f1]">
               <div className="w-20 h-20 rounded-full border border-[#e4ded2] bg-[#faf8f5] flex items-center justify-center mb-5">
                 <Send className="w-12 h-12 text-[#e4ded2]" />
                </div>
               <h2 className="font-[family-name:var(--font-fjalla)] text-[24px] text-[#3a3a3a] mb-2">Your Messages</h2>
               <p className="font-[family-name:var(--font-figtree)] text-[14px] text-[#aaa]">Select a conversation to start chatting</p>
             </div>
           )}
        </div>
      </main>
    </div>
    <Lightbox
      open={lightboxOpen}
      close={() => setLightboxOpen(false)}
      slides={lightboxSlides}
      index={lightboxIndex}
      plugins={[Video]}
    />
    {reportTargetMessageId ? (
      <ReportModal
        targetId={reportTargetMessageId}
        targetType="dm"
        onClose={() => setReportTargetMessageId(null)}
      />
    ) : null}
    </>
  );
}

