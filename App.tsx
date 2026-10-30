import { lazy, Suspense, useCallback, useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowBigUp, Bell, Camera, CheckCheck, Clock3, FileText, Heart, MessageCircle, Paperclip, Send, Trash2, Upload, X } from 'lucide-react';
import { AuthProvider, useAuth } from './auth/AuthContext';
import Layout from './components/Layout';
import AppErrorBoundary from './components/AppErrorBoundary';
import Avatar from './components/Avatar';
import DocumentLibraryPage from './components/DocumentLibraryPage';
import PostCard from './components/PostCard';
import RequireAuth from './components/RequireAuth';
import { ALLOWED_AVATAR_TYPES, ALLOWED_FILE_TYPES, AVATAR_BUCKET, getErrorMessage, isSupabaseConfigured, MAX_AVATAR_SIZE, MAX_FILE_SIZE, MAX_FILES_PER_POST, STORAGE_BUCKET, supabase } from './lib/supabase';
import { loadCategories } from './lib/forumData';
import type { Attachment, Category, Post, Profile, ReactionType } from './types';

const FEED_PAGE_SIZE = 12;
const MarkdownContent = lazy(() => import('./components/MarkdownContent'));

const REACTION_LABELS: Record<ReactionType, string> = {
  like: 'Thích',
  helpful: 'Hữu ích',
  thanks: 'Cảm ơn',
  impressive: 'Ấn tượng',
};

function ConfigurationNotice() {
  return (
    <div className="configuration-page">
      <div className="configuration-card">
        <div className="brand-mark"><FileText size={23} /></div>
        <h1>Academi Forum <span>(Dopi)</span></h1>
        <p>Ứng dụng chưa được kết nối với Supabase nên các chức năng dữ liệu và tài khoản hiện chưa hoạt động.</p>
        <ol>
          <li>Tạo dự án Supabase và chạy tệp <code>supabase/schema.sql</code>.</li>
          <li>Sao chép <code>.env.example</code> thành <code>.env</code>.</li>
          <li>Điền URL và publishable key của dự án, sau đó chạy <code>npm run dev</code>.</li>
        </ol>
      </div>
    </div>
  );
}

function AppContent() {
  if (!isSupabaseConfigured || !supabase) return <ConfigurationNotice />;
  return (
    <AppErrorBoundary>
      <AuthProvider>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<FeedPage />} />
            <Route path="auth" element={<AuthPage />} />
            <Route path="rules" element={<RulesPage />} />
            <Route path="library" element={<DocumentLibraryPage />} />
            <Route path="notifications" element={<RequireAuth><NotificationsPage /></RequireAuth>} />
            <Route path="post/:postId" element={<PostPage />} />
            <Route path="create" element={<RequireAuth><PostEditorPage /></RequireAuth>} />
            <Route path="edit/:postId" element={<RequireAuth><PostEditorPage /></RequireAuth>} />
            <Route path="my-posts" element={<RequireAuth><MyPostsPage /></RequireAuth>} />
            <Route path="saved" element={<RequireAuth><SavedPage /></RequireAuth>} />
            <Route path="profile" element={<RequireAuth><ProfilePage /></RequireAuth>} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </AuthProvider>
    </AppErrorBoundary>
  );
}

export default function App() {
  return <AppContent />;
}

