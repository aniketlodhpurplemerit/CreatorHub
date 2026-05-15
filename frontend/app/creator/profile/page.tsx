"use client"

import React, { useState, useEffect, useRef } from 'react';
import { Camera, Edit, Share, Diamond, Zap, Link2, Link as LinkIcon, Lock, Heart, MessageSquare, ChevronDown, ArrowLeft, FileText, X, Loader2 } from 'lucide-react';
import api from '@/src/lib/api';
import toast from 'react-hot-toast';
import { useAuthStore } from '@/src/store/useAuthStore';

export default function CreatorProfilePage() {
  const [activeTab, setActiveTab] = useState('Posts');
  const [creator, setCreator] = useState<any>(null);
  const [stats, setStats] = useState<any>(null);
  const [posts, setPosts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [updating, setUpdating] = useState(false);
  
  // Edit Form State
  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [category, setCategory] = useState('');
  const [instagram, setInstagram] = useState('');
  const [twitter, setTwitter] = useState('');
  const [facebook, setFacebook] = useState('');
  const [tiktok, setTiktok] = useState('');
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState('');
  const [bannerFile, setBannerFile] = useState<File | null>(null);
  const [bannerPreview, setBannerPreview] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bannerInputRef = useRef<HTMLInputElement>(null);

  const updateUser = useAuthStore((s) => s.updateUser);

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const [dashRes, postRes] = await Promise.all([
          api.get('/creator/dashboard'),
          api.get('/creator/posts')
        ]);
        setCreator(dashRes.data.creator);
        setStats(dashRes.data.stats);
        setPosts(postRes.data);
        setName(dashRes.data.creator.name);
        setBio(dashRes.data.creator.bio || '');
        setCategory(dashRes.data.creator.category || 'Content Creator');
        setInstagram(dashRes.data.creator.socialLinks?.instagram || '');
        setTwitter(dashRes.data.creator.socialLinks?.twitter || '');
        setFacebook(dashRes.data.creator.socialLinks?.facebook || '');
        setTiktok(dashRes.data.creator.socialLinks?.tiktok || '');
        setAvatarPreview(dashRes.data.creator.avatar);
        setBannerPreview(dashRes.data.creator.banner || '');
      } catch (err) {
        console.error("Error fetching profile:", err);
        // toast.error("Failed to load profile data");
      } finally {
        setLoading(false);
      }
    };
    fetchProfile();
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, type: 'avatar' | 'banner') => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (type === 'avatar') {
        setAvatarFile(file);
        setAvatarPreview(URL.createObjectURL(file));
      } else {
        setBannerFile(file);
        setBannerPreview(URL.createObjectURL(file));
      }
    }
  };

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setUpdating(true);
    try {
      const formData = new FormData();
      formData.append('name', name);
      formData.append('bio', bio);
      formData.append('category', category);
      formData.append('instagram', instagram);
      formData.append('twitter', twitter);
      formData.append('facebook', facebook);
      formData.append('tiktok', tiktok);
      if (avatarFile) {
        formData.append('avatar', avatarFile);
      }
      if (bannerFile) {
        formData.append('banner', bannerFile);
      }

      const res = await api.put('/creator/update-profile', formData);

      setCreator(res.data);
      updateUser({
        name: res.data.name,
        avatar: res.data.avatar,
        bio: typeof res.data.bio === 'string' ? res.data.bio : bio,
      });
      toast.success("Profile updated successfully!");
      setEditModalOpen(false);
    } catch (err: any) {
      console.error("Update error:", err);
      toast.error(err.response?.data?.error || err.response?.data?.message || 'Failed to update profile');
    } finally {
      setUpdating(false);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center min-h-screen bg-[#f9f9f9]"><Loader2 className="w-10 h-10 animate-spin text-rose-500" /></div>;
  }

  return (
    <div className="flex bg-[#f9f9f9] min-h-screen font-sans">
      
      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto">
         
         {/* Hero Banner Section */}
         <div className="relative h-80 w-full group">
            <img src={creator?.banner || "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=1600&q=80"} className="w-full h-full object-cover" alt="Banner" />
            <div className="absolute inset-0 bg-black/10 transition-colors group-hover:bg-black/20"></div>
            
            <button 
              onClick={() => window.history.back()}
              className="absolute top-8 left-8 bg-white/80 hover:bg-white backdrop-blur-md p-2 px-6 rounded-full flex items-center gap-2 text-sm font-bold text-slate-700 transition-all shadow-xl"
            >
               <ArrowLeft className="w-4 h-4" /> Back
            </button>
         </div>

         <div className="max-w-[1240px] mx-auto px-10 relative -mt-32 pb-20">
            
            {/* Profile Header Card */}
            <div className="bg-white rounded-[40px] p-10 shadow-2xl border border-slate-100/50 mb-10 overflow-hidden relative">
               
               <div className="flex flex-wrap items-end justify-between gap-10">
                  <div className="flex items-end gap-10">
                     <div className="w-[200px] h-[200px] rounded-full border-[6px] border-white shadow-2xl relative overflow-hidden group bg-slate-100 flex items-center justify-center">
                        {creator?.avatar ? (
                          <img src={creator.avatar} className="w-full h-full object-cover" alt={creator.name} />
                        ) : (
                          <span className="text-6xl font-black text-rose-500 uppercase">{creator?.name?.charAt(0)}</span>
                        )}
                     </div>
                     <div className="pb-4">
                        <div className="flex items-center gap-3 mb-1">
                           <h1 className="text-[44px] font-black text-[#1c1917] tracking-tight leading-tight font-['Fjalla_One'] uppercase">{creator?.name}</h1>
                           <span className="px-3 py-1 bg-rose-50 border border-rose-100 rounded-full text-[10px] font-black text-rose-500 uppercase tracking-widest mt-1">{creator?.category || 'Creator'}</span>
                        </div>
                        <p className="text-[17px] font-bold text-slate-500 mt-1 max-w-sm">{creator?.bio || 'No bio available'}</p>

                        <div className="flex items-center gap-10 mt-8 font-['Fjalla_One']">
                           <div>
                              <p className="text-[26px] font-black text-[#1c1917]">{creator?.subscribers?.length || 0}</p>
                              <p className="text-[13px] font-bold text-slate-400 uppercase tracking-tighter">Subscribers</p>
                           </div>
                           <div>
                              <p className="text-[26px] font-black text-[#1c1917]">{posts.length}</p>
                              <p className="text-[13px] font-bold text-slate-400 uppercase tracking-tighter">Posts</p>
                           </div>
                           <div>
                              <p className="text-[26px] font-black text-[#1c1917]">
                                {stats?.averageRating !== undefined && stats?.averageRating !== null ? `${stats.averageRating}/5` : '—'}
                              </p>
                              <p className="text-[13px] font-bold text-slate-400 uppercase tracking-tighter">Rating</p>
                           </div>
                        </div>
                     </div>
                  </div>

                  <div className="flex flex-wrap gap-3 pb-4">
                     <button 
                       onClick={() => setEditModalOpen(true)}
                       className="flex items-center gap-2 px-6 py-3 border border-slate-200 rounded-full text-sm font-bold text-slate-700 hover:bg-slate-50 transition-colors shadow-sm"
                     >
                        <Edit className="w-4 h-4" /> Edit profile
                     </button>
                     <button className="flex items-center gap-2 px-6 py-3 border border-slate-200 rounded-full text-sm font-bold text-slate-700 hover:bg-slate-50 transition-colors shadow-sm">
                        <Share className="w-4 h-4" /> Share profile
                     </button>
                     <button className="flex items-center gap-2 px-8 py-3 bg-[#f87171] hover:bg-[#ef4444] text-white text-sm font-black rounded-full shadow-lg transition-all active:scale-95">
                        <Zap className="w-4 h-4 fill-white" /> Get in touch
                     </button>
                  </div>
               </div>

               {/* Connected Links Section */}
               <div className="mt-16 pt-10 border-t border-slate-100 flex flex-col gap-6">
                  <h4 className="text-[15px] font-bold text-slate-400 uppercase tracking-widest pl-2">Connected links</h4>
                  <div className="flex flex-wrap gap-4">
                     {creator?.socialLinks && Object.entries(creator.socialLinks).map(([platform, url], i) => (
                        url ? (
                          <div key={i} className="flex items-center gap-3 px-6 py-3 bg-[#f9f9f9] border border-slate-200/50 rounded-2xl text-[14px] font-bold text-slate-600 hover:bg-white hover:shadow-sm transition-all cursor-pointer">
                             <Link2 className="w-4 h-4 text-slate-800" /> {url as string}
                          </div>
                        ) : null
                     ))}
                     <button className="text-[13px] font-bold text-slate-400 hover:text-rose-500 transition-colors pl-2">+ Add more</button>
                  </div>
               </div>
            </div>

            {/* Content Tabs Feed */}
            <div className="space-y-10">
               <div className="flex gap-12 border-b border-slate-200/60 pl-4">
                  {['Posts', 'Videos', 'Livestreams', 'Reviews', 'About'].map((tab) => (
                    <button
                      key={tab}
                      onClick={() => setActiveTab(tab)}
                      className={`text-[15px] font-bold pb-6 border-b-2 transition-all duration-200 flex items-center gap-2 ${activeTab === tab ? 'text-rose-500 border-rose-500' : 'text-slate-400 hover:text-slate-600 border-transparent'}`}
                    >
                      {tab === 'Posts' && <FileText className="w-4 h-4" />}
                      {tab}
                    </button>
                  ))}
               </div>

               {/* Content Rendering based on Active Tab */}
               {activeTab === 'About' ? (
                 <div className="space-y-6">
                   <div className="bg-white border border-slate-100 rounded-[32px] p-10 shadow-sm">
                      <h3 className="text-[20px] font-black text-[#1c1917] mb-6 font-['Fjalla_One'] uppercase tracking-tight">Bio</h3>
                      <p className="text-[16px] leading-[1.6] text-slate-600 font-medium">
                        {creator?.bio || "No biography provided yet. Add one in the profile settings."}
                      </p>
                   </div>

                   <div className="bg-white border border-slate-100 rounded-[32px] p-10 shadow-sm">
                      <h3 className="text-[20px] font-black text-[#1c1917] mb-6 font-['Fjalla_One'] uppercase tracking-tight">Expertise</h3>
                      <div className="flex flex-wrap gap-3">
                         {(creator?.category || 'General Content').split(',').map((cat: string, i: number) => (
                           <span key={i} className="px-5 py-2.5 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-bold text-slate-600">
                             {cat.trim()}
                           </span>
                         ))}
                      </div>
                   </div>
                 </div>
               ) : (
                 <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                    {posts.filter((p: any) => {
                       if (activeTab === 'Videos') return p.mediaType === 'video';
                       if (activeTab === 'Livestreams') return p.mediaType === 'livestream';
                       return true;
                    }).length > 0 ? posts.filter((p: any) => {
                       if (activeTab === 'Videos') return p.mediaType === 'video';
                       if (activeTab === 'Livestreams') return p.mediaType === 'livestream';
                       return true;
                    }).map((post, i) => (
                       <div key={post._id} className="group cursor-pointer">
                          <div className="bg-white rounded-[32px] overflow-hidden shadow-sm hover:shadow-xl transition-all duration-300 border border-slate-100/50">
                             <div className="relative aspect-square flex items-center justify-center bg-slate-50">
                                {post.mediaType === 'file' ? (
                                  <div className="text-8xl select-none">📄</div>
                                ) : (
                                  <img src={post.thumbnailUrl || post.mediaUrl} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" alt={post.title} />
                                )}
                                <div className="absolute inset-0 bg-black/10 group-hover:bg-black/20 transition-colors"></div>
                                {post.isExclusive && (
                                  <div className="absolute left-4 top-4 bg-black/40 backdrop-blur-xl px-4 py-1.5 rounded-full flex items-center gap-2 text-white text-[11px] font-black tracking-widest border border-white/20">
                                     <Lock className="w-3 h-3" /> Exclusive
                                  </div>
                                )}
                                {post.policyViolationLocked && (
                                  <div className="absolute right-4 top-4 bg-amber-600/90 backdrop-blur-xl px-3 py-1.5 rounded-full text-white text-[10px] font-black tracking-widest border border-amber-200/30 uppercase">
                                     {post.policyViolationLabel || 'Policy Violation'}
                                  </div>
                                )}
                             </div>
                             <div className="p-6">
                                <h3 className="text-[15px] font-bold text-[#1c1917] mb-2 leading-tight group-hover:text-rose-500 transition-colors font-['Fjalla_One'] uppercase">{post.title}</h3>
                                <div className="flex items-center justify-between mt-4">
                                   <p className="text-[12px] font-bold text-slate-400 uppercase tracking-tighter">{new Date(post.createdAt).toLocaleDateString()}</p>
                                   <div className="flex items-center gap-4 text-slate-400">
                                      <div className="flex items-center gap-1.5"><Heart className="w-4 h-4" /> <span className="text-[12px] font-bold tracking-tighter">{post.likes || 0}</span></div>
                                      <div className="flex items-center gap-1.5"><MessageSquare className="w-4 h-4" /> <span className="text-[12px] font-bold tracking-tighter">{post.comments || 0}</span></div>
                                   </div>
                                </div>
                             </div>
                          </div>
                       </div>
                    )) : (
                       <div className="col-span-full py-20 text-center text-slate-400 border-2 border-dashed border-slate-200 rounded-[40px]">
                          <p className="text-lg font-bold">No {activeTab.toLowerCase()} published yet.</p>
                       </div>
                    )}
                 </div>
               )}
            </div>

         </div>
      </div>

      {/* Edit Profile Modal */}
      {editModalOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
           <div className="bg-white w-full max-w-[500px] max-h-[90vh] overflow-y-auto rounded-[32px] shadow-2xl px-8 py-6 relative animate-in fade-in zoom-in duration-200">
              <button 
                onClick={() => setEditModalOpen(false)}
                className="absolute right-6 top-6 p-2 text-slate-400 hover:text-slate-600 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>

              <h2 className="text-2xl font-black text-[#1c1917] mb-8 tracking-tight font-['Fjalla_One'] uppercase">Edit Profile</h2>

              <form onSubmit={handleUpdateProfile} className="space-y-6">
                 {/* Avatar Upload */}
                 <div className="flex flex-col items-center gap-4 mb-4">
                    <div className="relative group cursor-pointer" onClick={() => fileInputRef.current?.click()}>
                       <div className="w-24 h-24 rounded-full overflow-hidden border-2 border-slate-100 shadow-md flex items-center justify-center bg-slate-50">
                          {avatarPreview ? (
                            <img src={avatarPreview} className="w-full h-full object-cover" alt="Profile preview" />
                          ) : (
                            <Camera className="w-8 h-8 text-slate-300" />
                          )}
                       </div>
                       <div className="absolute inset-0 bg-black/40 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                          <Camera className="w-8 h-8 text-white" />
                       </div>
                       <input 
                         type="file" 
                         ref={fileInputRef} 
                         className="hidden" 
                         accept="image/*" 
                         onChange={(e) => handleFileChange(e, 'avatar')} 
                       />
                    </div>
                    <p className="text-xs font-bold text-slate-400">Click to update profile picture</p>
                 </div>

                 <div className="mb-6">
                    <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-3 ml-1 font-['Fjalla_One']">Cover Image</label>
                    <div className="relative h-32 rounded-2xl overflow-hidden border border-slate-200 bg-slate-100 group">
                       {bannerPreview ? (
                         <img src={bannerPreview} className="w-full h-full object-cover" alt="Banner preview" />
                       ) : (
                         <div className="w-full h-full flex items-center justify-center text-slate-300 italic text-sm">No cover image set</div>
                       )}
                       <div className="absolute inset-0 bg-black/20 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                         <button 
                           type="button"
                           onClick={() => bannerInputRef.current?.click()}
                           className="px-6 py-2.5 bg-white/95 backdrop-blur-md rounded-full text-xs font-black text-slate-900 uppercase tracking-widest shadow-xl border border-slate-200 hover:scale-105 active:scale-95 transition-all"
                         >
                           Change Cover
                         </button>
                       </div>
                       <input 
                         type="file" 
                         ref={bannerInputRef} 
                         className="hidden" 
                         accept="image/*" 
                         onChange={(e) => handleFileChange(e, 'banner')} 
                       />
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div>
                       <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Full Name</label>
                       <input 
                         type="text" 
                         value={name}
                         onChange={(e) => setName(e.target.value)}
                         className="w-full bg-[#f9f9f9] border border-slate-200 rounded-2xl px-5 py-3.5 text-sm font-bold text-[#1c1917] focus:outline-none focus:ring-2 focus:ring-rose-200 transition-all font-sans" 
                       />
                    </div>
                    <div>
                       <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Creator Category</label>
                       <input 
                         type="text" 
                         placeholder="e.g. Digital Artist, Fitness Influencer"
                         value={category}
                         onChange={(e) => setCategory(e.target.value)}
                         className="w-full bg-[#f9f9f9] border border-slate-200 rounded-2xl px-5 py-3.5 text-sm font-bold text-[#1c1917] focus:outline-none focus:ring-2 focus:ring-rose-200 transition-all font-sans" 
                       />
                    </div>
                    <div>
                       <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Bio</label>
                       <textarea 
                         value={bio}
                         onChange={(e) => setBio(e.target.value)}
                         rows={2}
                         className="w-full bg-[#f9f9f9] border border-slate-200 rounded-2xl px-5 py-3.5 text-sm font-bold text-[#1c1917] focus:outline-none focus:ring-2 focus:ring-rose-200 transition-all resize-none font-sans" 
                       />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                       <div>
                          <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Instagram</label>
                          <input 
                             type="text" 
                             value={instagram}
                             onChange={(e) => setInstagram(e.target.value)}
                             placeholder="@username"
                             className="w-full bg-[#f9f9f9] border border-slate-200 rounded-2xl px-5 py-3.5 text-sm font-bold text-[#1c1917] focus:outline-none focus:ring-2 focus:ring-rose-200 transition-all font-sans" 
                          />
                       </div>
                       <div>
                          <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Twitter</label>
                          <input 
                             type="text" 
                             value={twitter}
                             onChange={(e) => setTwitter(e.target.value)}
                             placeholder="@username"
                             className="w-full bg-[#f9f9f9] border border-slate-200 rounded-2xl px-5 py-3.5 text-sm font-bold text-[#1c1917] focus:outline-none focus:ring-2 focus:ring-rose-200 transition-all font-sans" 
                          />
                       </div>
                    </div>
                 </div>

                 <div className="flex gap-3 pt-4">
                    <button 
                      type="button"
                      onClick={() => setEditModalOpen(false)}
                      className="flex-1 py-3.5 bg-white border border-slate-200 text-slate-700 text-sm font-black rounded-full hover:bg-slate-50 transition-all font-sans"
                    >
                       Cancel
                    </button>
                    <button 
                      type="submit"
                      disabled={updating}
                      className="flex-1 py-3.5 bg-[#f87171] text-white text-sm font-black rounded-full hover:bg-[#ef4444] transition-all shadow-lg active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2 font-sans"
                    >
                       {updating ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save Changes'}
                    </button>
                 </div>
              </form>
           </div>
        </div>
      )}

    </div>
  );
}
