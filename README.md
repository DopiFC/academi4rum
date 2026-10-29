# Academi Forum (Dopi)

Diễn đàn học tập dùng React, TypeScript, Vite và Supabase. GitHub Pages chỉ phục vụ frontend tĩnh; xác thực, dữ liệu và tài liệu được lưu trên Supabase. Website không có dữ liệu mẫu và sẽ hiện hướng dẫn cấu hình nếu chưa có thông tin kết nối.

## Yêu cầu

- Node.js 20 trở lên và npm.
- Một dự án Supabase.
- Repository GitHub để triển khai GitHub Pages.

## Chạy ứng dụng

1. Cài dependency:

   ```bash
   npm ci
   ```

2. Tạo dự án tại [Supabase](https://supabase.com/), mở **Project Settings → API** và lấy Project URL cùng publishable key (hoặc anon key dành cho client).
3. Sao chép `.env.example` thành `.env` tại thư mục gốc và điền:

   ```dotenv
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=your-public-publishable-key
   ```

   Publishable key sẽ xuất hiện trong bundle trình duyệt; đây không phải khóa bí mật và chỉ an toàn khi RLS được thiết lập. Tuyệt đối không dùng service role key ở frontend.

4. Trong **Supabase → SQL Editor**, chạy toàn bộ [`supabase/schema.sql`](./supabase/schema.sql). Schema tạo bảng, index, dữ liệu danh mục ban đầu, trigger, RLS và bucket Storage riêng tư. Script có thể chạy lại an toàn nếu lần thiết lập trước bị dở dang; các tài khoản Auth đã tồn tại nhưng thiếu hồ sơ cũng được bổ sung hồ sơ và role `member`.
5. Chạy ứng dụng:

   ```bash
   npm run dev
   ```

6. Kiểm tra bản build:

   ```bash
   npm run build
   npm run preview
   ```

## Cập nhật vote, ảnh đại diện và ảnh bài viết

Sau khi đã chạy schema nền, chạy [`supabase/migrations/20261029_avatar_votes.sql`](./supabase/migrations/20261029_avatar_votes.sql) trong **Supabase → SQL Editor → New query**. Migration có thể chạy lại và sẽ:

- Tạo bảng vote riêng, bảo đảm mỗi thành viên chỉ vote một lần cho mỗi bài viết, cập nhật bộ đếm và index xếp hạng trang nhất.
- Tạo Storage bucket avatar công khai chỉ đọc; upload, thay thế và xóa bị giới hạn theo chủ tài khoản đã xác nhận email. Ảnh PNG/JPG tối đa 10 MB.
- Cho phép trang bài viết và bảng tin tạo URL có thời hạn cho ảnh đính kèm trong bucket diễn đàn riêng tư.

Bảng tin tải 12 bài mỗi lần; nội dung, danh mục và trạng thái bookmark không chặn việc hiển thị danh sách trong lúc hoàn thành các yêu cầu phụ như URL ảnh/vote.

## Cập nhật loại bài, thẻ chủ đề, đáp án hữu ích và tìm kiếm

Sau các migration trên, chạy [`supabase/migrations/20261029_forum_enhancements.sql`](./supabase/migrations/20261029_forum_enhancements.sql) trong **Supabase → SQL Editor → New query** trước khi triển khai phiên bản frontend có lọc loại bài, thẻ chủ đề, thư viện tài liệu và câu trả lời hữu ích. Migration bổ sung metadata bài viết, cập nhật full-text search để lập chỉ mục thẻ và tạo RPC bảo vệ quyền chọn/bỏ chọn câu trả lời hữu ích. RPC chỉ cho phép tác giả đã xác nhận email chọn bình luận gốc trên câu hỏi của họ; người dùng không được quyền cập nhật trực tiếp cột đáp án.

Migration cập nhật cột search document và index liên quan. Nếu có truy vấn hoặc view tùy chỉnh phụ thuộc trực tiếp vào `posts.search_document`, hãy kiểm tra chúng trước khi chạy migration. Sau khi áp dụng, làm mới trang; nếu PostgREST chưa nhận schema mới, chờ cache schema được làm mới rồi thử lại.

## Cấu hình Supabase Auth

1. Trong **Authentication → Providers → Email**, bật email provider và yêu cầu xác nhận email.
2. Trong **Authentication → URL Configuration**, đặt **Site URL** là URL Pages (ví dụ `https://username.github.io/repository/`) và thêm Redirect URLs tương ứng, gồm URL website cùng URL local khi phát triển (`http://localhost:5173/**`).
3. Đường dẫn callback dùng `HashRouter` (`#/auth`) và Supabase PKCE để callback tương thích hosting tĩnh. Mở email xác nhận/khôi phục trong cùng trình duyệt đã gửi yêu cầu để trình duyệt có PKCE verifier. Luồng đặt lại mật khẩu dùng `#/auth?mode=reset`.
4. Tùy chỉnh mẫu email xác nhận/khôi phục để liên kết dùng URL redirect của ứng dụng nếu cấu hình mặc định không giữ callback.
5. Người dùng mới có hồ sơ và role `member` tự động được tạo bởi trigger. Không cấp role qua profile/user metadata. Để cấp quản trị, chạy lệnh thủ công trong SQL Editor sau khi thay UUID bằng ID tài khoản đã xác minh:

   ```sql
   update public.user_roles set role = 'admin' where user_id = 'UUID_TAI_KHOAN';
   ```

   `user_roles` không có chính sách ghi cho client; quản lý role chỉ qua môi trường tin cậy.

## Bảo mật và quy tắc dữ liệu

- Tất cả bảng truy cập qua API đều bật RLS. Người chưa xác minh email chỉ đọc được nội dung công khai, không được tương tác.
- Trigger PostgreSQL kiểm tra giới hạn chỉnh sửa 30 phút theo `created_at` của máy chủ, bảo vệ tác giả/timestamp và từ chối yêu cầu API trực tiếp sau hạn. `updated_at` và bộ đếm là do database quản lý.
- Bucket `forum-attachments` là private, giới hạn 10 MB và các loại tệp được chấp nhận. Tải xuống trong ứng dụng dùng signed URL thời hạn 1 giờ sau khi kiểm tra phiên và RLS.
- Markdown được hiển thị bằng `react-markdown` và không bật raw HTML.
- Việc xóa bài trên trang “Bài viết của tôi” xóa file Storage trước, rồi mới xóa bài và metadata liên quan. Nếu xóa file thất bại, bài chưa bị xóa. Thao tác quản trị Storage phải tuân theo RLS.
- Supabase Storage không thực hiện quét virus trong bản này. Không tải tài liệu nhạy cảm hoặc tệp không có quyền chia sẻ.

## Xóa tài khoản an toàn

Phiên bản này chưa có nút tự xóa tài khoản. Khi có yêu cầu xóa, quản trị viên cần xác minh yêu cầu, xóa toàn bộ object trong bucket `forum-attachments` theo tiền tố `<user-id>/` trước (Storage không tự cascade theo user), rồi xóa user trong **Supabase → Authentication → Users**. Foreign key sẽ cascade hồ sơ, bài viết, bình luận, cảm xúc, bookmark, báo cáo và thông báo liên quan. Không thực hiện thao tác này bằng service role key ở frontend; chỉ quản trị viên có quyền dự án được xử lý.

## Triển khai GitHub Pages

1. Đẩy mã nguồn lên repository GitHub với nhánh chính tên `main`.
2. Trong repository, vào **Settings → Secrets and variables → Actions → Variables**, tạo:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`

   Đây là giá trị cấu hình public dùng để build; không tạo biến service role key.
3. Vào **Settings → Pages**, chọn nguồn **GitHub Actions**.
4. Push lên `main` hoặc chạy workflow **Deploy to GitHub Pages** thủ công trong tab Actions.
5. Kiểm tra workflow đã hoàn thành và truy cập URL GitHub Pages được cung cấp. `vite.config.ts` tự đặt base path theo `GITHUB_REPOSITORY`; trang user/organization dùng `/`.
6. Với custom domain, cấu hình domain trong GitHub Pages và tạo Actions Variable `VITE_BASE_PATH` bằng `/`. Nếu không đặt variable này, project Pages dùng base path `/<repository>/`.
7. Thêm chính xác URL đã deploy vào Supabase Auth Site URL và Redirect URLs.

## Lỗi thường gặp

- **Màn hình yêu cầu cấu hình:** kiểm tra `.env` hoặc Actions Variables, đúng tên biến và build lại sau khi thay đổi.
- **Trang con bị lỗi khi tải lại:** ứng dụng sử dụng `HashRouter`, URL phải có dạng `.../#/post/...`; không cấu hình router history fallback.
- **Sai đường dẫn asset trên Pages:** kiểm tra tên repository/nhánh và `GITHUB_REPOSITORY`; chạy workflow từ repository.
- **Email callback hoặc khôi phục mật khẩu quay về sai trang:** cập nhật Site URL/Redirect URLs trong Supabase và đường dẫn redirect có `#/auth`.
- **Lỗi RLS:** chạy toàn bộ schema bằng SQL Editor với quyền dự án, xác nhận email tài khoản, kiểm tra policies và role `member`.
- **Không tải được file:** xác nhận bucket `forum-attachments` tồn tại/private, schema Storage policies đã chạy, đúng MIME/giới hạn và email đã xác minh.
- **Không thể sửa bài:** quy tắc 30 phút được áp dụng theo thời gian database và không thể gia hạn bằng thay đổi đồng hồ máy khách.

## Tính năng hiện tại và giới hạn

Đã triển khai frontend responsive, đăng ký/đăng nhập/xác nhận email qua Supabase Auth, đặt lại mật khẩu, hồ sơ cơ bản, bảng tin và tìm kiếm full-text, lọc danh mục, sắp xếp, tạo/quản lý/xóa bài, sửa trong 30 phút, bình luận/trả lời/xóa, bốn cảm xúc, bookmark, tệp đính kèm private, báo cáo bài viết, thông báo database cho bình luận/trả lời/cảm xúc, nội quy và GitHub Actions deploy.

Dashboard xử lý báo cáo cho moderator/admin, báo cáo bình luận, upload avatar, trang hồ sơ công khai, thông báo UI/đánh dấu đã đọc, chỉnh sửa/xóa file đính kèm khi sửa bài, phân trang nâng cao, test tự động nghiệp vụ/RLS và quy trình xóa tài khoản cùng dữ liệu Storage chưa được triển khai. Báo cáo bài viết được lưu riêng và chỉ nhân sự có role mới đọc được. Cần xác minh thủ công kết nối email và RLS trên dự án Supabase thật.

## Kiểm tra

```bash
npm run build
npm run lint
```

Các luồng email thật, Storage và RLS phụ thuộc cấu hình Supabase của bên triển khai; không thể xác nhận chỉ bằng build cục bộ.