function FeedPage() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [category, setCategory] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [sort, setSort] = useState('newest');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [votedIds, setVotedIds] = useState<Set<string>>(new Set());
  const [votingIds, setVotingIds] = useState<Set<string>>(new Set());
  const [attachmentUrls, setAttachmentUrls] = useState<Record<string, string>>({});
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const query = searchParams.get('q')?.trim() ?? '';
  const { user } = useAuth();
  const userId = user?.id;
  const isEmailVerified = Boolean(user?.email_confirmed_at);

  useEffect(() => {
    setPage(0);
    setPosts([]);
    setAttachmentUrls({});
    setHasMore(true);
  }, [category, query, sort, typeFilter]);

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    void loadCategories().then((data) => {
      if (!active) return;
      setCategories(data);
    }).catch((categoryError: unknown) => {
      if (active) setError(getErrorMessage(categoryError));
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!supabase || !userId) {
      setSavedIds(new Set());
      setVotedIds(new Set());
      return;
    }
    setVotedIds(new Set());
    let active = true;
    void supabase.from('bookmarks').select('post_id').eq('user_id', userId).then(({ data, error: savedError }) => {
      if (!active) return;
      if (savedError) setError(getErrorMessage(savedError));
      else setSavedIds(new Set((data ?? []).map((item) => item.post_id)));
    });
    return () => { active = false; };
  }, [userId]);

  useEffect(() => {
    let active = true;
    async function load() {
      const client = supabase;
      if (!client) return;
      setLoading(true);
      setError('');
      let request = client
        .from('posts')
        .select('id, author_id, category_id, post_type, tags, accepted_answer_comment_id, title, content, created_at, updated_at, comment_count, reaction_count, vote_count, profiles!posts_author_id_fkey(id, display_name, avatar_url), categories(id, name, slug), post_attachments(id, storage_path, file_name, mime_type, size_bytes)')
        .range(page * FEED_PAGE_SIZE, page * FEED_PAGE_SIZE + FEED_PAGE_SIZE - 1);
      if (category) request = request.eq('category_id', Number(category));
      if (typeFilter) request = request.eq('post_type', typeFilter);
      if (sort === 'unanswered') request = request.eq('post_type', 'question').is('accepted_answer_comment_id', null);
      if (query) request = request.textSearch('search_document', query, { type: 'websearch', config: 'simple' });
      if (sort === 'discussed') request = request.order('comment_count', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false }).order('id');
      else if (sort === 'popular') request = request.order('reaction_count', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false }).order('id');
      else if (sort === 'featured') request = request.order('vote_count', { ascending: false }).order('created_at', { ascending: false }).order('id');
      else request = request.order('created_at', { ascending: false }).order('id');
      const postResult = await request;
      if (!active) return;
      if (postResult.error) {
        setError(getErrorMessage(postResult.error));
        setLoading(false);
        return;
      }
      const pagePosts = (postResult.data ?? []) as unknown as Post[];
      setPosts((previous) => page === 0 ? pagePosts : [...previous, ...pagePosts]);
      setHasMore(pagePosts.length === FEED_PAGE_SIZE);
      setLoading(false);
      if (page === 0) setAttachmentUrls({});

      const postIds = pagePosts.map((post) => post.id);
      const imageAttachments = pagePosts.flatMap((post) => post.post_attachments ?? []).filter((attachment) => attachment.mime_type.startsWith('image/'));
      const followupTasks: Promise<void>[] = [];
      if (isEmailVerified && imageAttachments.length) {
        followupTasks.push((async () => {
          const { data, error: urlError } = await client.storage.from(STORAGE_BUCKET).createSignedUrls(imageAttachments.map((attachment) => attachment.storage_path), 60 * 60);
          if (!active) return;
          if (urlError) { setError(getErrorMessage(urlError)); return; }
          const urls = Object.fromEntries((data ?? []).flatMap((item) => item.signedUrl ? [[item.path, item.signedUrl]] : []));
          setAttachmentUrls((previous) => ({ ...previous, ...urls }));
        })());
      }
      if (isEmailVerified && userId && postIds.length) {
        followupTasks.push((async () => {
          const { data, error: votesError } = await client.from('post_votes').select('post_id').eq('user_id', userId).in('post_id', postIds);
          if (!active) return;
          if (votesError) setError(getErrorMessage(votesError));
          else setVotedIds((previous) => new Set([...previous, ...(data ?? []).map((item) => item.post_id)]));
        })());
      }
      void Promise.all(followupTasks);
    }
    void load();
    return () => { active = false; };
  }, [category, page, query, sort, typeFilter, userId, isEmailVerified]);

  async function toggleBookmark(post: Post) {
    if (!supabase || !user) {
      window.alert('Vui lòng đăng nhập và xác nhận email để lưu bài viết.');
      return;
    }
    const isSaved = savedIds.has(post.id);
    const result = isSaved
      ? await supabase.from('bookmarks').delete().eq('user_id', user.id).eq('post_id', post.id)
      : await supabase.from('bookmarks').insert({ user_id: user.id, post_id: post.id });
    if (result.error) window.alert(getErrorMessage(result.error));
    else setSavedIds((previous) => {
      const next = new Set(previous);
      if (isSaved) next.delete(post.id);
      else next.add(post.id);
      return next;
    });
  }

  async function toggleVote(post: Post) {
    if (!supabase || !userId || !isEmailVerified) {
      window.alert('Vui lòng đăng nhập và xác nhận email để vote bài viết.');
      return;
    }
    if (post.author_id === userId) return;
    const alreadyVoted = votedIds.has(post.id);
    setVotingIds((previous) => new Set(previous).add(post.id));
    const result = alreadyVoted
      ? await supabase.from('post_votes').delete().eq('post_id', post.id).eq('user_id', userId)
      : await supabase.from('post_votes').insert({ post_id: post.id, user_id: userId });
    if (result.error) setError(getErrorMessage(result.error));
    else {
      setVotedIds((previous) => {
        const next = new Set(previous);
        if (alreadyVoted) next.delete(post.id);
        else next.add(post.id);
        return next;
      });
      setPosts((previous) => previous.map((item) => item.id === post.id ? { ...item, vote_count: Math.max(0, item.vote_count + (alreadyVoted ? -1 : 1)) } : item));
    }
    setVotingIds((previous) => {
      const next = new Set(previous);
      next.delete(post.id);
      return next;
    });
  }

  return (
    <section>
      <div className="page-heading">
        <div><p className="eyebrow">CỘNG ĐỒNG HỌC TẬP</p><h1>{query ? `Kết quả tìm kiếm` : 'Bảng tin học tập'}</h1><p>Chia sẻ kiến thức, đặt câu hỏi và cùng nhau phát triển.</p></div>
        {user && <Link className="button button-primary small-create" to="/create">+ Tạo bài viết</Link>}
      </div>
      <div className="feed-controls">
        <div className="feed-type-filters" aria-label="Lọc loại bài viết">
          {[['', 'Tất cả'], ['question', 'Câu hỏi'], ['knowledge', 'Kiến thức'], ['resource', 'Tài liệu'], ['discussion', 'Thảo luận']].map(([value, label]) => <button key={value || 'all'} className={typeFilter === value ? 'active' : ''} onClick={() => { setTypeFilter(value); if (value && sort === 'unanswered') setSort('newest'); }} aria-pressed={typeFilter === value}>{label}</button>)}
        </div>
        <label>Danh mục
          <select value={category} onChange={(event) => setCategory(event.target.value)}><option value="">Tất cả danh mục</option>{categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
        </label>
        <label>Sắp xếp
          <select value={sort} onChange={(event) => { setSort(event.target.value); if (event.target.value === 'unanswered') setTypeFilter(''); }}><option value="newest">Mới nhất</option><option value="featured">Vote trang nhất</option><option value="discussed">Nhiều bình luận</option><option value="popular">Nhiều cảm xúc</option><option value="unanswered">Câu hỏi chưa có đáp án hữu ích</option></select>
        </label>
      </div>
      {loading && page === 0 && !posts.length ? <div className="state-panel feed-loading" role="status"><span className="loading-spinner" />Đang tải bài viết…</div> : error && !posts.length ? <div className="state-panel error-state"><h2>Không tải được dữ liệu</h2><p>{error}</p><button className="button" onClick={() => window.location.reload()}>Thử lại</button></div> : posts.length ? <><div className="post-list">{posts.map((post) => <PostCard key={post.id} post={post} saved={savedIds.has(post.id)} voted={votedIds.has(post.id)} voting={votingIds.has(post.id)} attachmentUrls={attachmentUrls} onBookmark={toggleBookmark} onVote={toggleVote} />)}</div>{error && <p className="form-error" role="alert">{error}</p>}{hasMore && <button className="button load-more" disabled={loading} onClick={() => setPage((current) => current + 1)}>{loading ? 'Đang tải…' : 'Tải thêm bài viết'}</button>}</> : <div className="state-panel empty-state"><h2>{query || category || typeFilter || sort !== 'newest' ? 'Không tìm thấy bài viết phù hợp' : 'Chưa có bài viết nào'}</h2><p>Hãy thử từ khóa khác, điều chỉnh bộ lọc hoặc quay lại sau.</p>{(query || category || typeFilter || sort !== 'newest') && <button className="button" onClick={() => { setCategory(''); setTypeFilter(''); setSort('newest'); navigate('/', { replace: true }); }}>Xóa bộ lọc</button>}{user && <Link className="button button-primary" to="/create">Tạo bài viết đầu tiên</Link>}</div>}
    </section>
  );
}

function AuthPage() {
  const [mode, setMode] = useState<'login' | 'register' | 'forgot' | 'reset'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (location.search.includes('mode=reset')) setMode('reset');
    const callbackError = new URLSearchParams(window.location.search).get('error_code');
    if (callbackError === 'otp_expired' || callbackError === 'token_expired') {
      setError('Liên kết xác nhận hoặc khôi phục đã hết hạn. Vui lòng yêu cầu gửi liên kết mới.');
    } else if (callbackError) {
      setError('Không thể xác thực liên kết. Vui lòng thử lại hoặc yêu cầu gửi liên kết mới.');
    }
  }, [location.search]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    setError('');
    setMessage('');
    if (mode === 'register' && password !== confirmPassword) return setError('Mật khẩu xác nhận không khớp.');
    if (mode === 'register' && !agreed) return setError('Bạn cần đồng ý với Điều khoản và Nội quy cộng đồng.');
    setBusy(true);
    try {
      if (mode === 'register') {
        if (name.trim().length < 2 || name.trim().length > 60) throw new Error('Tên hiển thị cần có từ 2 đến 60 ký tự.');
        const { data, error: authError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { display_name: name.trim() }, emailRedirectTo: `${window.location.origin}${window.location.pathname}#/auth` },
        });
        if (authError) throw authError;
        if (data.session) setMessage('Tài khoản đã tạo. Email của bạn đã được xác nhận, có thể bắt đầu sử dụng.');
        else setMessage('Đăng ký thành công. Hãy mở email và xác nhận tài khoản trước khi đăng bài.');
      } else if (mode === 'login') {
        const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (authError) throw authError;
        navigate((location.state as { from?: string } | null)?.from ?? '/');
      } else if (mode === 'forgot') {
        const { error: authError } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}${window.location.pathname}#/auth?mode=reset` });
        if (authError) throw authError;
        setMessage('Nếu email tồn tại, hướng dẫn đặt lại mật khẩu sẽ được gửi đến hộp thư của bạn.');
      } else {
        if (password.length < 8) throw new Error('Mật khẩu cần có ít nhất 8 ký tự.');
        if (password !== confirmPassword) throw new Error('Mật khẩu xác nhận không khớp.');
        const { error: authError } = await supabase.auth.updateUser({ password });
        if (authError) throw authError;
        setMessage('Đã cập nhật mật khẩu. Bạn có thể tiếp tục sử dụng tài khoản.');
        setMode('login');
      }
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  if (user && mode !== 'reset') return <div className="state-panel"><h2>Bạn đã đăng nhập</h2><p>{user.email_confirmed_at ? 'Tài khoản đã xác nhận email.' : 'Hãy xác nhận email trước khi tương tác.'}</p><Link className="button button-primary" to="/">Về bảng tin</Link></div>;

  const title = mode === 'login' ? 'Chào mừng trở lại' : mode === 'register' ? 'Tham gia Academi Forum' : mode === 'forgot' ? 'Khôi phục mật khẩu' : 'Đặt mật khẩu mới';
  return (
    <div className="auth-wrap">
      <form className="form-card auth-card" onSubmit={submit}>
        <p className="eyebrow">ACADEMI FORUM · DOPI</p><h1>{title}</h1>
        <p className="form-intro">{mode === 'register' ? 'Tạo tài khoản bằng email cá nhân để tham gia cộng đồng.' : 'Sử dụng email cá nhân để tiếp tục.'}</p>
        {mode === 'register' && <label>Tên hiển thị<input required minLength={2} maxLength={60} value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" /></label>}
        {mode !== 'reset' && <label>Email<input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" /></label>}
        {mode !== 'forgot' && <label>{mode === 'reset' ? 'Mật khẩu mới' : 'Mật khẩu'}<input type="password" required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} /></label>}
        {(mode === 'register' || mode === 'reset') && <label>Xác nhận mật khẩu<input type="password" required value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" /></label>}
        {mode === 'register' && <label className="checkbox-label"><input type="checkbox" checked={agreed} onChange={(event) => setAgreed(event.target.checked)} /> Tôi đồng ý với <Link to="/rules">Điều khoản sử dụng và Nội quy cộng đồng</Link>.</label>}
        {error && <p className="form-error" role="alert">{error}</p>}
        {message && <p className="form-success" role="status">{message}</p>}
        <button className="button button-primary submit-button" disabled={busy}>{busy ? 'Đang xử lý…' : mode === 'login' ? 'Đăng nhập' : mode === 'register' ? 'Tạo tài khoản' : mode === 'forgot' ? 'Gửi liên kết khôi phục' : 'Cập nhật mật khẩu'}</button>
        {mode === 'login' && <button type="button" className="text-button" onClick={() => setMode('forgot')}>Quên mật khẩu?</button>}
        {mode !== 'reset' && <p className="auth-switch">{mode === 'login' ? 'Chưa có tài khoản?' : 'Đã có tài khoản?'} <button type="button" className="text-button" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); setMessage(''); }}>{mode === 'login' ? 'Đăng ký' : 'Đăng nhập'}</button></p>}
      </form>
    </div>
  );
}

