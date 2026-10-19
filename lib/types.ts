import type { ContactType } from "./contacts";
import type { PriorityKey, StatusKey } from "./constants";

export type IssueContact = {
  id: number;
  type: ContactType;
  value: string;
  normalized_value: string;
  issue_count: number;
  issue_count_30d: number;
};

export type IssueRow = {
  id: number;
  title: string;
  description: string | null;
  category: string;
  status: StatusKey;
  priority: PriorityKey;
  campaign: string | null;
  pic_id: string | null;
  is_hot: boolean;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  pic_name: string | null;
  created_by_name: string | null;
  updated_by_name: string | null;
  contacts: IssueContact[];
  contacts_text: string;
  max_contact_reports_30d: number;
};

export type ContactStat = {
  type: ContactType;
  normalized_value: string;
  display_value: string;
  issue_count: number;
  issue_count_30d: number;
  open_issue_count: number;
  last_seen: string;
};

export type Profile = {
  id: string;
  email: string | null;
  full_name: string | null;
  role: "admin" | "agent";
  created_at: string;
};
