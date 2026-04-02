export type UserRole = 
  | 'admin' | 'ho' | 'dm' | 'sm' | 'asm' | 'ase' | 'distributor' | 'auditor';

export interface UserProfile {
  uid: string; name: string; email: string; role: UserRole; mobile?: string; region?: string; active: boolean; createdAt?: string;
}

export interface Distributor {
  id: string; code: string; anchorName?: string; name: string; contactPerson?: string; contactNumber?: string; email?: string; address?: string; city?: string; state?: string; region?: string; approvedValue: number; aseId: string | null; asmId?: string | null; smId?: string | null; dmId?: string | null; hoId?: string | null; active: boolean;
}

export interface ItemMaster { 
  id: string; itemCode: string; itemName: string; gst: number; category: string; approxShelfLife: string; standardPack?: string; 
}

export interface SalesDumpItem { 
  id: string;
  distributorCode: string; 
  itemCode: string;        
  quantity: number;        
  rate: number;            
  
  billingDate?: string;
  soldToParty?: string;
  materialNo?: string;
  plant?: string;
  billingDoc?: string;
  category?: string;
  totalValue?: number;
  totalQty?: number;
  
  itemName?: string;
  gst?: number;
  approxShelfLife?: string;
  standardPack?: string;
}

export interface DateProposal {
  id: string; date: string; proposedByUserId: string; proposedByName: string; role: string; email: string; remarks: string; timestamp: string;
}

export interface PresenceLog {
  userId: string; role: string; timestamp: string; dayIndex?: number; location?: { lat: number; lng: number; }; status?: 'pending' | 'approved' | 'rejected'; rejectReason?: string; photoUrl?: string;
}

export interface SignOff { userId: string; name: string; timestamp: string; }

export interface MediaUpload { id: string; type: 'image' | 'video'; url: string; uploadedBy: string; timestamp: string; }

export interface AuditComment { id: string; userId: string; userName: string; userRole: string; message: string; timestamp: string; }

export interface AuditTicket {
  id: string; distributorId: string; scheduledDate: string | null; proposedDate: string | null; 
  auditorId: string | null; 
  auditorIds?: string[]; 
  approvedValue: number; maxAllowedValue: number; status: 'tentative' | 'scheduled' | 'in_progress' | 'submitted' | 'signed' | 'evidence_uploaded' | 'closed'; verifiedTotal: number; presenceLogs: PresenceLog[]; signOffs: { auditor?: SignOff; ase?: SignOff; distributor?: SignOff; }; media: MediaUpload[]; dateProposals?: DateProposal[]; comments?: AuditComment[]; createdAt: string; updatedAt: string; auditDays?: number;
}

export interface AuditLineItem {
  id: string;
  ticketId: string;
  articleNumber: string; 
  description: string;
  category: string;
  qtyNonSaleable: number;
  qtyBBD: number;
  qtyDamaged: number;
  quantity: number; 
  unitValue: number;
  totalValue: number;
  reasonCode: string;
  remarks?: string;
  photoUrl?: string; // NEW: Item-level image
}