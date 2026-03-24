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
  aseId: string;
  asmId?: string;
  smId?: string;
  dmId?: string;
  active: boolean;
}

export interface SalesDumpItem {
  id: string;
  articleNumber: string;
  description: string;
  category: string;
  rate: number;
}

export type AuditStatus = 
  | 'draft' 
  | 'tentative' 
  | 'scheduled' 
  | 'in_progress' 
  | 'submitted' 
  | 'approved' 
  | 'signed' 
  | 'evidence_uploaded' 
  | 'closed' 
  | 'cancelled';

export interface AuditTicket {
  id: string;
  distributorId: string;
  scheduledDate?: string;
  proposedDate?: string;
  auditorId?: string;
  approvedValue: number;
  maxAllowedValue: number;
  status: AuditStatus;
  verifiedTotal: number;
  presenceLogs: PresenceLog[];
  signOffs: {
    auditor?: SignOff;
    ase?: SignOff;
    distributor?: SignOff;
  };
  media: MediaUpload[];
  createdAt: string;
  updatedAt: string;
}

export interface PresenceLog {
  userId: string;
  role: UserRole;
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
  signature?: string; // Base64 or token
}

export interface MediaUpload {
  id: string;
  type: 'image' | 'video';
  url: string;
  uploadedBy: string;
  timestamp: string;
  caption?: string;
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
  reasonCode: 'Expiry Non-salable' | 'Primary Damage';
  remarks?: string;
}