function PostEditorPage() {
  const { postId } = useParams();
  const editing = Boolean(postId);
  const { user } = useAuth();
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [postType, setPostType] = useState<Post['post_type']>('discussion');
  const [tagsInput, setTagsInput] = useState('');
  const [preview, setPreview] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [existingPost, setExistingPost] = useState<Post | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [uploadProgress, setUploadProgress] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(editing);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [serverNow, setServerNow] = useState<number | null>(null);

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    async function load() {
      try {
        setCategories(await loadCategories());
      } catch (caught) {
        if (active) setError(getErrorMessage(caught));
      }
      if (postId) {
        const { data, error: postError } = await supabase!.from('posts').select('id, author_id, category_id, post_type, tags, accepted_answer_comment_id, title, content, created_at, updated_at, comment_count, reaction_count, vote_count').eq('id', postId).single();
        if (!active) return;
        if (postError) setError(getErrorMessage(postError));
        else if (!data || data.author_id !== user?.id) setError('Bạn không có quyền sửa bài viết này.');
        else {
          const { data: timestamp, error: timeError } = await supabase!.rpc('server_now');
          if (timeError) setError(getErrorMessage(timeError));
          else setServerNow(new Date(timestamp).getTime() - Date.now());
          const post = data as Post;
          setExistingPost(post);
          setTitle(post.title);
          setContent(post.content);
          setCategoryId(String(post.category_id));
          setPostType(post.post_type ?? 'discussion');
          setTagsInput((post.tags ?? []).join(', '));
          if (!timeError && Date.now() + (new Date(timestamp).getTime() - Date.now()) >= new Date(post.created_at).getTime() + 30 * 60 * 1000) setError('Bài viết đã hết thời gian chỉnh sửa 30 phút.');
        }
        setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, [postId, user]);

  useEffect(() => {
    if (!editing) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (title || content || files.length) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [editing, title, content, files.length]);

  function chooseFiles(event: ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(event.target.files ?? []);
    const next = [...files, ...picked];
    if (next.length > MAX_FILES_PER_POST) setError(`Mỗi bài tối đa ${MAX_FILES_PER_POST} tệp.`);
    else if (picked.some((file) => file.size > MAX_FILE_SIZE)) setError('Mỗi tệp không được vượt quá 10 MB.');
    else if (picked.some((file) => !ALLOWED_FILE_TYPES.has(file.type))) setError('Định dạng tệp chưa được hỗ trợ.');
    else { setFiles(next); setError(''); }
    event.target.value = '';
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !user) return;
    const cleanTitle = title.trim();
    const cleanContent = content.trim();
    if (cleanTitle.length < 10 || cleanTitle.length > 180) return setError('Tiêu đề cần có từ 10 đến 180 ký tự.');
    if (cleanContent.length < 1 || cleanContent.length > 30000) return setError('Nội dung bắt buộc và không được vượt quá 30.000 ký tự.');
    if (!categoryId) return setError('Vui lòng chọn danh mục.');
    const tags = [...new Set(tagsInput.split(',').map((tag) => tag.trim().replace(/^#/, '').slice(0, 30)).filter(Boolean))];
    if (tags.length > 10) return setError('Mỗi bài viết có tối đa 10 thẻ chủ đề.');
    setBusy(true);
    setError('');
    let insertedId: string | null = null;
    const uploadedPaths: string[] = [];
    try {
      if (editing && existingPost && serverNow !== null && Date.now() + serverNow >= new Date(existingPost.created_at).getTime() + 30 * 60 * 1000) {
        throw new Error('Bài viết đã hết thời gian chỉnh sửa 30 phút.');
      }
      if (editing && postId) {
        const { error: updateError } = await supabase.from('posts').update({ title: cleanTitle, content: cleanContent, category_id: Number(categoryId), post_type: postType, tags }).eq('id', postId);
        if (updateError) throw updateError;
        insertedId = postId;
      } else {
        const { data, error: insertError } = await supabase.from('posts').insert({ author_id: user.id, category_id: Number(categoryId), post_type: postType, tags, title: cleanTitle, content: cleanContent }).select('id').single();
        if (insertError) throw insertError;
        insertedId = data.id;
      }
      if (files.length && insertedId) {
        for (const [index, file] of files.entries()) {
          setUploadProgress(`Đang tải tệp ${index + 1}/${files.length}: ${file.name}`);
          const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120) || 'attachment';
          const storagePath = `${user.id}/${insertedId}/${crypto.randomUUID()}-${safeName}`;
          const { error: uploadError } = await supabase.storage.from(STORAGE_BUCKET).upload(storagePath, file, { contentType: file.type, upsert: false });
          if (uploadError) throw uploadError;
          uploadedPaths.push(storagePath);
          const { error: metadataError } = await supabase.from('post_attachments').insert({
            post_id: insertedId, uploader_id: user.id, storage_path: storagePath, file_name: file.name.slice(0, 255), mime_type: file.type, size_bytes: file.size,
          });
          if (metadataError) throw metadataError;
        }
      }
      setSaved(true);
      setUploadProgress('');
      window.setTimeout(() => navigate(`/post/${insertedId}`), 700);
    } catch (caught) {
      if (uploadedPaths.length) {
        const { error: cleanupError } = await supabase.storage.from(STORAGE_BUCKET).remove(uploadedPaths);
        if (cleanupError) console.error('Unable to clean up failed uploads', cleanupError.message);
      }
      if (!editing && insertedId) {
        const { error: cleanupError } = await supabase.from('posts').delete().eq('id', insertedId);
        if (cleanupError) console.error('Unable to clean up incomplete post', cleanupError.message);
      }
      setError(getErrorMessage(caught));
    } finally {
      setUploadProgress('');
      setBusy(false);
    }
  }

  if (loading) return <div className="state-panel">Đang tải bài viết…</div>;
  if (editing && (!existingPost || (existingPost.author_id !== user?.id))) return <div className="state-panel error-state">{error || 'Không thể mở bài viết.'}</div>;
  return (
    <div className="editor-wrap">
      <div className="page-heading"><div><p className="eyebrow">{editing ? 'QUẢN LÝ NỘI DUNG' : 'CHIA SẺ KIẾN THỨC'}</p><h1>{editing ? 'Chỉnh sửa bài viết' : 'Tạo bài viết mới'}</h1><p>{editing ? 'Bài viết chỉ có thể chỉnh sửa trong 30 phút kể từ lúc đăng.' : 'Viết nội dung rõ ràng để cộng đồng dễ dàng trao đổi.'}</p></div></div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {saved && <p className="form-success" role="status">Đã lưu bài viết thành công.</p>}
      <form className="form-card editor-card" onSubmit={submit}>
        <label>Tiêu đề <span className="field-note">10–180 ký tự</span><input value={title} onChange={(event) => setTitle(event.target.value)} minLength={10} maxLength={180} required /></label>
        <label>Loại bài viết<select value={postType} onChange={(event) => setPostType(event.target.value as Post['post_type'])}><option value="question">Câu hỏi</option><option value="knowledge">Chia sẻ kiến thức</option><option value="resource">Chia sẻ tài liệu</option><option value="discussion">Thảo luận</option></select></label>
        <label>Danh mục<select value={categoryId} onChange={(event) => setCategoryId(event.target.value)} required><option value="">Chọn danh mục</option>{categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>Thẻ chủ đề <span className="field-note">Tối đa 10 thẻ, phân cách bằng dấu phẩy</span><input value={tagsInput} onChange={(event) => setTagsInput(event.target.value)} maxLength={320} placeholder="Ví dụ: tài chính, MBA, phương pháp học" /></label>
        <div className="editor-content-label"><span>Nội dung <small>Hỗ trợ Markdown · tối đa 30.000 ký tự</small></span><button className="text-button" type="button" onClick={() => setPreview((current) => !current)}>{preview ? 'Tiếp tục chỉnh sửa' : 'Xem trước'}</button></div>
        {preview ? <div className="markdown-body editor-preview"><Suspense fallback={<div role="status">Đang tải bản xem trước…</div>}><MarkdownContent content={content || 'Nội dung xem trước sẽ hiển thị tại đây.'} /></Suspense></div>
          : <textarea aria-label="Nội dung bài viết" value={content} onChange={(event) => setContent(event.target.value)} rows={13} maxLength={30000} required placeholder="Chia sẻ câu hỏi, kinh nghiệm hoặc tài liệu bạn muốn trao đổi…" />}
        {!editing && <div className="file-uploader">
          <label className="upload-button"><Upload size={17} /> Thêm tài liệu<input type="file" multiple accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.png,.jpg,.jpeg" onChange={chooseFiles} /></label>
          <span>PDF, Office, PNG/JPG · tối đa 10 MB/tệp · 5 tệp</span>
          <p className="upload-warning">Không tải lên tài liệu chứa dữ liệu cá nhân, thông tin mật hoặc nội dung bạn không có quyền chia sẻ.</p>
          {files.map((file, index) => <div className="selected-file" key={`${file.name}-${index}`}><Paperclip size={15} />{file.name}<button type="button" aria-label="Bỏ tệp" onClick={() => setFiles((previous) => previous.filter((_, fileIndex) => fileIndex !== index))}><X size={15} /></button></div>)}
          {uploadProgress && <p className="upload-progress" role="status">{uploadProgress}</p>}
        </div>}
        {categories.length === 0 && <p className="form-error" role="alert">Chưa có danh mục bài viết. Cần hoàn tất cài đặt database Supabase trước khi đăng bài.</p>}
        <button className="button button-primary submit-button" disabled={busy || saved || categories.length === 0}>{busy ? 'Đang lưu…' : editing ? 'Lưu thay đổi' : 'Đăng bài viết'}</button>
      </form>
    </div>
  );
}

function MyPostsPage() {
  const { user } = useAuth();
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState('');
  const [serverNow, setServerNow] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    if (!supabase || !user) return;
    setLoading(true);
    const [postResult, timeResult] = await Promise.all([
      supabase.from('posts').select('id, author_id, category_id, post_type, tags, accepted_answer_comment_id, title, content, created_at, updated_at, comment_count, reaction_count, vote_count, categories(id, name, slug)').eq('author_id', user.id).order('created_at', { ascending: false }).limit(100),
      supabase.rpc('server_now'),
    ]);
    const { data, error: queryError } = postResult;
    if (queryError) setError(getErrorMessage(queryError));
    else setPosts((data ?? []) as unknown as Post[]);
    if (timeResult.error) setError(getErrorMessage(timeResult.error));
    else setServerNow(new Date(timeResult.data).getTime() - Date.now());
    setLoading(false);
  }, [user]);
  useEffect(() => { void refresh(); }, [refresh]);

  async function deletePost(post: Post) {
    if (!supabase || !user || !window.confirm(`Bạn có chắc muốn xóa “${post.title}”? Bình luận và metadata đính kèm sẽ bị xóa.`)) return;
    setDeleting(post.id);
    const { data: attachments, error: attachmentError } = await supabase.from('post_attachments').select('storage_path').eq('post_id', post.id);
    if (attachmentError) { setError(getErrorMessage(attachmentError)); setDeleting(''); return; }
    if (attachments?.length) {
      const { error: storageError } = await supabase.storage.from(STORAGE_BUCKET).remove(attachments.map((item) => item.storage_path));
      if (storageError) { setError(`Không thể xóa tài liệu đính kèm: ${getErrorMessage(storageError)}. Bài viết chưa bị xóa.`); setDeleting(''); return; }
    }
    const { error: deleteError } = await supabase.from('posts').delete().eq('id', post.id).eq('author_id', user.id);
    if (deleteError) setError(getErrorMessage(deleteError));
    else setPosts((previous) => previous.filter((item) => item.id !== post.id));
    setDeleting('');
  }

  return <section><div className="page-heading"><div><p className="eyebrow">QUẢN LÝ NỘI DUNG</p><h1>Bài viết của tôi</h1><p>Theo dõi và quản lý các bài viết bạn đã chia sẻ.</p></div></div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {loading ? <div className="state-panel">Đang tải bài viết…</div> : !posts.length ? <div className="state-panel empty-state"><h2>Chưa có bài viết</h2><p>Bài viết bạn đăng sẽ xuất hiện tại đây.</p><Link className="button button-primary" to="/create">Tạo bài viết</Link></div> :
      <div className="owned-posts">{posts.map((post) => {
        const editable = serverNow !== null && Date.now() + serverNow < new Date(post.created_at).getTime() + 30 * 60 * 1000;
        return <article className="owned-post" key={post.id}><div><Link to={`/post/${post.id}`}><h2>{post.title}</h2></Link><p>{post.categories?.name} · {new Date(post.created_at).toLocaleString('vi-VN')} · {post.comment_count ?? 0} bình luận</p><span className={`edit-status ${editable ? 'can-edit' : 'locked'}`}>{editable ? 'Còn hạn chỉnh sửa' : 'Đã khóa chỉnh sửa'}</span></div><div className="owned-actions"><Link className="button" to={`/post/${post.id}`}>Mở bài</Link>{editable ? <Link className="button" to={`/edit/${post.id}`}>Chỉnh sửa</Link> : <span className="locked-label"><Clock3 size={15} /> Đã khóa</span>}<button className="button button-danger" disabled={deleting === post.id} onClick={() => void deletePost(post)}><Trash2 size={15} /> Xóa</button></div></article>;
      })}</div>}
  </section>;
}

function PostPage() {
  const { postId } = useParams();
  const { user } = useAuth();
  const [post, setPost] = useState<Post | null>(null);
  const [comments, setComments] = useState<Array<{ id: string; author_id: string; parent_id: string | null; content: string; created_at: string; profiles: Profile | null }>>([]);
  const [commentLimit, setCommentLimit] = useState(50);
  const [hasMoreComments, setHasMoreComments] = useState(false);
  const [reactions, setReactions] = useState<Record<string, number>>({});
  const [myReaction, setMyReaction] = useState<ReactionType | null>(null);
  const [hasVoted, setHasVoted] = useState(false);
  const [comment, setComment] = useState('');
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [attachmentUrls, setAttachmentUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [serverNow, setServerNow] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [reportReason, setReportReason] = useState('');
  const [reportDetails, setReportDetails] = useState('');
  const [showReport, setShowReport] = useState(false);
  const userId = user?.id;
  const isEmailVerified = Boolean(user?.email_confirmed_at);
  const location = useLocation();

  useEffect(() => {
    if (!location.hash) return;
    const targetId = location.hash.slice(1);
    if (targetId === 'report') setShowReport(true);
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(targetId)?.scrollIntoView({ block: 'start' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [location.hash, post, showReport]);

  const load = useCallback(async () => {
    const client = supabase;
    if (!client || !postId) return;
    setLoading(true);
    const voteRequest = userId
      ? client.from('post_votes').select('post_id').eq('post_id', postId).eq('user_id', userId).maybeSingle()
      : Promise.resolve({ data: null, error: null });
    const [postResult, commentsResult, reactionsResult, timeResult, voteResult] = await Promise.all([
      client.from('posts').select('id, author_id, category_id, post_type, tags, accepted_answer_comment_id, title, content, created_at, updated_at, comment_count, reaction_count, vote_count, profiles!posts_author_id_fkey(id, display_name, username, bio, field_of_study, avatar_url, created_at), categories(id, name, slug), post_attachments(id, post_id, uploader_id, storage_path, file_name, mime_type, size_bytes, created_at)').eq('id', postId).single(),
      client.from('comments').select('id, author_id, parent_id, content, created_at, profiles!comments_author_id_fkey(id, display_name, username, bio, field_of_study, avatar_url, created_at)').eq('post_id', postId).order('created_at').limit(commentLimit),
      client.from('reactions').select('type, user_id').eq('post_id', postId),
      client.rpc('server_now'),
      voteRequest,
    ]);
    if (timeResult.error) setError(getErrorMessage(timeResult.error));
    else setServerNow(new Date(timeResult.data).getTime() - Date.now());
    if (postResult.error) setError(getErrorMessage(postResult.error));
    else {
      const loadedPost = postResult.data as unknown as Post;
      setPost(loadedPost);
      const urls: Record<string, string> = {};
      if (isEmailVerified && loadedPost.post_attachments?.length) {
        const { data, error: urlError } = await client.storage.from(STORAGE_BUCKET).createSignedUrls(loadedPost.post_attachments.map((attachment) => attachment.storage_path), 60 * 60);
        if (urlError) setError(getErrorMessage(urlError));
        else {
          const byPath = new Map((data ?? []).flatMap((item) => item.signedUrl ? [[item.path, item.signedUrl] as const] : []));
          for (const attachment of loadedPost.post_attachments) {
            const signedUrl = byPath.get(attachment.storage_path);
            if (signedUrl) urls[attachment.id] = signedUrl;
          }
        }
      }
      setAttachmentUrls(urls);
    }
    if (commentsResult.error) setError(getErrorMessage(commentsResult.error));
    else {
      setComments((commentsResult.data ?? []) as unknown as typeof comments);
      setHasMoreComments((commentsResult.data?.length ?? 0) === commentLimit);
    }
    if (reactionsResult.error) setError(getErrorMessage(reactionsResult.error));
    else {
      const counts: Record<string, number> = {};
      for (const item of reactionsResult.data ?? []) counts[item.type] = (counts[item.type] ?? 0) + 1;
      setReactions(counts);
      setMyReaction((reactionsResult.data?.find((item) => item.user_id === userId)?.type as ReactionType | undefined) ?? null);
    }
    if (voteResult.error) setError(getErrorMessage(voteResult.error));
    else setHasVoted(Boolean(voteResult.data));
    setLoading(false);
  }, [commentLimit, isEmailVerified, postId, userId]);
  useEffect(() => { void load(); }, [load]);

  async function addComment(parentId: string | null = null) {
    if (!supabase || !user || !postId) return;
    const body = parentId ? replyText.trim() : comment.trim();
    if (!body || body.length > 5000) return setError('Bình luận cần có nội dung và tối đa 5.000 ký tự.');
    setSaving(true);
    const { error: insertError } = await supabase.from('comments').insert({ post_id: postId, author_id: user.id, content: body, parent_id: parentId });
    if (insertError) setError(getErrorMessage(insertError));
    else {
      if (parentId) { setReplyText(''); setReplyTo(null); }
      else setComment('');
      await load();
    }
    setSaving(false);
  }

  async function removeComment(commentId: string) {
    if (!supabase || !window.confirm('Bạn có chắc muốn xóa bình luận này?')) return;
    const { error: deleteError } = await supabase.from('comments').delete().eq('id', commentId);
    if (deleteError) setError(getErrorMessage(deleteError));
    else await load();
  }

  async function toggleReaction(type: ReactionType) {
    if (!supabase || !user || !postId) { setError('Vui lòng đăng nhập và xác nhận email để thả cảm xúc.'); return; }
    setSaving(true);
    const { error: reactionError } = myReaction === type
      ? await supabase.from('reactions').delete().eq('post_id', postId).eq('user_id', user.id)
      : await supabase.from('reactions').upsert({ post_id: postId, user_id: user.id, type }, { onConflict: 'post_id,user_id' });
    if (reactionError) setError(getErrorMessage(reactionError));
    else await load();
    setSaving(false);
  }

  async function toggleVote() {
    if (!supabase || !userId || !isEmailVerified || !postId || !post) {
      setError('Vui lòng đăng nhập và xác nhận email để vote bài viết.');
      return;
    }
    if (post.author_id === userId) {
      setError('Bạn không thể vote bài viết của chính mình.');
      return;
    }
    setSaving(true);
    const result = hasVoted
      ? await supabase.from('post_votes').delete().eq('post_id', postId).eq('user_id', userId)
      : await supabase.from('post_votes').insert({ post_id: postId, user_id: userId });
    if (result.error) setError(getErrorMessage(result.error));
    else {
      setHasVoted(!hasVoted);
      setPost((previous) => previous ? { ...previous, vote_count: Math.max(0, previous.vote_count + (hasVoted ? -1 : 1)) } : previous);
    }
    setSaving(false);
  }

  async function reportPost(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !user || !postId || !reportReason) return;
    setSaving(true);
    const { error: reportError } = await supabase.from('reports').insert({ reporter_id: user.id, target_type: 'post', target_id: postId, reason: reportReason, details: reportDetails.trim() || null });
    if (reportError) setError(getErrorMessage(reportError));
    else { setShowReport(false); setReportDetails(''); window.alert('Đã gửi báo cáo để đội ngũ kiểm duyệt xem xét.'); }
    setSaving(false);
  }

  async function selectAcceptedAnswer(commentId: string | null) {
    if (!supabase || !postId || !user || user.id !== post?.author_id) return;
    setSaving(true);
    setError('');
    const { error: rpcError } = await supabase.rpc('set_accepted_answer', { p_post_id: postId, p_comment_id: commentId });
    if (rpcError) setError(getErrorMessage(rpcError));
    else setPost((previous) => previous ? { ...previous, accepted_answer_comment_id: commentId } : previous);
    setSaving(false);
  }

  if (loading) return <div className="state-panel">Đang tải bài viết…</div>;
  if (!post) return <div className="state-panel error-state">{error || 'Không tìm thấy bài viết.'}</div>;
  const editable = user?.id === post.author_id && serverNow !== null && Date.now() + serverNow < new Date(post.created_at).getTime() + 30 * 60 * 1000;
  return <article className="detail-page">
    <Link className="back-link" to="/">← Quay lại bảng tin</Link>
    <div className="detail-meta"><Avatar name={post.profiles?.display_name} imageUrl={post.profiles?.avatar_url} /><div><strong>{post.profiles?.display_name ?? 'Thành viên'}</strong><span>{post.categories?.name} · {new Date(post.created_at).toLocaleString('vi-VN', { dateStyle: 'medium', timeStyle: 'short' })}</span></div><span className={`post-type-badge post-type-${post.post_type}`}>{post.post_type === 'question' ? 'Câu hỏi' : post.post_type === 'resource' ? 'Tài liệu' : post.post_type === 'knowledge' ? 'Chia sẻ kiến thức' : 'Thảo luận'}</span></div>
    <h1>{post.title}</h1>
    {editable && <Link className="button detail-edit" to={`/edit/${post.id}`}>Chỉnh sửa</Link>}
    {user?.id === post.author_id && !editable && <p className="locked-notice"><Clock3 size={16} /> Bài viết đã hết thời gian chỉnh sửa 30 phút.</p>}
    <div className="markdown-body"><Suspense fallback={<div className="state-panel" role="status">Đang tải nội dung…</div>}><MarkdownContent content={post.content} /></Suspense></div>
    {!!post.post_attachments?.length && <section className="detail-attachments"><h2>Tệp đính kèm</h2>{post.post_attachments.map((attachment: Attachment) => attachment.mime_type.startsWith('image/') && attachmentUrls[attachment.id] ? <a className="detail-image-attachment" key={attachment.id} href={attachmentUrls[attachment.id]} target="_blank" rel="noreferrer"><img src={attachmentUrls[attachment.id]} alt={attachment.file_name} loading="lazy" /><span>{attachment.file_name}</span><small>{(attachment.size_bytes / 1024 / 1024).toFixed(1)} MB</small></a> : attachmentUrls[attachment.id] ? <a key={attachment.id} href={attachmentUrls[attachment.id]} target="_blank" rel="noreferrer"><FileText size={17} /><span>{attachment.file_name}</span><small>{(attachment.size_bytes / 1024 / 1024).toFixed(1)} MB</small></a> : <p className="attachment-access-note" key={attachment.id}><FileText size={17} /> {attachment.file_name} — đăng nhập và xác nhận email để tải.</p>)}</section>}
    <div className="post-detail-vote"><button className={`reaction-button ${hasVoted ? 'active' : ''}`} onClick={() => void toggleVote()} disabled={saving || post.author_id === userId}><ArrowBigUp size={17} /> {hasVoted ? 'Đã vote' : 'Vote lên trang nhất'} <b>{post.vote_count}</b></button>{post.author_id === userId && <span>Bạn không thể vote bài viết của chính mình.</span>}</div>
    <div className="reactions-row">{(Object.keys(REACTION_LABELS) as ReactionType[]).map((type) => <button key={type} className={`reaction-button ${myReaction === type ? 'active' : ''}`} disabled={saving} onClick={() => void toggleReaction(type)}><Heart size={16} /> {REACTION_LABELS[type]} <b>{reactions[type] ?? 0}</b></button>)}</div>
    <section className="comments-section" id="comments"><h2><MessageCircle size={20} /> Bình luận ({post.comment_count ?? comments.length})</h2>
      {user?.email_confirmed_at ? <form className="comment-form" onSubmit={(event) => { event.preventDefault(); void addComment(); }}><textarea value={comment} onChange={(event) => setComment(event.target.value)} maxLength={5000} rows={3} placeholder="Chia sẻ ý kiến của bạn…" /><button className="button button-primary" disabled={saving || !comment.trim()}><Send size={16} /> Gửi bình luận</button></form> : <p className="signed-out-note"><Link to="/auth">Đăng nhập và xác nhận email</Link> để bình luận.</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="comment-list">{comments.filter((item) => item.parent_id === null).sort((a, b) => Number(b.id === post.accepted_answer_comment_id) - Number(a.id === post.accepted_answer_comment_id)).map((item) => <div className={`comment-item ${item.id === post.accepted_answer_comment_id ? 'accepted-answer' : ''}`} key={item.id}><Avatar name={item.profiles?.display_name} imageUrl={item.profiles?.avatar_url} className="small-avatar" /><div className="comment-body"><div className="comment-author"><strong>{item.profiles?.display_name ?? 'Thành viên'}</strong><time>{new Date(item.created_at).toLocaleString('vi-VN')}</time></div>{item.id === post.accepted_answer_comment_id && <span className="accepted-badge">Câu trả lời hữu ích nhất</span>}<p>{item.content}</p><div className="comment-actions">{user?.email_confirmed_at && <button className="text-button" onClick={() => { setReplyTo(replyTo === item.id ? null : item.id); setReplyText(''); }}>Trả lời</button>}{post.post_type === 'question' && user?.id === post.author_id && <button className="text-button" disabled={saving} onClick={() => void selectAcceptedAnswer(item.id === post.accepted_answer_comment_id ? null : item.id)}>{item.id === post.accepted_answer_comment_id ? 'Bỏ đánh dấu hữu ích' : 'Chọn câu trả lời hữu ích'}</button>}{item.author_id === user?.id && <button className="text-button" onClick={() => void removeComment(item.id)}>Xóa</button>}</div>
        {comments.filter((reply) => reply.parent_id === item.id).map((reply) => <div className="comment-reply" key={reply.id}><div className="comment-author"><Avatar name={reply.profiles?.display_name} imageUrl={reply.profiles?.avatar_url} className="small-avatar" /><strong>{reply.profiles?.display_name ?? 'Thành viên'}</strong><time>{new Date(reply.created_at).toLocaleString('vi-VN')}</time></div><p>{reply.content}</p>{reply.author_id === user?.id && <button className="text-button" onClick={() => void removeComment(reply.id)}>Xóa</button>}</div>)}
        {replyTo === item.id && <form className="reply-form" onSubmit={(event) => { event.preventDefault(); void addComment(item.id); }}><textarea value={replyText} onChange={(event) => setReplyText(event.target.value)} maxLength={5000} rows={2} placeholder="Viết câu trả lời…" /><button className="button button-primary" disabled={saving || !replyText.trim()}>Gửi trả lời</button></form>}
        </div></div>)}</div>
      {hasMoreComments && <button className="button load-more" disabled={loading} onClick={() => setCommentLimit((current) => current + 50)}>Tải thêm bình luận</button>}
    </section>
    <div className="report-action" id="report">{user?.email_confirmed_at ? <button className="text-button" onClick={() => setShowReport(!showReport)}>Báo cáo nội dung</button> : <Link className="text-button" to="/auth">Đăng nhập để báo cáo nội dung</Link>}</div>
    {showReport && <form className="form-card report-form" onSubmit={reportPost}><h3>Báo cáo bài viết</h3><label>Lý do<select value={reportReason} onChange={(event) => setReportReason(event.target.value)} required><option value="">Chọn lý do</option><option>Spam hoặc quảng cáo không phù hợp</option><option>Nội dung không liên quan đến học tập</option><option>Vi phạm bản quyền hoặc chia sẻ tài liệu trái phép</option><option>Nội dung xúc phạm, quấy rối</option><option>Thông tin sai lệch có dấu hiệu gây hại</option><option>Tiết lộ dữ liệu cá nhân</option><option>Lý do khác</option></select></label><label>Mô tả ngắn<textarea value={reportDetails} onChange={(event) => setReportDetails(event.target.value)} maxLength={1000} rows={3} /></label><button className="button button-primary" disabled={saving}>{saving ? 'Đang gửi…' : 'Gửi báo cáo'}</button></form>}
  </article>;
}

type ForumNotification = {
  id: string;
  kind: 'comment' | 'reply' | 'reaction' | 'report_resolved';
  is_read: boolean;
  created_at: string;
  post_id: string | null;
  comment_id: string | null;
  profiles: { display_name: string } | null;
  posts: { title: string } | null;
};

function NotificationsPage() {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<ForumNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [updating, setUpdating] = useState(false);

  const refresh = useCallback(async () => {
    if (!supabase || !user) return;
    setLoading(true);
    const { data, error: queryError } = await supabase
      .from('notifications')
      .select('id, kind, is_read, created_at, post_id, comment_id, profiles!notifications_actor_id_fkey(display_name), posts(title)')
      .eq('recipient_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50);
    if (queryError) setError(getErrorMessage(queryError));
    else {
      setNotifications((data ?? []) as unknown as ForumNotification[]);
      setError('');
    }
    setLoading(false);
  }, [user]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function markAllRead() {
    if (!supabase || !user || updating) return;
    setUpdating(true);
    const { error: updateError } = await supabase.from('notifications')
      .update({ is_read: true })
      .eq('recipient_id', user.id)
      .eq('is_read', false);
    if (updateError) setError(getErrorMessage(updateError));
    else setNotifications((items) => items.map((item) => ({ ...item, is_read: true })));
    setUpdating(false);
  }

  async function markRead(notification: ForumNotification) {
    if (!supabase || !user || notification.is_read) return;
    const { error: updateError } = await supabase.from('notifications')
      .update({ is_read: true })
      .eq('id', notification.id)
      .eq('recipient_id', user.id);
    if (updateError) setError(getErrorMessage(updateError));
    else setNotifications((items) => items.map((item) => item.id === notification.id ? { ...item, is_read: true } : item));
  }

  function describe(notification: ForumNotification) {
    const actor = notification.profiles?.display_name ?? 'Một thành viên';
    if (notification.kind === 'reply') return `${actor} đã trả lời bình luận của bạn.`;
    if (notification.kind === 'reaction') return `${actor} đã tương tác với bài viết của bạn.`;
    if (notification.kind === 'report_resolved') return 'Báo cáo của bạn đã được xử lý.';
    return `${actor} đã bình luận bài viết của bạn.`;
  }

  const unreadCount = notifications.filter((item) => !item.is_read).length;
  return <section className="notifications-page">
    <div className="page-heading"><div><p className="eyebrow">CẬP NHẬT TÀI KHOẢN</p><h1>Thông báo</h1><p>Bình luận và hoạt động liên quan đến nội dung của bạn.</p></div><button className="button" onClick={() => void markAllRead()} disabled={!unreadCount || updating}><CheckCheck size={16} /> Đánh dấu đã đọc</button></div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {loading ? <div className="state-panel" role="status"><span className="loading-spinner" />Đang tải thông báo…</div>
      : notifications.length ? <div className="notification-list">{notifications.map((item) => {
        const content = <><span className="notification-icon"><Bell size={17} /></span><span className="notification-content"><strong>{describe(item)}</strong><span>{item.posts?.title ?? 'Nội dung đã bị xóa hoặc không còn công khai'}</span><time>{new Date(item.created_at).toLocaleString('vi-VN')}</time></span>{!item.is_read && <span className="unread-dot" aria-label="Chưa đọc" />}</>;
        return item.post_id
          ? <Link className={`notification-item ${item.is_read ? '' : 'unread'}`} to={`/post/${item.post_id}`} key={item.id} onClick={() => void markRead(item)}>{content}</Link>
          : <article className={`notification-item ${item.is_read ? '' : 'unread'}`} key={item.id}>{content}</article>;
      })}</div>
        : <div className="state-panel empty-state"><h2>Chưa có thông báo</h2><p>Khi có bình luận hoặc hoạt động liên quan, thông báo sẽ xuất hiện tại đây.</p></div>}
  </section>;
}

function SavedPage() {
  const { user } = useAuth();
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  async function removeBookmark(post: Post) {
    if (!supabase || !user) return;
    const { error: deleteError } = await supabase.from('bookmarks').delete().eq('user_id', user.id).eq('post_id', post.id);
    if (deleteError) setError(getErrorMessage(deleteError));
    else setPosts((previous) => previous.filter((item) => item.id !== post.id));
  }
  useEffect(() => {
    async function load() {
      if (!supabase || !user) return;
      const { data, error: queryError } = await supabase.from('bookmarks').select('posts(id, author_id, category_id, post_type, tags, accepted_answer_comment_id, title, content, created_at, updated_at, comment_count, reaction_count, vote_count, profiles!posts_author_id_fkey(id, display_name, username, bio, field_of_study, avatar_url, created_at), categories(id, name, slug))').eq('user_id', user.id).order('created_at', { ascending: false }).limit(100);
      if (queryError) setError(getErrorMessage(queryError));
      else setPosts((data ?? []).flatMap((item) => item.posts ? [item.posts as unknown as Post] : []));
      setLoading(false);
    }
    void load();
  }, [user]);
  return <section><div className="page-heading"><div><p className="eyebrow">THƯ VIỆN CÁ NHÂN</p><h1>Bài viết đã lưu</h1><p>Các nội dung bạn muốn xem lại.</p></div></div>{error && <p className="form-error">{error}</p>}{loading ? <div className="state-panel">Đang tải…</div> : posts.length ? <div className="post-list">{posts.map((post) => <PostCard key={post.id} post={post} saved onBookmark={removeBookmark} />)}</div> : <div className="state-panel empty-state"><h2>Chưa lưu bài viết nào</h2><p>Bạn có thể lưu bài viết từ bảng tin để xem lại.</p><Link to="/" className="button">Khám phá bài viết</Link></div>}</section>;
}

function ProfilePage() {
  const { user } = useAuth();
  const userId = user?.id;
  const [profile, setProfile] = useState<Profile | null>(null);
  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [field, setField] = useState('');
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);

  useEffect(() => {
    if (!avatarFile) {
      setAvatarPreview(null);
      return;
    }
    const previewUrl = URL.createObjectURL(avatarFile);
    setAvatarPreview(previewUrl);
    return () => URL.revokeObjectURL(previewUrl);
  }, [avatarFile]);

  useEffect(() => {
    let active = true;
    async function load() {
      if (!supabase || !userId) return;
      const { data, error: queryError } = await supabase.from('profiles').select('id, display_name, username, bio, field_of_study, avatar_url, created_at').eq('id', userId).single();
      if (!active) return;
      if (queryError) setError(getErrorMessage(queryError));
      else { setProfile(data as Profile); setName(data.display_name); setBio(data.bio ?? ''); setField(data.field_of_study ?? ''); }
    }
    void load();
    return () => { active = false; };
  }, [userId]);

  function chooseAvatar(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!ALLOWED_AVATAR_TYPES.has(file.type)) {
      setError('Ảnh đại diện chỉ hỗ trợ định dạng PNG hoặc JPG.');
      return;
    }
    if (file.size > MAX_AVATAR_SIZE) {
      setError('Ảnh đại diện không được vượt quá 10 MB.');
      return;
    }
    setAvatarFile(file);
    setError('');
    setMessage('');
  }

  async function uploadAvatar() {
    if (!supabase || !user || !avatarFile) return;
    if (!user.email_confirmed_at) {
      setError('Vui lòng xác nhận email trước khi tải ảnh đại diện.');
      return;
    }
    setAvatarBusy(true);
    setError('');
    setMessage('');
    const extension = avatarFile.type === 'image/png' ? 'png' : 'jpg';
    const storagePath = `${user.id}/${crypto.randomUUID()}.${extension}`;
    const { error: uploadError } = await supabase.storage.from(AVATAR_BUCKET).upload(storagePath, avatarFile, {
      contentType: avatarFile.type,
      cacheControl: '31536000',
      upsert: false,
    });
    if (uploadError) {
      setError(getErrorMessage(uploadError));
      setAvatarBusy(false);
      return;
    }
    const publicUrl = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(storagePath).data.publicUrl;
    const { data: updatedProfile, error: updateError } = await supabase
      .from('profiles')
      .update({ avatar_url: publicUrl })
      .eq('id', user.id)
      .select('id, display_name, username, bio, field_of_study, avatar_url, created_at')
      .maybeSingle();
    if (updateError || !updatedProfile) {
      const { error: cleanupError } = await supabase.storage.from(AVATAR_BUCKET).remove([storagePath]);
      if (cleanupError) console.error('Unable to clean up failed avatar upload', cleanupError.message);
      setError(updateError ? getErrorMessage(updateError) : 'Không tìm thấy hồ sơ để cập nhật ảnh đại diện.');
      setAvatarBusy(false);
      return;
    }
    const previousPath = profile?.avatar_url ? getAvatarStoragePath(profile.avatar_url) : null;
    setProfile(updatedProfile as Profile);
    setAvatarFile(null);
    setMessage('Đã cập nhật ảnh đại diện.');
    if (previousPath && previousPath !== storagePath) {
      const { error: removeError } = await supabase.storage.from(AVATAR_BUCKET).remove([previousPath]);
      if (removeError) setMessage('Đã cập nhật ảnh đại diện, nhưng ảnh cũ chưa được dọn khỏi bộ nhớ.');
    }
    setAvatarBusy(false);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !user) return;
    if (!user.email_confirmed_at) {
      setError('Vui lòng xác nhận email trước khi cập nhật hồ sơ.');
      return;
    }
    setBusy(true); setError(''); setMessage('');
    const { data: updatedProfile, error: updateError } = await supabase
      .from('profiles')
      .update({ display_name: name.trim(), bio: bio.trim() || null, field_of_study: field.trim() || null })
      .eq('id', user.id)
      .select('id, display_name, username, bio, field_of_study, avatar_url, created_at')
      .maybeSingle();
    if (updateError) setError(getErrorMessage(updateError));
    else if (!updatedProfile) setError('Không tìm thấy hồ sơ để cập nhật. Database Supabase cần được cài đặt đầy đủ.');
    else {
      setProfile(updatedProfile as Profile);
      setName(updatedProfile.display_name);
      setBio(updatedProfile.bio ?? '');
      setField(updatedProfile.field_of_study ?? '');
      setMessage('Đã cập nhật hồ sơ.');
    }
    setBusy(false);
  }
  return <div className="editor-wrap">
    <div className="page-heading"><div><p className="eyebrow">TÀI KHOẢN CỦA BẠN</p><h1>Hồ sơ cá nhân</h1><p>Email đăng nhập không được công khai.</p></div></div>
    <form className="form-card editor-card" onSubmit={save}>
      <div className="profile-summary">
        <Avatar name={name} imageUrl={avatarPreview ?? profile?.avatar_url} className="large-avatar" />
        <div><strong>{name || 'Thành viên'}</strong><span>Tham gia {profile ? new Date(profile.created_at).toLocaleDateString('vi-VN') : ''}</span><span>{user?.email}</span>
          <div className="avatar-actions"><label className="button avatar-select"><Camera size={16} /> Chọn ảnh<input type="file" accept="image/png,image/jpeg" onChange={chooseAvatar} /></label><span>PNG/JPG · tối đa 10 MB</span></div>
        </div>
      </div>
      {avatarFile && <div className="avatar-pending"><span>{avatarFile.name}</span><button className="button button-primary" type="button" onClick={() => void uploadAvatar()} disabled={avatarBusy}>{avatarBusy ? 'Đang tải ảnh…' : 'Cập nhật ảnh'}</button><button className="text-button" type="button" onClick={() => setAvatarFile(null)} disabled={avatarBusy}>Hủy</button></div>}
      <label>Tên hiển thị<input value={name} onChange={(event) => setName(event.target.value)} required minLength={2} maxLength={60} /></label>
      <label>Ngành học hoặc lĩnh vực quan tâm<input value={field} onChange={(event) => setField(event.target.value)} maxLength={100} /></label>
      <label>Giới thiệu<textarea value={bio} onChange={(event) => setBio(event.target.value)} maxLength={500} rows={4} /></label>
      {error && <p className="form-error" role="alert">{error}</p>}
      {message && <p className="form-success" role="status">{message}</p>}
      <button className="button button-primary" disabled={busy}>{busy ? 'Đang lưu…' : 'Lưu hồ sơ'}</button>
    </form>
  </div>;
}

function getAvatarStoragePath(url: string): string | null {
  try {
    const parsed = new URL(url);
    const marker = `/storage/v1/object/public/${AVATAR_BUCKET}/`;
    const index = parsed.pathname.indexOf(marker);
    return index === -1 ? null : decodeURIComponent(parsed.pathname.slice(index + marker.length));
  } catch {
    return null;
  }
}

function RulesPage() {
  return <article className="rules-page"><p className="eyebrow">CÙNG XÂY DỰNG CỘNG ĐỒNG</p><h1>Nội quy cộng đồng</h1><p>Academi Forum (Dopi) là không gian phục vụ trao đổi học tập, nghiên cứu và phát triển cá nhân.</p><section><h2>1. Tôn trọng thành viên</h2><p>Trao đổi lịch sự, phản biện ý tưởng thay vì công kích cá nhân. Không quấy rối, xúc phạm hoặc phân biệt đối xử.</p></section><section><h2>2. Chia sẻ nội dung phù hợp</h2><p>Đăng nội dung có ích và liên quan đến học tập. Không spam, quảng cáo không phù hợp, phát tán mã độc hoặc thông tin sai lệch gây hại.</p></section><section><h2>3. Tôn trọng quyền riêng tư và bản quyền</h2><p>Không đăng thông tin cá nhân của người khác. Chỉ chia sẻ tài liệu bạn có quyền sử dụng; không tải lên thông tin mật của tổ chức.</p></section><section><h2>4. Tài khoản và trách nhiệm</h2><p>Không chia sẻ tài khoản. Thành viên chịu trách nhiệm với nội dung mình đăng. Sử dụng chức năng báo cáo khi phát hiện vi phạm.</p></section><section><h2>5. Kiểm duyệt</h2><p>Nội dung vi phạm có thể bị ẩn hoặc xóa theo quy định. Tài khoản vi phạm nghiêm trọng có thể bị hạn chế truy cập.</p></section></article>;
}

function NotFound() {
  return <div className="state-panel empty-state"><h1>Không tìm thấy trang</h1><p>Đường dẫn có thể không còn tồn tại.</p><Link className="button button-primary" to="/">Về bảng tin</Link></div>;
}
