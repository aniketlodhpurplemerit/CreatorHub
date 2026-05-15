"use client"
/* eslint-disable @next/next/no-img-element */

import React, { useState, useEffect, useRef } from 'react';
import api from '@/src/lib/api';
import { Settings, Edit2, Palette, Rocket, Megaphone, ArrowRight, MoreHorizontal, PenTool, Camera, X, Plus, Package, ShoppingBag, Search, CheckCircle2, Heart, MessageSquare, Eye, Trash2, Edit3, Loader2, Upload, Play, Image as ImageIcon, Lock, Video, Radio, FileText } from 'lucide-react';
import toast from 'react-hot-toast';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/src/store/useAuthStore';

const formatINR = (value: number) => {
  const amount = Number(value) || 0;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
};

export default function CreatorHomePage() {
  const router = useRouter();
  const updateUser = useAuthStore((s) => s.updateUser);
  const [activeTab, setActiveTab] = useState('Home');
  const [filterType, setFilterType] = useState('All'); // ['All', 'image', 'video', 'livestream']
  
  const [basicsOpen, setBasicsOpen] = useState(false);
  const [recommendOpen, setRecommendOpen] = useState(false);
  const [editPostModalOpen, setEditPostModalOpen] = useState(false);
  const [creatorData, setCreatorData] = useState<any>(null);
  const [profileForm, setProfileForm] = useState({ name: '', username: '', bio: '' });
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState('');
  
  // Post Editing State
  const [editingPost, setEditingPost] = useState<any>(null);
  const [postFile, setPostFile] = useState<File | null>(null);
  const [postThumbnail, setPostThumbnail] = useState<File | null>(null);
  const [postPreview, setPostPreview] = useState('');
  const [thumbnailPreview, setThumbnailPreview] = useState('');

  const [updating, setUpdating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const postFileInputRef = useRef<HTMLInputElement>(null);
  const postThumbInputRef = useRef<HTMLInputElement>(null);

  const fetchDashboard = async () => {
    try {
      const res = await api.get('/creator/dashboard');
      setCreatorData(res.data);
      if (res.data?.creator) {
        setProfileForm({
          name: res.data.creator.name || '',
          username: res.data.creator.username || '',
          bio: res.data.creator.bio || ''
        });
        setAvatarPreview(res.data.creator.avatar || '');
      }
    } catch (err) {
      console.error("Error fetching creator dashboard:", err);
    }
  };

  useEffect(() => {
    fetchDashboard();
  }, []);

  const handleProfileUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setUpdating(true);
    try {
       const formData = new FormData();
       formData.append('name', profileForm.name);
       formData.append('username', profileForm.username);
       formData.append('bio', profileForm.bio);
       if (avatarFile) {
         formData.append('avatar', avatarFile);
       }

       const res = await api.put('/creator/update-profile', formData);
       
       setCreatorData((prev: any) => ({ ...prev, creator: res.data }));
       updateUser({
         name: res.data.name,
         avatar: res.data.avatar,
         bio: typeof res.data.bio === 'string' ? res.data.bio : profileForm.bio,
       });
       toast.success("Profile updated!");
       setBasicsOpen(false);
    } catch (err) {
       toast.error("Failed to update profile");
    } finally {
       setUpdating(false);
    }
  };

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setAvatarFile(file);
      setAvatarPreview(URL.createObjectURL(file));
    }
  };

  const handleDeletePost = async (id: string) => {
    if (!window.confirm("Are you sure you want to delete this post?")) return;
    setDeletingId(id);
    try {
      await api.delete(`/creator/posts/${id}`);
      toast.success("Post deleted");
      fetchDashboard();
    } catch (err) {
      toast.error("Failed to delete post");
    } finally {
      setDeletingId(null);
    }
  };

  const handleEditPost = (post: any) => {
    setEditingPost({ ...post });
    setPostPreview(post.mediaUrl || '');
    setThumbnailPreview(post.thumbnailUrl || '');
    setPostFile(null);
    setPostThumbnail(null);
    setEditPostModalOpen(true);
  };

  const handleUpdatePost = async (e: React.FormEvent) => {
    e.preventDefault();
    setUpdating(true);
    try {
      const formData = new FormData();
      formData.append('title', editingPost.title);
      formData.append('description', editingPost.description);
      formData.append('isExclusive', editingPost.isExclusive);
      formData.append('status', editingPost.status);
      formData.append('category', editingPost.category);
      if (postFile) {
        formData.append('file', postFile);
      }
      if (postThumbnail) {
        formData.append('thumbnail', postThumbnail);
      }

      await api.put(`/creator/posts/${editingPost.id}`, formData);
      toast.success("Post updated!");
      setEditPostModalOpen(false);
      fetchDashboard();
    } catch (err) {
      toast.error("Failed to update post");
    } finally {
      setUpdating(false);
    }
  };

  const creator = creatorData?.creator;
  const stats = creatorData?.stats;
  const posts = creatorData?.postRevenueBreakdown || [];
  
  // Filter Logic
  const filteredPosts = posts.filter((post: any) => {
    if (filterType === 'All') return true;
    return post.type === filterType.toLowerCase();
  });

  return (
    <div className="flex flex-col items-center bg-[#f9f9f9] min-h-screen font-sans pb-20 relative">

      {/* Hero Section */}
      <div className="w-full max-w-5xl px-4 sm:px-6 md:px-8 flex flex-col items-center justify-center pt-8 md:pt-16 pb-8 md:pb-12 relative">
        <h1 className="text-[34px] sm:text-[42px] font-bold text-[#1c1917] tracking-tighter mb-2 shadow-sm font-['Fjalla One'] uppercase text-center">
          {creator?.name || 'Creator Name'}
        </h1>
        <p className="text-slate-500 font-medium mb-8">@{creator?.username || 'username'}</p>

        <div className="flex gap-6 md:gap-10 border-b border-slate-200/80 w-full justify-start md:justify-center overflow-x-auto hide-scrollbar">
          {['Home', 'Collections', 'Shop', 'Membership', 'Recommendations'].map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`shrink-0 text-[13px] md:text-[15px] font-bold pb-4 border-b-2 transition-all duration-200 ${activeTab === tab ? 'text-[#1c1917] border-rose-500' : 'text-slate-400 hover:text-slate-800 border-transparent'}`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="w-full max-w-4xl px-4 sm:px-6 md:px-8 flex flex-col items-stretch space-y-6 text-slate-800">

        {/* ----- HOME TAB ----- */}
        {activeTab === 'Home' && (
          <>
            {/* Header Row */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-2">
              <h2 className="text-[24px] sm:text-[28px] font-bold tracking-tight text-[#1c1917] font-['Fjalla One'] uppercase">Home</h2>
              <div className="flex items-center gap-3">
                <button 
                  onClick={() => setBasicsOpen(true)}
                  className="px-5 py-2 bg-white border border-slate-200 text-slate-700 text-sm font-bold rounded-full hover:bg-slate-50 transition-colors flex items-center gap-2 shadow-sm"
                >
                   Edit Page <PenTool className="w-3.5 h-3.5 text-slate-500" />
                </button>
              </div>
            </div>

            {/* Quick Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-2">
               <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
                  <div className="flex items-center gap-2 text-slate-400 mb-2">
                     <ShoppingBag className="w-4 h-4" />
                     <span className="text-xs font-bold uppercase tracking-widest">Earnings</span>
                  </div>
                  <p className="text-2xl font-black text-[#1c1917] font-['Fjalla One']">{formatINR(stats?.totalEarned || 0)}</p>
                  <p className="text-[11px] font-bold text-emerald-600 mt-1">Total accumulated</p>
               </div>
               <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
                  <div className="flex items-center gap-2 text-slate-400 mb-2">
                     <Heart className="w-4 h-4" />
                     <span className="text-xs font-bold uppercase tracking-widest">Engagement</span>
                  </div>
                  <p className="text-2xl font-black text-[#1c1917] font-['Fjalla One']">
                    {posts.reduce((acc: number, p: any) => acc + (p.likes || 0), 0)}
                  </p>
                  <p className="text-[11px] font-bold text-slate-400 mt-1">Likes across top posts</p>
               </div>
               <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
                  <div className="flex items-center gap-2 text-slate-400 mb-2">
                     <Rocket className="w-4 h-4" />
                     <span className="text-xs font-bold uppercase tracking-widest">Subscribers</span>
                  </div>
                  <p className="text-2xl font-black text-[#1c1917] font-['Fjalla One']">{stats?.activeSubscribers || 0}</p>
                  <p className="text-[11px] font-bold text-rose-500 mt-1">Active members</p>
               </div>
            </div>

            {/* Recent Posts Section with Filters */}
            <div className="space-y-6 pt-4">
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                 <h3 className="text-xl font-bold text-[#1c1917] font-['Fjalla One'] uppercase">Recent Posts</h3>
                 
                 <div className="flex bg-white border border-slate-200 rounded-2xl p-1 shadow-sm overflow-x-auto whitespace-nowrap max-w-full">
                    {[
                      { name: 'All', icon: Package },
                      { name: 'Image', icon: ImageIcon },
                      { name: 'Video', icon: Play },
                      { name: 'Livestream', icon: Radio },
                      { name: 'File', icon: FileText }
                    ].map((t) => (
                      <button
                        key={t.name}
                        onClick={() => setFilterType(t.name)}
                        className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all ${filterType === t.name ? 'bg-rose-500 text-white shadow-md' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50'}`}
                      >
                         <t.icon className={`w-3.5 h-3.5 ${filterType === t.name ? 'text-white' : 'text-slate-300'}`} />
                         {t.name}
                      </button>
                    ))}
                 </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                 {filteredPosts.length > 0 ? filteredPosts.map((post: any) => (
                   <div 
                     key={post.id} 
                     onClick={() => router.push(`/creator/post/${post.id}`)}
                     className="bg-white border border-slate-200/60 rounded-3xl overflow-hidden group hover:shadow-xl transition-all cursor-pointer flex flex-col"
                   >
                       <div className="relative aspect-square flex items-center justify-center">
                          {post.type === 'file' ? (
                             <div className="w-full h-full flex items-center justify-center bg-slate-50 text-7xl select-none">📄</div>
                           ) : (
                             <img src={post.thumbnailUrl || post.img} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" alt={post.title} />
                           )}
                          <div className="absolute inset-0 bg-black/10 group-hover:bg-black/20 transition-colors"></div>
                          {post.type === 'video' && (
                            <div className="absolute top-4 right-4 w-10 h-10 bg-white/30 backdrop-blur-md rounded-full flex items-center justify-center text-white border border-white/20">
                               <Play className="w-4 h-4 fill-white" />
                            </div>
                          )}
                          <div className="absolute top-4 left-4">
                             {post.isExclusive && (
                               <div className="bg-black/50 backdrop-blur-md px-2 py-1 rounded-md text-[9px] font-black text-white uppercase tracking-widest border border-white/10 flex items-center gap-1">
                                  <Lock className="w-2.5 h-2.5" /> Exclusive
                               </div>
                             )}
                             {post.policyViolationLocked && (
                               <div className="mt-2 bg-amber-600/90 backdrop-blur-md px-2 py-1 rounded-md text-[9px] font-black text-white uppercase tracking-widest border border-amber-300/30">
                                 {post.policyViolationLabel || 'Policy Violation'}
                               </div>
                             )}
                          </div>
                          <div className="absolute bottom-4 left-4 right-4 flex items-center justify-between pointer-events-none">
                             <div className="flex items-center gap-3 bg-black/40 backdrop-blur-md px-3 py-1.5 rounded-full text-white text-[10px] font-black border border-white/10">
                                <span className="flex items-center gap-1"><Heart className="w-3 h-3" /> {post.likes}</span>
                                <span className="flex items-center gap-1"><MessageSquare className="w-3 h-3" /> {post.comments}</span>
                             </div>
                             <div className="flex gap-2 pointer-events-auto">
                                <button 
                                  onClick={(e) => { e.stopPropagation(); handleEditPost(post); }}
                                  className="w-10 h-10 bg-white border border-slate-200 text-slate-700 rounded-full hover:bg-rose-500 hover:text-white transition-all shadow-lg flex items-center justify-center translate-y-12 group-hover:translate-y-0 opacity-0 group-hover:opacity-100 duration-300"
                                >
                                   <Edit3 className="w-4 h-4" />
                                </button>
                                <button 
                                  onClick={(e) => { e.stopPropagation(); handleDeletePost(post.id); }}
                                  className="w-10 h-10 bg-white border border-slate-200 text-rose-500 rounded-full hover:bg-rose-600 hover:text-white transition-all shadow-lg flex items-center justify-center translate-y-12 group-hover:translate-y-0 opacity-0 group-hover:opacity-100 duration-300 delay-75"
                                >
                                   <Trash2 className="w-4 h-4" />
                                </button>
                             </div>
                          </div>
                       </div>
                       <div className="p-6">
                            <h4 className="text-[17px] font-black text-[#1c1917] group-hover:text-rose-500 transition-colors uppercase font-['Fjalla One'] truncate">{post.title}</h4>
                            <div className="flex justify-between items-center mt-1.5">
                               <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">{new Date(post.date).toLocaleDateString()}</p>
                               <span className="text-[11px] font-black text-rose-500 bg-rose-50 px-2 py-0.5 rounded uppercase">{post.type}</span>
                            </div>
                       </div>
                   </div>
                 )) : (
                   <div className="col-span-full py-20 border-2 border-dashed border-slate-200 rounded-[40px] flex flex-col items-center justify-center text-slate-400 bg-white">
                      <Package className="w-10 h-10 mb-4 opacity-10" />
                      <p className="text-sm font-bold uppercase tracking-widest">No {filterType.toLowerCase()} posts matched</p>
                      <button onClick={() => setFilterType('All')} className="mt-4 text-xs font-bold text-rose-500 hover:underline">Clear filters</button>
                   </div>
                 )}
              </div>
            </div>

            {/* Onboarding Card */}
            <div className="bg-white border border-slate-200/60 rounded-[40px] p-10 shadow-sm mt-4">
              <h3 className="text-2xl font-bold text-[#1c1917] mb-6 font-['Fjalla One'] uppercase">Launch Checklist</h3>
              <div className="space-y-2 relative">
                <div onClick={() => setBasicsOpen(true)} className="flex gap-6 items-start relative group cursor-pointer py-6 border-b border-slate-100/80">
                  <div className="w-12 h-12 rounded-2xl bg-[#fff7f5] flex items-center justify-center shrink-0 border border-[#fee2d1] group-hover:bg-rose-500 group-hover:border-rose-500 transition-all duration-300">
                    <Settings className="w-6 h-6 text-[#d94828] group-hover:text-white transition-colors" />
                  </div>
                  <div className="pt-1 flex-1">
                    <h4 className="text-lg font-bold text-[#1c1917] mb-1 font-['Fjalla One'] uppercase tracking-tight">Identity & Vision</h4>
                    <p className="text-sm font-medium text-slate-500 font-sans">Establish your core profile, brand assets, and creative bio.</p>
                  </div>
                  <div className="w-10 h-10 rounded-full border border-slate-100 flex items-center justify-center group-hover:bg-rose-500 group-hover:text-white transition-all mt-2">
                     <ArrowRight className="w-5 h-5" />
                  </div>
                </div>

                <div onClick={() => router.push('/creator/post')} className="flex gap-6 items-start relative group cursor-pointer py-6 border-b border-slate-100/80">
                  <div className="w-12 h-12 rounded-2xl bg-[#f0fdf4] flex items-center justify-center shrink-0 border border-[#dcfce7] group-hover:bg-rose-500 group-hover:border-rose-500 transition-all duration-300">
                    <Edit2 className="w-6 h-6 text-[#166534] group-hover:text-white transition-colors" />
                  </div>
                  <div className="pt-1 flex-1">
                    <h4 className="text-lg font-bold text-[#1c1917] mb-1 font-['Fjalla One'] uppercase tracking-tight">Prime Release</h4>
                    <p className="text-sm font-medium text-slate-500 font-sans">Deploy your premier exclusive content for your inaugural members.</p>
                  </div>
                  <div className="w-10 h-10 rounded-full border border-slate-100 flex items-center justify-center group-hover:bg-rose-500 group-hover:text-white transition-all mt-2">
                     <ArrowRight className="w-5 h-5" />
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

       {/* Edit Profile Modal */}
       {basicsOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 backdrop-blur-[2px]">
          <form onSubmit={handleProfileUpdate} className="bg-white rounded-[32px] shadow-2xl w-[440px] p-8 pt-6 relative flex flex-col animate-in fade-in zoom-in duration-200">

            <div className="flex justify-center w-full relative mb-8">
              <h3 className="text-base font-bold text-[#1c1917] font-['Fjalla One'] uppercase">Start with the basics</h3>
              <button
                type="button"
                onClick={() => setBasicsOpen(false)}
                className="absolute right-0 top-0 w-8 h-8 flex items-center justify-center rounded-full border border-slate-200 text-slate-400 hover:text-slate-600 hover:bg-slate-50 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex justify-center mb-8 relative">
              <div 
                onClick={() => fileInputRef.current?.click()}
                className="w-24 h-24 rounded-full bg-slate-100 text-rose-500 text-4xl font-black flex items-center justify-center shadow-inner relative z-10 border-4 border-white overflow-hidden cursor-pointer group"
              >
                {avatarPreview ? (
                  <img src={avatarPreview} className="w-full h-full object-cover" alt="Preview" />
                ) : (
                  profileForm.name?.charAt(0) || 'U'
                )}
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                   <Camera className="w-6 h-6 text-white" />
                </div>
              </div>
              <input 
                type="file" 
                ref={fileInputRef} 
                className="hidden" 
                accept="image/*" 
                onChange={handleAvatarChange} 
              />
            </div>

            <div className="space-y-6 mb-8">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-2.5 ml-1 uppercase font-['Fjalla One'] tracking-wider">Display Name</label>
                <input 
                  type="text" 
                  value={profileForm.name}
                  onChange={(e) => setProfileForm({...profileForm, name: e.target.value})}
                  className="w-full bg-[#fcfcfc] border border-slate-200 rounded-xl px-4 py-4 text-sm font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-rose-200 transition-all font-sans" 
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-2.5 ml-1 uppercase font-['Fjalla One'] tracking-wider">Bio</label>
                <textarea 
                  value={profileForm.bio}
                  onChange={(e) => setProfileForm({...profileForm, bio: e.target.value})}
                  className="w-full bg-[#fcfcfc] border border-slate-200 rounded-xl px-4 py-4 text-sm font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-rose-200 transition-all min-h-[100px] resize-none font-sans" 
                />
              </div>
            </div>

            <div className="flex gap-4">
              <button type="button" onClick={() => setBasicsOpen(false)} className="flex-1 py-4 bg-slate-50 hover:bg-slate-100 text-slate-700 text-sm font-bold rounded-2xl transition-colors border border-slate-200 font-sans">
                Cancel
              </button>
              <button 
                type="submit"
                disabled={updating}
                className="flex-1 py-4 bg-[#d94828] hover:bg-[#c93d1f] text-white text-sm font-bold rounded-2xl shadow-xl transition-all border-b-4 border-[#b9381b] disabled:opacity-50 flex items-center justify-center font-sans"
              >
                {updating ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Save Changes'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Expanded Edit Post Modal */}
      {editPostModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 backdrop-blur-[2px]">
           <form onSubmit={handleUpdatePost} className="bg-white rounded-[40px] shadow-2xl w-full max-w-[700px] p-10 pt-8 relative flex flex-col animate-in fade-in zoom-in duration-200 max-h-[90vh] overflow-y-auto">
              <div className="flex justify-between items-center mb-8">
                 <h3 className="text-[22px] font-black text-[#1c1917] font-['Fjalla One'] uppercase">Edit Post - Everything</h3>
                 <button type="button" onClick={() => setEditPostModalOpen(false)} className="p-2 text-slate-400 hover:text-slate-600 transition-colors border border-slate-100 rounded-full">
                    <X className="w-5 h-5" />
                 </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-10">
                 <div className="space-y-6">
                    <div>
                        <label className="block text-xs font-black text-slate-400 mb-2.5 ml-1 uppercase tracking-widest">Post Title</label>
                        <input 
                          type="text" 
                          value={editingPost?.title || ''}
                          onChange={(e) => setEditingPost({...editingPost, title: e.target.value})}
                          className="w-full bg-[#fcfcfc] border border-slate-200 rounded-2xl px-5 py-4 text-sm font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-rose-200 transition-all font-sans" 
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-black text-slate-400 mb-2.5 ml-1 uppercase tracking-widest">Description</label>
                        <textarea 
                          value={editingPost?.description || ''}
                          onChange={(e) => setEditingPost({...editingPost, description: e.target.value})}
                          className="w-full bg-[#fcfcfc] border border-slate-200 rounded-2xl px-5 py-4 text-sm font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-rose-200 transition-all min-h-[160px] resize-none font-sans" 
                        />
                    </div>
                    <div className="flex items-center gap-2 px-2">
                        <input 
                          type="checkbox" 
                          id="exclusive-edit"
                          checked={editingPost?.isExclusive}
                          onChange={(e) => setEditingPost({...editingPost, isExclusive: e.target.checked})}
                          className="w-5 h-5 rounded-lg border-slate-300 text-rose-500 focus:ring-rose-500 transition-colors"
                        />
                        <label htmlFor="exclusive-edit" className="text-sm font-bold text-slate-600 flex items-center gap-2 cursor-pointer">
                           <Lock className="w-3.5 h-3.5" /> Exclusive for Members
                        </label>
                    </div>
                 </div>

                 <div className="space-y-8">
                    {/* Media Upload (Main Content) */}
                    <div>
                       <label className="block text-xs font-black text-slate-400 mb-2.5 ml-1 uppercase tracking-widest">Change Main Media</label>
                       <div 
                         onClick={() => postFileInputRef.current?.click()}
                         className="relative aspect-video bg-slate-50 border-2 border-dashed border-slate-200 rounded-3xl overflow-hidden group cursor-pointer hover:border-rose-500 transition-colors"
                       >
                          {postPreview ? (
                            editingPost?.type === 'video' && !postFile ? (
                              <div className="w-full h-full flex flex-col items-center justify-center gap-4 bg-slate-100">
                                 <Play className="w-10 h-10 text-rose-500 fill-rose-500" />
                                 <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">Video Content Active</p>
                              </div>
                            ) : (
                              <img src={postPreview} className="w-full h-full object-cover" alt="Post preview" />
                            )
                          ) : (
                            <div className="w-full h-full flex flex-col items-center justify-center gap-2">
                               <Upload className="w-8 h-8 text-slate-300" />
                               <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Click to upload</p>
                            </div>
                          )}
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-[11px] font-black uppercase tracking-widest">
                             Replace Media
                          </div>
                       </div>
                       <input 
                         type="file" 
                         ref={postFileInputRef} 
                         className="hidden" 
                         onChange={(e) => {
                            if (e.target.files?.[0]) {
                              setPostFile(e.target.files[0]);
                              setPostPreview(URL.createObjectURL(e.target.files[0]));
                              if (e.target.files[0].type.startsWith('video/')) setEditingPost({...editingPost, type: 'video'});
                              else setEditingPost({...editingPost, type: 'image'});
                            }
                         }} 
                       />
                    </div>

                    {/* Thumbnail Upload (For Videos) */}
                    {(editingPost?.type === 'video' || (postFile?.type.startsWith('video/'))) && (
                       <div>
                          <label className="block text-xs font-black text-slate-400 mb-2.5 ml-1 uppercase tracking-widest">Custom Cover Image / Thumbnail</label>
                          <div 
                            onClick={() => postThumbInputRef.current?.click()}
                            className="relative aspect-[16/9] bg-slate-50 border-2 border-dashed border-slate-200 rounded-3xl overflow-hidden group cursor-pointer hover:border-emerald-500 transition-colors"
                          >
                             {thumbnailPreview ? (
                               <img src={thumbnailPreview} className="w-full h-full object-cover" alt="Thumbnail preview" />
                             ) : (
                               <div className="w-full h-full flex flex-col items-center justify-center gap-2">
                                  <ImageIcon className="w-8 h-8 text-slate-300" />
                                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Upload Cover</p>
                               </div>
                             )}
                             <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-[11px] font-black uppercase tracking-widest">
                                Change Cover
                             </div>
                          </div>
                          <input 
                            type="file" 
                            ref={postThumbInputRef} 
                            className="hidden" 
                            accept="image/*"
                            onChange={(e) => {
                               if (e.target.files?.[0]) {
                                 setPostThumbnail(e.target.files[0]);
                                 setThumbnailPreview(URL.createObjectURL(e.target.files[0]));
                               }
                            }} 
                          />
                       </div>
                    )}
                 </div>
              </div>

              <div className="flex gap-4">
                 <button type="button" onClick={() => setEditPostModalOpen(false)} className="flex-1 py-4.5 bg-white border border-slate-200 text-slate-700 text-sm font-black rounded-3xl transition-all border-b-4 border-slate-100 hover:bg-slate-50 font-sans">
                    Cancel
                 </button>
                 <button 
                   type="submit"
                   disabled={updating}
                   className="flex-2 py-4.5 bg-[#f87171] hover:bg-[#ef4444] text-white text-sm font-black rounded-3xl shadow-xl transition-all border-b-4 border-[#dc2626] disabled:opacity-50 flex items-center justify-center font-sans uppercase tracking-widest grow"
                 >
                    {updating ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Save All Changes'}
                 </button>
              </div>
           </form>
        </div>
      )}
    </div>
  );
}
