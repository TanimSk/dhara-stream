export type Role = "master" | "client";
export type Visibility = "public" | "private";

export interface User {
  id: number;
  email: string;
  name: string;
  role: Role;
  client: { id: number; name: string; slug: string; status: "active" | "suspended" } | null;
}

export interface Bucket {
  name: string;
  account_id: string;
  access_key_id: string;
  manual: boolean;
  status: "provisioning" | "ready" | "failed";
  error: string;
  created_at: string;
}

export interface AdminClient {
  id: number;
  name: string;
  slug: string;
  status: "active" | "suspended";
  allowed_domains: string[];
  allow_direct: boolean;
  api_key_id: string;
  notes: string;
  created_at: string;
  bucket: Bucket | null;
  owner_email: string | null;
  video_count: number;
  storage_bytes: number;
}

export interface Category {
  id: number;
  name: string;
  description: string;
  visibility: Visibility;
  video_count: number;
  created_at: string;
}

export interface Video {
  id: string;
  title: string;
  description: string;
  visibility: Visibility;
  effective_visibility: Visibility;
  category: number | null;
  category_name: string | null;
  status: "uploading" | "ready" | "failed";
  source: "hls" | "mp4";
  uploaded_via: "desktop" | "web";
  original_filename: string;
  duration: number;
  width: number;
  height: number;
  size_bytes: number;
  qualities: number[];
  thumbnail_url: string | null;
  created_at: string;
  ready_at: string | null;
}

export interface Page<T> {
  count: number;
  num_pages: number;
  current_page: number;
  results: T[];
}

export interface Account {
  id: number;
  name: string;
  slug: string;
  status: string;
  allowed_domains: string[];
  allow_direct: boolean;
  api_key_id: string;
  bucket_status: string;
}

export interface UploadInfo {
  key_hex: string;
  key_uri: string;
  segment_seconds: number;
  allowed_heights: number[];
}
