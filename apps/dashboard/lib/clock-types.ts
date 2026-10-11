export interface ClockTiming {
  cadence: "daily" | "weekly" | "monthly";
  time: string;
  timezone: string;
  weekday?: number;
  day?: number;
}
export interface ClockSchedule {
  fingerprint: string;
  definition: ClockTiming & { id: string; project: string; desired_result: string; starts_at: string };
  enabled: boolean;
  next: { dueAt: string };
  due: { dueAt: string } | null;
  pending: ClockReceipt | null;
  last: ClockReceipt | null;
}
export interface ClockReceipt {
  status: "submitted" | "failed";
  due_at: string;
  request_id: string;
  last_error: string | null;
}
export interface ClockStatus { available: boolean; schedules: ClockSchedule[]; }
