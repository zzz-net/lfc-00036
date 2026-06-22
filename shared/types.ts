export type AnomalyType = 'late' | 'absent' | 'duplicate_swipe' | 'leave_exception';

export type AnomalyStatus = 'pending' | 'confirmed' | 'reverted' | 'dismissed';

export type LeaveType = 'sick' | 'personal' | 'official' | 'other';

export interface Student {
  student_id: string;
  name: string;
  grade: string;
  class_name: string;
  created_at?: string;
}

export interface SwipeRecord {
  id?: number;
  student_id: string;
  swipe_time: string;
  device_location?: string;
  import_batch_id?: string;
}

export interface LeaveRecord {
  id?: number;
  student_id: string;
  leave_type: LeaveType | string;
  start_time: string;
  end_time: string;
  reason?: string;
}

export interface Anomaly {
  id: number;
  student_id: string;
  anomaly_type: AnomalyType;
  anomaly_date: string;
  description?: string;
  status: AnomalyStatus;
  review_note?: string;
  reviewed_by?: string;
  reviewed_at?: string;
  created_at?: string;
  student?: Student;
}

export interface ReviewHistory {
  id: number;
  anomaly_id: number;
  action: 'review' | 'revert' | 'dismiss';
  old_status?: AnomalyStatus;
  new_status: AnomalyStatus;
  note?: string;
  operator?: string;
  created_at: string;
}

export interface GradeRule {
  grade: string;
  morning_start_time: string;
  late_tolerance_minutes: number;
  afternoon_start_time: string;
  absent_window_minutes: number;
  updated_at?: string;
}

export interface RuleVersion {
  id: number;
  content: GradeRule[];
  description?: string;
  created_at: string;
}

export interface ImportError {
  row_number: number;
  student_id?: string;
  error_type: 'unknown_student' | 'invalid_time' | 'duplicate_record' | 'missing_field' | 'invalid_format';
  message: string;
  raw_data?: Record<string, unknown>;
}

export interface ImportValidationResult {
  valid_records: number;
  errors: ImportError[];
  students_found: string[];
}

export interface AnomalyFilters {
  grade?: string;
  class_name?: string;
  anomaly_type?: AnomalyType;
  status?: AnomalyStatus;
  start_date?: string;
  end_date?: string;
  page?: number;
  page_size?: number;
}

export interface PagedResult<T> {
  data: T[];
  total: number;
  page: number;
  page_size: number;
}

export interface TrendDataPoint {
  date: string;
  late: number;
  absent: number;
  duplicate_swipe: number;
  leave_exception: number;
}

export interface DistributionDataPoint {
  class_name: string;
  grade: string;
  count: number;
  type_breakdown: Record<AnomalyType, number>;
}
