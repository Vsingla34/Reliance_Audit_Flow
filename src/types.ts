export type UserRole = 
  | 'admin' 
  | 'ho' 
  | 'dm' 
  | 'sm' 
  | 'asm' 
  | 'ase' 
  | 'distributor' 
  | 'auditor';

export interface UserProfile {
  uid: string;
  name: string;
  email: string;
  role: UserRole;
  mobile?: string;
  region?: string;
  active: boolean;
}

export interface Distributor {
  id: string;
  code: string;
  name: string;
  contactPerson?: string;
  contactNumber?: string;
  email?: string;
  address?: string;
  city?: string;
  state?: string;
  approvedValue: number;
  aseId: string | null;
  asmId?: string | null;
  smId?: string | null;
  dmId?: string | null;
  active: boolean;
}

export interface DateProposal {
  id: string;
  date: string;
  proposedByUserId: string;
  proposedByName: string;
  role: string;
  email: string;
  remarks: string;
  timestamp: string;
}

export interface PresenceLog {
  userId: string;
  role: string;
  timestamp: string;
  location?: {
    lat: number;
    lng: number;
  };
}

export interface SignOff {
  userId: string;
  name: string;
  timestamp: string;
}

export interface MediaUpload {
  id: string;
  type: 'image' | 'video';
  url: string;
  uploadedBy: string;
  timestamp: string;
}

export interface AuditComment {
  id: string;
  userId: string;
  userName: string;
  userRole: string;
  message: string;
  timestamp: string;
}

export interface AuditTicket {
  id: string;
  distributorId: string;
  scheduledDate: string | null;
  proposedDate: string | null;
  auditorId: string | null;
  approvedValue: number;
  maxAllowedValue: number;
  status: 'tentative' | 'scheduled' | 'in_progress' | 'submitted' | 'signed' | 'evidence_uploaded' | 'closed';
  verifiedTotal: number;
  presenceLogs: PresenceLog[];
  signOffs: {
    auditor?: SignOff;
    ase?: SignOff;
    distributor?: SignOff;
  };
  media: MediaUpload[];
  dateProposals?: DateProposal[]; 
  comments?: AuditComment[]; // <-- ADDED THIS LINE so the chat works!
  createdAt: string;
  updatedAt: string;
}

export interface AuditLineItem {
  id: string;
  ticketId: string;
  articleNumber: string;
  description: string;
  category: string;
  quantity: number;
  unitValue: number;
  totalValue: number;
  reasonCode: string;
  remarks?: string;
}

export interface SalesDumpItem {
  id: string;
  articleNumber: string;
  description: string;
  category: string;
  rate: number;
}