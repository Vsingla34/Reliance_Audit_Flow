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
  createdAt?: string;
}

// --- MASTERS ---

export interface Distributor {
  id: string;
  code: string;
  anchorName?: string; // NEW
  name: string;
  contactPerson?: string;
  contactNumber?: string;
  email?: string;
  address?: string;
  city?: string;
  state?: string;
  region?: string; // NEW
  approvedValue: number;
  aseId: string | null;
  asmId?: string | null;
  smId?: string | null;
  dmId?: string | null;
  hoId?: string | null; // NEW
  active: boolean;
}

export interface ItemMaster { // NEW
  id: string;
  itemCode: string;
  itemName: string;
  gst: number;
  category: string;
  approxShelfLife: string;
}

export interface SalesDumpItem { // OVERHAULED
  id: string;
  distributorCode: string; 
  itemCode: string;
  quantity: number;
  rate: number;
}

// --- EXECUTION & SCHEDULING ---

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
  comments?: AuditComment[];
  createdAt: string;
  updatedAt: string;
  auditDays?: number;
}

export interface AuditLineItem {
  id: string;
  ticketId: string;
  articleNumber: string; // Maps to itemCode
  description: string;
  category: string;
  quantity: number;
  unitValue: number;
  totalValue: number;
  reasonCode: string;
  remarks?: string;
}