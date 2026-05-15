'use client';

import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import api from '@/src/lib/api';
import toast from 'react-hot-toast';
import MembershipModal from './MembershipModal';

interface ProfileActionsProps {
  creatorId: string;
  creatorUserId?: string;
  creatorName?: string;
  subscriptionPrice?: number;
  isInitialSubscribed?: boolean;
}

export default function ProfileActions({ 
  creatorId, 
  creatorUserId,
  creatorName = 'Creator',
  subscriptionPrice = 4.99,
  isInitialSubscribed = false 
}: ProfileActionsProps) {
  const router = useRouter();
  const [isMsgModalOpen, setIsMsgModalOpen] = useState(false);
  const [isMemModalOpen, setIsMemModalOpen] = useState(false);
  const [messageText, setMessageText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(isInitialSubscribed);

  useEffect(() => {
    setIsSubscribed(isInitialSubscribed);
  }, [isInitialSubscribed]);

  const handleSendMessage = async () => {
    if (!messageText.trim()) return;
    setIsSending(true);
    try {
      await api.post('/user/messages', {
        recipientId: creatorUserId || creatorId,
        text: messageText
      });
      toast.success('Message sent!');
      setIsMsgModalOpen(false);
      setMessageText('');
      router.push('/user/messages');
    } catch (err: unknown) {
      const maybeAxiosError = err as {
        response?: {
          status?: number;
          data?: {
            error?: string;
          };
        };
      };

      if (maybeAxiosError?.response?.status === 403 && maybeAxiosError?.response?.data?.error === 'FeatureDisabled') {
        toast.error('Messaging is currently unavailable on this platform.');
      } else {
        toast.error('Failed to send message');
      }
    } finally {
      setIsSending(false);
    }
  };

  const handleMembershipSuccess = () => {
    setIsSubscribed(true);
    toast.success('Membership joined!');
  };

  return (
    <>
      <div className="flex gap-[8px] items-center shrink-0">
        <button className="bg-[#faf8f5] border border-[#d8d1c7] flex gap-[4px] items-center justify-center px-[12px] py-[8px] rounded-[36px] hover:bg-white transition-colors cursor-pointer">
          <Image src="/assets/creator/share.svg" alt="Share profile" width={20} height={20} className="w-[20px] h-[20px]" />
          <span className="font-['Figtree',sans-serif] font-medium leading-[18.3px] text-[#1a1a1a] text-[13px] tracking-[0.26px]">
            Share profile
          </span>
        </button>

        <button 
          onClick={() => {
            if (isSubscribed) {
              toast.success('You have already taken the membership!');
            } else {
              setIsMemModalOpen(true);
            }
          }}
          className={`${isSubscribed ? 'bg-green-50 border-green-200 text-green-700' : 'bg-[#faf8f5] border-[#d8d1c7] text-[#1a1a1a]'} border flex gap-[4px] items-center justify-center px-[12px] py-[8px] rounded-[36px] hover:bg-white transition-colors cursor-pointer`}
        >
          <Image 
            src="/assets/creator/diamond.svg" 
            alt="Membership" 
            width={20} 
            height={20} 
            className={`w-[20px] h-[20px] ${isSubscribed ? 'filter-none' : ''}`} 
          />
          <span className="font-['Figtree',sans-serif] font-medium leading-[18.3px] text-[13px] tracking-[0.26px]">
            {isSubscribed ? 'Joined' : 'Membership'}
          </span>
        </button>

        <button 
          onClick={() => setIsMsgModalOpen(true)}
          className="bg-[#f95c4b] flex gap-[4px] items-center justify-center px-[12px] py-[8px] border border-transparent rounded-[36px] hover:bg-[#eb5242] transition-colors shadow-sm cursor-pointer"
        >
          <Image src="/assets/creator/envelope.svg" alt="Get in touch" width={20} height={20} className="w-[20px] h-[20px]" />
          <span className="font-['Figtree',sans-serif] font-medium leading-[18.3px] text-[#f6f4f1] text-[13px] tracking-[0.26px]">
            Get in touch
          </span>
        </button>
      </div>

      {/* Membership Purchase Modal */}
      <MembershipModal 
        isOpen={isMemModalOpen}
        onClose={() => setIsMemModalOpen(false)}
        creatorName={creatorName}
        creatorId={creatorId}
        price={subscriptionPrice}
        onSuccess={handleMembershipSuccess}
      />

      {/* Basic Message Modal */}
      {isMsgModalOpen && (
        <div className="fixed inset-0 bg-black/50 z-[999] flex items-center justify-center p-4">
          <div className="bg-[#fcfaf7] rounded-3xl w-full max-w-[500px] p-8 shadow-2xl border border-[#e4ded2]">
            <div className="flex justify-between items-center mb-6">
              <h2 className="font-['Figtree',sans-serif] text-2xl font-bold text-[#1a1a1a]">Send Message</h2>
              <button onClick={() => setIsMsgModalOpen(false)} className="text-[#5a5a5a] hover:text-[#1a1a1a]">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              </button>
            </div>
            <textarea
              className="w-full h-40 bg-white border border-[#d8d1c7] rounded-2xl p-4 font-['Figtree',sans-serif] text-[15px] focus:outline-none focus:ring-2 focus:ring-[#f95c4b]/30 resize-none shadow-sm"
              placeholder={`Write a message to ${creatorName}...`}
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
            />
            <div className="flex gap-4 mt-8 justify-end">
              <button 
                onClick={() => setIsMsgModalOpen(false)}
                className="px-6 py-3 font-semibold text-[#5a5a5a] text-[14px] hover:text-[#1a1a1a] transition-colors"
                disabled={isSending}
              >
                Cancel
              </button>
              <button 
                onClick={handleSendMessage}
                disabled={isSending || !messageText.trim()}
                className="bg-[#f95c4b] text-white px-10 py-3 rounded-full font-bold text-[14px] hover:bg-[#eb5242] transition-all shadow-md active:scale-95 disabled:opacity-50"
              >
                {isSending ? 'Sending...' : 'Send Message'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
