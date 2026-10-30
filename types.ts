export type Profile = {
  id: string;
  display_name: string;
  username: string | null;
  bio: string | null;
  field_of_study: string | null;
  avatar_url: string | null;
  created_at: string;
};

export type Category = {
  id: number;
  name: string;
  slug: string;
};

export type Attachment = {
  id: string;
  post_id: string;
  uploader_id: string;
  storage_path: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
};

export type Post = {
  id: string;
  author_id: string;
  category_id: number;
  post_type: 'question' | 'knowledge' | 'resource' | 'discussion';
  tags: string[];
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
  comment_count: number;
  reaction_count: number;
  vote_count: number;
  accepted_answer_comment_id: string | null;
  profiles: Profile | null;
  categories: Category | null;
  post_attachments?: Attachment[];
  comments?: { count: number }[];
};

export type ReactionType = 'like' | 'helpful' | 'thanks' | 'impressive';
